import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DemoFridayCoordinatorRollbackAnchorSqlite } from './demo-friday-coordinator-rollback-anchor'
import { DemoFridayCoordinatorSqlite } from './demo-friday-coordinator-runtime'

const h = (character: string): string => character.repeat(64)
const authorized = () => ({
	scope: 'auction-a:bid-a', authorityOperationId: 'funding-a', paymentOperationId: 'funding-a',
	recipientActorId: h('2'),
	operationRoot: h('a'), frostOperationRoot: h('f'), bundleDigest: h('b'), branch: 'outbid_return' as const,
	chainId: 'plebeian-friday-demo-v1', executionBindingDigest: h('c'),
	preparedAuthorizationDigest: h('d'), selectionRoot: h('e'), outcomeHeight: 42,
})

function opened() {
	const coordinatorDb = new Database(':memory:', { strict: true })
	const anchorDb = new Database(':memory:', { strict: true })
	const store = new DemoFridayCoordinatorSqlite(coordinatorDb, 'friday-blue-20261023')
	const anchor = new DemoFridayCoordinatorRollbackAnchorSqlite(anchorDb, true)
	anchor.observeExact(store.anchorSnapshot())
	return { coordinatorDb, anchorDb, store, anchor }
}

describe('Friday coordinator independent rollback anchor', () => {
	test('advances a distinct anchor and rejects coordinator revision rollback', () => {
		const held = opened()
		try {
			held.store.enqueueAuthorized(authorized())
			held.anchor.observeExact(held.store.anchorSnapshot())
			held.coordinatorDb.query('DELETE FROM friday_coordinator_operations').run()
			held.coordinatorDb.query('UPDATE friday_coordinator_metadata SET global_revision=0 WHERE id=1').run()
			expect(() => held.anchor.observeExact(held.store.anchorSnapshot())).toThrow(/revision regressed/)
		} finally { held.anchorDb.close(false); held.coordinatorDb.close(false) }
	})

	test('rejects changed coordinator state at the same anchored revision', () => {
		const held = opened()
		try {
			held.store.enqueueAuthorized(authorized())
			held.anchor.observeExact(held.store.anchorSnapshot())
			const record = held.store.read('auction-a:bid-a')!
			held.coordinatorDb.query('UPDATE friday_coordinator_operations SET record_json=? WHERE scope=?')
				.run(JSON.stringify({ ...record, reasonCode: 'tampered' }), record.scope)
			expect(() => held.anchor.observeExact(held.store.anchorSnapshot())).toThrow(/changed at an anchored revision/)
		} finally { held.anchorDb.close(false); held.coordinatorDb.close(false) }
	})

	test('does not silently enroll a missing anchor after initialization', () => {
		const coordinatorDb = new Database(':memory:', { strict: true })
		const anchorDb = new Database(':memory:', { strict: true })
		try {
			const store = new DemoFridayCoordinatorSqlite(coordinatorDb, 'friday-blue-20261023')
			const anchor = new DemoFridayCoordinatorRollbackAnchorSqlite(anchorDb)
			expect(() => anchor.observeExact(store.anchorSnapshot())).toThrow(/anchor is missing/)
		} finally { anchorDb.close(false); coordinatorDb.close(false) }
	})

	test('waits for a concurrent authority writer instead of crashing with SQLITE_BUSY', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'friday-coordinator-anchor-busy-'))
		const anchorPath = join(directory, 'coordinator.sqlite3')
		const lockedPath = join(directory, 'locked')
		const coordinatorDb = new Database(':memory:', { strict: true })
		const anchorDb = new Database(anchorPath, { create: true, strict: true })
		let holder: ReturnType<typeof Bun.spawn> | undefined
		try {
			const store = new DemoFridayCoordinatorSqlite(coordinatorDb, 'friday-blue-20261023')
			const anchor = new DemoFridayCoordinatorRollbackAnchorSqlite(anchorDb, true)
			anchor.observeExact(store.anchorSnapshot())
			store.enqueueAuthorized(authorized())
			const script = `
				import { Database } from 'bun:sqlite'
				import { writeFileSync } from 'node:fs'
				const database = new Database(${JSON.stringify(anchorPath)}, { strict: true })
				database.exec('PRAGMA journal_mode=WAL; BEGIN IMMEDIATE')
				writeFileSync(${JSON.stringify(lockedPath)}, 'locked\\n')
				await Bun.sleep(250)
				database.exec('COMMIT')
				database.close(false)
			`
			holder = Bun.spawn([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'pipe' })
			for (let attempt = 0; attempt < 100 && !existsSync(lockedPath); attempt += 1) await Bun.sleep(10)
			expect(existsSync(lockedPath)).toBe(true)
			expect(() => anchor.observeExact(store.anchorSnapshot())).not.toThrow()
			expect(await holder.exited).toBe(0)
			expect(anchorDb.query<{ timeout: number }, []>('PRAGMA busy_timeout').get()).toEqual({ timeout: 5000 })
		} finally {
			if (holder !== undefined && holder.exitCode === null) holder.kill()
			anchorDb.close(false); coordinatorDb.close(false)
			await rm(directory, { recursive: true, force: true })
		}
	}, 10_000)
})
