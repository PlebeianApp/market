import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'

import {
	DemoFridayTrustedTerminalSqlite,
	createDemoFridayAuthorityHealth,
	runDemoFridayAuthorityDrainLoop,
} from './demo-friday-authority-runtime'
import { DemoIntegratedCloseAuthorityRefusedError } from './demo-integrated-close-authority'

const DIGEST = 'a'.repeat(64)

describe('fixed Friday authority runtime adapters', () => {
	test('durably resolves and acknowledges one authenticated reference', async () => {
		const db = new Database(':memory:')
		let resolutions = 0
		try {
			const source = new DemoFridayTrustedTerminalSqlite(db, {
				async resolveExact(reference) {
					resolutions += 1
					expect(reference.identityDigest).toBe(DIGEST)
					return { branch: 'outbid_return', options: { captured: true } } as never
				},
			})
			source.enqueueAuthenticatedExact({ schema: 'PLEBEIAN_FRIDAY_TERMINAL_REFERENCE_V1', reference: 'terminal-1', identityDigest: DIGEST })
			source.enqueueAuthenticatedExact({ schema: 'PLEBEIAN_FRIDAY_TERMINAL_REFERENCE_V1', reference: 'terminal-1', identityDigest: DIGEST })
			const candidate = await source.nextExact()
			expect(candidate).toMatchObject({ reference: 'terminal-1', request: { branch: 'outbid_return' } })
			await source.markQueuedExact('terminal-1', { branch: 'outbid_return', result: { queued: true } } as never)
			await source.markQueuedExact('terminal-1', { branch: 'outbid_return', result: { queued: true } } as never)
			expect(await source.nextExact()).toBeNull()
			expect(source.pendingCount()).toBe(0)
			expect(resolutions).toBe(1)
			expect(() => source.enqueueAuthenticatedExact({
				schema: 'PLEBEIAN_FRIDAY_TERMINAL_REFERENCE_V1', reference: 'terminal-2', identityDigest: DIGEST,
			})).toThrow(/CONFLICT/)
		} finally { db.close(false) }
	})

	test('claims one terminal reference before resolving and only restart recovery releases it', async () => {
		const db = new Database(':memory:')
		try {
			let release!: () => void
			const held = new Promise<void>((resolve) => { release = resolve })
			const source = new DemoFridayTrustedTerminalSqlite(db, {
				async resolveExact() { await held; return { branch: 'outbid_return', options: {} } as never },
			})
			source.enqueueAuthenticatedExact({ schema: 'PLEBEIAN_FRIDAY_TERMINAL_REFERENCE_V1', reference: 'terminal-held', identityDigest: DIGEST })
			const resolving = source.nextExact()
			expect(await source.nextExact()).toBeNull()
			release()
			expect((await resolving)?.reference).toBe('terminal-held')
			expect(await source.nextExact()).toBeNull()
			expect(source.recoverInterruptedExact()).toBe(1)
			expect((await source.nextExact())?.reference).toBe('terminal-held')
		} finally { db.close(false) }
	})

	test('expires only a typed permanent cutoff and continues to the next terminal', async () => {
		const db = new Database(':memory:')
		try {
			const source = new DemoFridayTrustedTerminalSqlite(db, {
				async resolveExact(reference) {
					if (reference.reference === 'terminal-expired') {
						throw new DemoIntegratedCloseAuthorityRefusedError('DEMO_CLOSE_CUTOFF', 'outside MAIN')
					}
					return { branch: 'outbid_return', options: { captured: true } } as never
				},
			})
			source.enqueueAuthenticatedExact({
				schema: 'PLEBEIAN_FRIDAY_TERMINAL_REFERENCE_V1', reference: 'terminal-expired', identityDigest: DIGEST,
			})
			source.enqueueAuthenticatedExact({
				schema: 'PLEBEIAN_FRIDAY_TERMINAL_REFERENCE_V1', reference: 'terminal-next', identityDigest: 'b'.repeat(64),
			})
			expect((await source.nextExact())?.reference).toBe('terminal-next')
			expect(db.query<{ phase: string; result_json: string }, [string]>(
				'SELECT phase, result_json FROM friday_terminal_references WHERE reference = ?',
			).get('terminal-expired')).toEqual({
				phase: 'expired', result_json: JSON.stringify({
					schema: 'PLEBEIAN_FRIDAY_TERMINAL_EXPIRY_V1', code: 'DEMO_CLOSE_CUTOFF',
				}),
			})
			expect(source.pendingCount()).toBe(1)
		} finally { db.close(false) }
	})

	test('keeps an unclassified resolver failure fail-closed for restart recovery', async () => {
		const db = new Database(':memory:')
		try {
			const source = new DemoFridayTrustedTerminalSqlite(db, {
				async resolveExact() { throw new Error('unexpected resolver fault') },
			})
			source.enqueueAuthenticatedExact({
				schema: 'PLEBEIAN_FRIDAY_TERMINAL_REFERENCE_V1', reference: 'terminal-fault', identityDigest: DIGEST,
			})
			await expect(source.nextExact()).rejects.toThrow('unexpected resolver fault')
			expect(source.recoverInterruptedExact()).toBe(1)
			expect(source.pendingCount()).toBe(1)
		} finally { db.close(false) }
	})

	test('health anchors coordinator state and quarantines chain regression', async () => {
		const terminalDb = new Database(':memory:')
		let height = 12, observations = 0
		try {
			const source = new DemoFridayTrustedTerminalSqlite(terminalDb, { async resolveExact() { throw new Error('unused') } })
			const health = createDemoFridayAuthorityHealth({
				deploymentId: 'friday-blue', chainId: 'friday-chain', terminalSource: source,
				coordinatorStore: {
					anchorSnapshot() { return { schema: 'PLEBEIAN_FRIDAY_COORDINATOR_ANCHOR_SNAPSHOT_V1' } as never },
					listNonterminal() { return [{ scope: 'one' }] as never },
				} as never,
				rollbackAnchor: { observeExact() { observations += 1 } },
				commitReader: { async readExact() { return { chainId: 'friday-chain', height } } },
			})
			expect(await health.readExact()).toMatchObject({ quarantined: false, queuePending: 1, lastCommittedHeight: 12 })
			height = 11
			expect(await health.readExact()).toMatchObject({ quarantined: true, lastCommittedHeight: 12 })
			expect(observations).toBe(2)
		} finally { terminalDb.close(false) }
	})

 test('stalled authority is unavailable without safety quarantine and resumes after advancement', async () => {
  let now = 0, height = 10
  const health = createDemoFridayAuthorityHealth({ deploymentId: 'deployment', chainId: 'chain', now: () => now,
   terminalSource: { pendingCount: () => 0 } as never,
   coordinatorStore: { anchorSnapshot: () => ({}), listNonterminal: () => [] } as never,
   rollbackAnchor: { observeExact() {} }, commitReader: { readExact: async () => ({ chainId: 'chain', height }) },
  })
  expect(await health.readExact()).toMatchObject({ quarantined: false, consensusAvailable: true })
  now = 20_000
  expect(await health.readExact()).toMatchObject({ quarantined: false, consensusAvailable: false })
  height++; now++
  expect(await health.readExact()).toMatchObject({ quarantined: false, consensusAvailable: true })
 })

	test('drain loop is serial and exits only through its explicit signal', async () => {
		const controller = new AbortController(); let calls = 0, sleeps = 0
		await runDemoFridayAuthorityDrainLoop({
			service: {
				async drainOne() { calls += 1; return calls === 1 ? 'queued' : 'idle' },
				async handle() { throw new Error('unused') },
			},
			signal: controller.signal,
			async sleep() { sleeps += 1; controller.abort() },
		})
		expect({ calls, sleeps }).toEqual({ calls: 2, sleeps: 1 })
	})
})
