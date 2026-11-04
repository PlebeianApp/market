import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdir, mkdtemp, open, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
	demoFridayAuthorityArgs,
	demoFridayAuthorityParticipantBinary,
	initializeDemoFridayAuthorityStores,
	initializeDemoFridaySellerPlanStores,
	type DemoFridayAuthorityStorePaths,
} from './demo-friday-authority-cli'

function authorityPaths(root: string): DemoFridayAuthorityStorePaths {
	const state = join(root, 'state'), anchor = join(root, 'anchor')
	return {
		terminal: join(state, 'terminal.sqlite3'), coordinator: join(state, 'operations.sqlite3'),
		authority: join(state, 'authority.sqlite3'), private: join(state, 'private.sqlite3'),
		recovery: join(state, 'recovery.sqlite3'), signerAnchor: join(state, 'signer-anchor.sqlite3'),
		coordinatorAnchor: join(anchor, 'coordinator.sqlite3'), fundingReplay: join(state, 'funding-replay.sqlite3'),
		fundingReplayAnchor: join(anchor, 'funding-replay.sqlite3'), fundingBroadcast: join(state, 'funding-broadcast.sqlite3'),
		fundingBroadcastAnchor: join(anchor, 'funding-broadcast.sqlite3'),
		fundingAbort: join(state, 'funding-abort.sqlite3'),
		fundingAbortAnchor: join(anchor, 'funding-abort.sqlite3'),
		fundingAbortSessions: join(state, 'funding-abort-sessions.sqlite3'),
		admissionSessions: join(state, 'admission-sessions.sqlite3'), terminalExchange: join(state, 'terminal-exchange.sqlite3'),
		sellerPlan: join(state, 'seller-plan.sqlite3'), sellerPlanAnchor: join(anchor, 'seller-plan.sqlite3'),
	}
}

