import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import {
	createDemoFridayCoordinatorWorker,
	demoFridayActionableNonterminal,
	demoFridayCoordinatorRecordIdentityDigest,
	DEMO_FRIDAY_PRESERVED_RECIPIENT_PENDING_R48_20261109,
	DEMO_FRIDAY_PRESERVED_RECIPIENT_PENDING_R79_20261113,
	DEMO_FRIDAY_PRESERVED_RECIPIENT_PENDING_R82_20261113,
	DemoFridayCoordinatorSqlite,
	type DemoFridayCoordinatorPorts,
} from './demo-friday-coordinator-runtime'

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
	test('pins all eight isolated historical recipient-pending records', () => {
		expect(DEMO_FRIDAY_PRESERVED_RECIPIENT_PENDING_R48_20261109.size).toBe(8)
		expect(DEMO_FRIDAY_PRESERVED_RECIPIENT_PENDING_R48_20261109.get(
			'f37f14a3c1e4a529d2915678de3ceab3d3ac1aa246f53ac96023400883c44c6d',
		)).toBe('d055dc91b36891184691bb7cbd1087d8d67080caadf3a7e4b0cdccda09643136')
	})

	test('pins the three later recipient-pending records without weakening the historical pins', () => {
		expect(DEMO_FRIDAY_PRESERVED_RECIPIENT_PENDING_R79_20261113.size).toBe(11)
		expect(DEMO_FRIDAY_PRESERVED_RECIPIENT_PENDING_R79_20261113.get(
			'2446fbe5e179a35b2052c009d11d21afe6dd306a6965f49a0ffcc94076ec016b',
		)).toBe('1ded66021330161e8d2540c4021557b11932ca14999d1f045933b7070d6adbed')
		expect(DEMO_FRIDAY_PRESERVED_RECIPIENT_PENDING_R79_20261113.get(
			'2c6bd6e0b60622b664a8eea689f3deb770552ea2fe2096b444df615448d263d4',
		)).toBe('93745719d6b2c8482abfd653ecac7bb5423e1e4ef6a7156c0c2a89f7f0f15773')
		expect(DEMO_FRIDAY_PRESERVED_RECIPIENT_PENDING_R79_20261113.get(
			'e676e0d6661710807c2a2a8e3f0294092edb7426d900c22fa2c49594970b7dc1',
		)).toBe('870f399d035c59110f96902ec90581c014034a0e428ba46e40a999d1d79e25e9')
	})

	test('pins the exact R81 acceptance return without weakening the R79 backlog', () => {
		expect(DEMO_FRIDAY_PRESERVED_RECIPIENT_PENDING_R82_20261113.size).toBe(12)
		expect(DEMO_FRIDAY_PRESERVED_RECIPIENT_PENDING_R82_20261113.get(
			'23d3a1c1f0a62861da4489b98723d110548010739630a0eba826b4c389054ce8',
		)).toBe('0ca44c8af4c6a4f051bb02020913ffadb60147cee3df4ced140360c630d2577e')
		for (const [scope, digest] of DEMO_FRIDAY_PRESERVED_RECIPIENT_PENDING_R79_20261113) {
			expect(DEMO_FRIDAY_PRESERVED_RECIPIENT_PENDING_R82_20261113.get(scope)).toBe(digest)
		}
	})

	test('preserves only the exact pinned historical recipient backlog while scheduling fresh work', () => {
		const { db, store } = opened()
		try {
			store.enqueueAuthorized(authorized())
			const historical = store.transition('auction-a:bid-a', ['queued'], (record) => {
				record.phase = 'recipient_pending'; record.attempts = 1
				record.requestDigest = h('c'); record.terminalResponseDigest = h('d')
			})
			const fresh = {
				...historical, scope: 'auction-fresh:bid-fresh', authorityOperationId: 'funding-fresh',
				paymentOperationId: 'payment-fresh', operationRoot: h('3'), frostOperationRoot: h('4'),
				bundleDigest: h('5'), executionBindingDigest: h('6'), preparedAuthorizationDigest: h('7'),
				selectionRoot: h('8'), phase: 'queued' as const, revision: 0, attempts: 0,
				requestDigest: undefined, terminalResponseDigest: undefined,
			}
			const preserved = new Map([[historical.scope, demoFridayCoordinatorRecordIdentityDigest(historical)]])
			expect(demoFridayActionableNonterminal([historical], preserved)).toEqual([])
			expect(demoFridayActionableNonterminal([historical, fresh], preserved)).toEqual([fresh])
			expect(() => demoFridayActionableNonterminal([fresh], preserved)).toThrow(/exact historical record differs/)
			expect(() => demoFridayActionableNonterminal([{ ...historical, revision: historical.revision + 1 }, fresh], preserved))
				.toThrow(/exact historical record differs/)
		} finally { db.close(false) }
	})

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
			async importExact() { imports += 1; return { status: 'completed', recipientImportDigest: h('e') } },
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

	test('keeps a recipient-pending operation stable until its exact browser import arrives', async () => {
		const { db, store } = opened()
		let imports = 0
		try {
			store.enqueueAuthorized(authorized())
			const worker = createDemoFridayCoordinatorWorker(store, {
				async executeExact() { return { status: 'recipient_pending', requestDigest: h('c'), terminalResponseDigest: h('d') } },
				async recoverExact() { throw new Error('not reached') },
				async importExact() {
					imports += 1
					return imports === 1 ? { status: 'recipient_pending' } : { status: 'completed', recipientImportDigest: h('e') }
				},
			})
			expect((await worker.runExact('auction-a:bid-a')).phase).toBe('recipient_pending')
			const pending = await worker.reconcileExact('auction-a:bid-a')
			expect(pending.phase).toBe('recipient_pending')
			expect(pending.revision).toBe(2)
			expect((await worker.reconcileExact('auction-a:bid-a')).phase).toBe('completed')
			expect(imports).toBe(2)
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
