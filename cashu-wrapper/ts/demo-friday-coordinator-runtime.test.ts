import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { createDemoFridayCoordinatorWorker, DemoFridayCoordinatorSqlite, type DemoFridayCoordinatorPorts } from './demo-friday-coordinator-runtime'

const h = (character: string): string => character.repeat(64)

function opened(): { db: Database; store: DemoFridayCoordinatorSqlite } {
	const db = new Database(':memory:', { strict: true })
	return { db, store: new DemoFridayCoordinatorSqlite(db, 'friday-blue-20261023') }
}

function authorized(overrides: Partial<Parameters<DemoFridayCoordinatorSqlite['enqueueAuthorized']>[0]> = {}): Parameters<DemoFridayCoordinatorSqlite['enqueueAuthorized']>[0] {
	return {
		scope: 'auction-a:bid-a', authorityOperationId: 'funding-a', paymentOperationId: 'funding-a',
		recipientActorId: h('2'),
		operationRoot: h('a'), frostOperationRoot: h('1'), bundleDigest: h('b'), branch: 'outbid_return' as const,
		chainId: 'plebeian-friday-demo-v1', executionBindingDigest: h('f'),
		preparedAuthorizationDigest: h('e'), selectionRoot: h('d'), outcomeHeight: 42, ...overrides,
	}
}

describe('persistent Friday coordinator process boundary', () => {
	test('globally excludes operation and bundle reuse across auction scopes', () => {
		const { db, store } = opened()
		try {
			store.enqueueAuthorized(authorized({ branch: 'winner_payout' }))
			expect(() => store.enqueueAuthorized(authorized({ scope: 'auction-b:bid-b', bundleDigest: h('c') }))).toThrow()
			expect(() => store.enqueueAuthorized(authorized({ scope: 'auction-b:bid-b', operationRoot: h('d') }))).toThrow()
			expect(() => store.enqueueAuthorized(authorized({ branch: 'reserve_unmet_return' }))).toThrow()
			expect(() => store.enqueueAuthorized(authorized({ executionBindingDigest: h('9') }))).toThrow()
			expect(() => store.enqueueAuthorized(authorized({ preparedAuthorizationDigest: h('8') }))).toThrow()
			expect(() => store.enqueueAuthorized(authorized({ paymentOperationId: 'payment-b' }))).toThrow()
		} finally { db.close(false) }
	})

	test('accepts one consensus-authorized FundingAbort terminal operation', () => {
		const { db, store } = opened()
		try {
			const saved = store.enqueueAuthorized(authorized({ branch: 'funding_abort_return' }))
			expect(saved.branch).toBe('funding_abort_return')
			expect(store.read(saved.scope)).toEqual(saved)
		} finally { db.close(false) }
	})

	test('binds the database to one deployment and validates persisted records', () => {
		const db = new Database(':memory:', { strict: true })
		try {
			const store = new DemoFridayCoordinatorSqlite(db, 'friday-blue-20261023')
			store.enqueueAuthorized(authorized())
			expect(() => new DemoFridayCoordinatorSqlite(db, 'friday-green-20261023')).toThrow(/another schema or deployment/)
			db.query('UPDATE friday_coordinator_operations SET record_json = ? WHERE scope = ?')
				.run(JSON.stringify({ ...store.read('auction-a:bid-a'), deploymentId: 'friday-green-20261023' }), 'auction-a:bid-a')
			expect(() => store.read('auction-a:bid-a')).toThrow(/stored deployment/)
		} finally { db.close(false) }
	})

	test('keeps an unknown mint effect unavailable until exact recovery and import', async () => {
		const { db, store } = opened()
		let executes = 0, recovers = 0, imports = 0
		const ports: DemoFridayCoordinatorPorts = {
			async executeExact() { executes += 1; return { status: 'mint_unknown', requestDigest: h('c') } },
			async recoverExact() { recovers += 1; return recovers === 1 ? { status: 'indeterminate' } : { status: 'recipient_pending', terminalResponseDigest: h('d') } },
			async importExact() { imports += 1; return { recipientImportDigest: h('e') } },
		}
		try {
			store.enqueueAuthorized(authorized())
			const worker = createDemoFridayCoordinatorWorker(store, ports)
			expect((await worker.runExact('auction-a:bid-a')).phase).toBe('mint_unknown')
			expect((await worker.reconcileExact('auction-a:bid-a')).phase).toBe('mint_unknown')
			expect((await worker.reconcileExact('auction-a:bid-a')).phase).toBe('recipient_pending')
			expect((await worker.reconcileExact('auction-a:bid-a')).phase).toBe('completed')
			expect({ executes, recovers, imports }).toEqual({ executes: 1, recovers: 2, imports: 1 })
		} finally { db.close(false) }
	})

	test('routes a process-boundary interruption into exact recovery instead of repeating payment', async () => {
		const { db, store } = opened()
		let recoveries = 0
		try {
			store.enqueueAuthorized(authorized({ branch: 'winner_payout' }))
			store.transition('auction-a:bid-a', ['queued'], (record) => { record.phase = 'executing'; record.attempts += 1 })
			expect(store.markInterruptedExecutionsUnknown()).toBe(1)
			const recovered = store.read('auction-a:bid-a')!
			expect(recovered.phase).toBe('mint_unknown')
			expect(recovered.reasonCode).toBe('COORDINATOR_RESTART_DURING_EXECUTION')
			const worker = createDemoFridayCoordinatorWorker(store, {
				async executeExact() { throw new Error('must not make a fresh payment') },
				async recoverExact() { recoveries += 1; return { status: 'retry_ready' } },
				async importExact() { throw new Error('not reached') },
			})
			expect((await worker.reconcileExact('auction-a:bid-a')).phase).toBe('queued')
			expect(recoveries).toBe(1)
		} finally { db.close(false) }
	})
})