describe('fixed Friday authority CLI', () => {
	test('selects immutable participant paths by live application schema', () => {
		expect(demoFridayAuthorityParticipantBinary('PLEBEIAN_FRIDAY_SEPARATED_APPLICATION_V1'))
			.toBe('/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-aggregate-r16/bin/coco-demo-frost-participant-3of4')
		expect(demoFridayAuthorityParticipantBinary('PLEBEIAN_FRIDAY_LIVE_APPLICATION_V2'))
			.toBe('/opt/plebeian-auctions-friday/bin/coco-demo-frost-participant-3of4')
		expect(demoFridayAuthorityParticipantBinary('PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3'))
			.toBe('/opt/plebeian-auctions-friday/releases/r20-deploy-v1/bin/coco-demo-frost-participant-3of4')
	})
	test('accepts only the reviewed fixed application path', () => {
		expect(demoFridayAuthorityArgs([
			'serve', '--application', '/etc/plebeian-auctions-friday/application.json',
		])).toEqual({ mode: 'serve', application: '/etc/plebeian-auctions-friday/application.json' })
		expect(demoFridayAuthorityArgs([
			'init-seller-plan', '--application', '/etc/plebeian-auctions-friday/application.json',
		])).toEqual({ mode: 'init-seller-plan', application: '/etc/plebeian-auctions-friday/application.json' })
		expect(demoFridayAuthorityArgs([
			'init-state', '--application', '/etc/plebeian-auctions-friday/application.json',
		])).toEqual({ mode: 'init-state', application: '/etc/plebeian-auctions-friday/application.json' })
		expect(() => demoFridayAuthorityArgs([
			'serve', '--application', '/tmp/plebeian-friday-fips-lab.fake/application.json',
		])).toThrow(/fixed live application path/)
	})

	test('reserves and initializes every authority store and independent anchor exactly once', async () => {
		const root = await mkdtemp(join(tmpdir(), 'friday-authority-state-init.')), paths = authorityPaths(root)
		await mkdir(join(root, 'state')); await mkdir(join(root, 'anchor'))
		try {
			await initializeDemoFridayAuthorityStores({ paths, deploymentId: 'friday-deployment-1' })
			for (const path of Object.values(paths)) expect((await stat(path)).mode & 0o777).toBe(0o600)
			const coordinator = new Database(paths.coordinator, { create: false, readonly: true, strict: true })
			const coordinatorAnchor = new Database(paths.coordinatorAnchor, { create: false, readonly: true, strict: true })
			const replayAnchor = new Database(paths.fundingReplayAnchor, { create: false, readonly: true, strict: true })
			const broadcastAnchor = new Database(paths.fundingBroadcastAnchor, { create: false, readonly: true, strict: true })
			try {
				expect(coordinator.query('SELECT deployment_id,global_revision FROM friday_coordinator_metadata WHERE id=1').get())
					.toEqual({ deployment_id: 'friday-deployment-1', global_revision: 0 })
				expect(coordinatorAnchor.query('SELECT deployment_id,maximum_global_revision FROM friday_coordinator_rollback_anchor WHERE id=1').get())
					.toEqual({ deployment_id: 'friday-deployment-1', maximum_global_revision: 0 })
				expect(replayAnchor.query('SELECT deployment_id,global_revision FROM friday_funding_replay_anchor WHERE id=1').get())
					.toEqual({ deployment_id: 'friday-deployment-1', global_revision: 0 })
				expect(broadcastAnchor.query('SELECT deployment_id,maximum_global_revision FROM friday_v4_broadcast_rollback_anchor WHERE id=1').get())
					.toEqual({ deployment_id: 'friday-deployment-1', maximum_global_revision: 0 })
			} finally { broadcastAnchor.close(false); replayAnchor.close(false); coordinatorAnchor.close(false); coordinator.close(false) }
			await expect(initializeDemoFridayAuthorityStores({ paths, deploymentId: 'friday-deployment-1' })).rejects.toThrow()
		} finally { await rm(root, { recursive: true, force: true }) }
	})

	test('retains positively identified reservations for inspection after a partial O_EXCL refusal', async () => {
		const root = await mkdtemp(join(tmpdir(), 'friday-authority-state-partial.')), paths = authorityPaths(root)
		await mkdir(join(root, 'state')); await mkdir(join(root, 'anchor'))
		const conflict = await open(paths.authority, 'wx', 0o600); await conflict.close()
		try {
			await expect(initializeDemoFridayAuthorityStores({ paths, deploymentId: 'friday-deployment-1' })).rejects.toThrow()
			// The initializer never guesses that earlier reservations are safe
			// to delete after a later path conflict.
			expect((await stat(paths.terminal)).mode & 0o777).toBe(0o600)
			expect((await stat(paths.coordinator)).mode & 0o777).toBe(0o600)
			expect((await stat(paths.authority)).mode & 0o777).toBe(0o600)
		} finally { await rm(root, { recursive: true, force: true }) }
	})

	test('does not accept request-selected endpoints, roots, or binaries', () => {
		expect(() => demoFridayAuthorityArgs([
			'serve', '--application', '/etc/plebeian-auctions-friday/application.json',
			'--mint-url', 'http://example.invalid/',
		])).toThrow(/usage/)
	})

	test('initializes one exact empty seller-plan store and independently anchored generation', async () => {
		const root = await mkdtemp(join(tmpdir(), 'friday-seller-plan-init.'))
		const databasePath = join(root, 'seller-plan.sqlite3')
		const anchorPath = join(root, 'seller-plan-anchor.sqlite3')
		try {
			await initializeDemoFridaySellerPlanStores({ databasePath, anchorPath, deploymentId: 'friday-deployment-1' })
			expect((await stat(databasePath)).mode & 0o777).toBe(0o600)
			expect((await stat(anchorPath)).mode & 0o777).toBe(0o600)
			const database = new Database(databasePath, { create: false, readonly: true, strict: true })
			const anchor = new Database(anchorPath, { create: false, readonly: true, strict: true })
			try {
				expect(database.query('SELECT deployment_id,global_revision FROM friday_seller_plan_metadata WHERE id=1').get())
					.toEqual({ deployment_id: 'friday-deployment-1', global_revision: 0 })
				expect(anchor.query('SELECT deployment_id,maximum_global_revision FROM friday_seller_plan_rollback_anchor WHERE id=1').get())
					.toEqual({ deployment_id: 'friday-deployment-1', maximum_global_revision: 0 })
			} finally { anchor.close(false); database.close(false) }
			await expect(initializeDemoFridaySellerPlanStores({ databasePath, anchorPath, deploymentId: 'friday-deployment-1' }))
				.rejects.toThrow()
			// A refusal never truncates or rewrites the already-enrolled store.
			expect((await readFile(databasePath)).byteLength).toBeGreaterThan(0)
		} finally { await rm(root, { recursive: true, force: true }) }
	})
})
