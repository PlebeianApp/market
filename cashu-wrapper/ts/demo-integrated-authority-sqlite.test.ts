import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'

import {
	demoIntegratedExecutionRootBindingDigest,
	demoIntegratedProofPoolDigest,
	type DemoIntegratedAuthorityClaim,
	type DemoIntegratedExecutionRootBindingV1,
} from './demo-integrated-authority'
import { DemoIntegratedAuthoritySqliteStore } from './demo-integrated-authority-sqlite'

const roots: string[] = []
afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function claim(operationByte: string, proofStateRefs = [`02${'31'.repeat(32)}`]): DemoIntegratedAuthorityClaim {
	const operationId = operationByte.repeat(64)
	const operationRoot = `${operationByte === 'a' ? 'b' : 'c'}`.repeat(64)
	return {
		schema: 'COCO_DEMO_INTEGRATED_AUTHORITY_CLAIM_V1', operationId,
		operationRoot, network: 'fake-only', chainId: 'friday-chain',
		auctionId: `auction-${operationByte}`, displacedBidId: `bid-${operationByte}`, replacementBidId: `replacement-${operationByte}`,
		displacementHeight: 10, templateDigest: operationRoot, cashuSigAllDigest: 'e'.repeat(64), outputsDigest: 'f'.repeat(64),
		proofStateRefs, poolAmount: 2_500, admissionOperationId: operationId,
		admissionReceiptDigest: '1'.repeat(64), committeeKeysetId: 'committee-1', committeeKeysetVersion: '1',
		dkgRunId: 'dkg-run-1', publicKeyPackageSha256: '2'.repeat(64), signerRosterDigest: '3'.repeat(64),
		status: 'outbid_return_pending',
	}
}

function executionBinding(authority: DemoIntegratedAuthorityClaim, frostRoot = '4'.repeat(64)): DemoIntegratedExecutionRootBindingV1 {
	const stable: Omit<DemoIntegratedExecutionRootBindingV1, 'bindingDigest'> = {
		schema: 'COCO_DEMO_INTEGRATED_EXECUTION_ROOT_BINDING_V1', operationId: authority.operationId,
		authorityOperationRoot: authority.operationRoot, frostOperationRoot: frostRoot,
		network: authority.network, chainId: authority.chainId, auctionId: authority.auctionId,
		displacedBidId: authority.displacedBidId, replacementBidId: authority.replacementBidId,
		displacementHeight: authority.displacementHeight,
		templateDigest: authority.templateDigest, cashuSigAllDigest: authority.cashuSigAllDigest,
		outputsDigest: authority.outputsDigest,
		proofPoolDigest: demoIntegratedProofPoolDigest(authority.proofStateRefs), poolAmount: authority.poolAmount,
		admissionReceiptDigest: authority.admissionReceiptDigest,
		committeeKeysetId: authority.committeeKeysetId, committeeKeysetVersion: authority.committeeKeysetVersion,
		dkgRunId: authority.dkgRunId,
		publicKeyPackageSha256: authority.publicKeyPackageSha256, signerRosterDigest: authority.signerRosterDigest,
		processRosterDigest: '5'.repeat(64), policyPackageDigest: '6'.repeat(64),
	}
	return { ...stable, bindingDigest: demoIntegratedExecutionRootBindingDigest(stable) }
}

describe('durable integrated authority claims', () => {
	test('durably binds one authority root to one concrete Rust FROST root and refuses remapping', async () => {
		const root = await mkdtemp('/tmp/plebeian-authority-sqlite-')
		roots.push(root)
		const path = join(root, 'authority.sqlite3')
		let database = new Database(path, { create: true, strict: true })
		let store = new DemoIntegratedAuthoritySqliteStore(database)
		const authority = claim('a')
		await store.claimOutbidReturn(authority)
		const binding = executionBinding(authority)
		await expect(store.bindExecutionRoot(binding)).resolves.toMatchObject({ created: true, binding })
		database.close()
		database = new Database(path, { create: false, strict: true })
		store = new DemoIntegratedAuthoritySqliteStore(database)
		await expect(store.bindExecutionRoot(binding)).resolves.toMatchObject({ created: false, binding })
		await expect(store.bindExecutionRoot(executionBinding(authority, '7'.repeat(64))))
			.rejects.toThrow(/EXECUTION_CONFLICT/)
		await expect(store.readExecutionRoot(authority.operationId)).resolves.toEqual(binding)
		database.close()
	})

	test('replays one exact claim after database reconstruction', async () => {
		const root = await mkdtemp('/tmp/plebeian-authority-sqlite-')
		roots.push(root)
		const path = join(root, 'authority.sqlite3')
		let database = new Database(path, { create: true, strict: true })
		let store = new DemoIntegratedAuthoritySqliteStore(database)
		await expect(store.claimOutbidReturn(claim('a'))).resolves.toMatchObject({ created: true })
		database.close()
		database = new Database(path, { create: false, strict: true })
		store = new DemoIntegratedAuthoritySqliteStore(database)
		await expect(store.claimOutbidReturn(claim('a'))).resolves.toMatchObject({ created: false, claim: { poolAmount: 2_500 } })
		database.close()
	})

	test('serializes cross-auction claims over the same proof pool so exactly one succeeds', async () => {
		const root = await mkdtemp('/tmp/plebeian-authority-sqlite-')
		roots.push(root)
		const database = new Database(join(root, 'authority.sqlite3'), { create: true, strict: true })
		const store = new DemoIntegratedAuthoritySqliteStore(database)
		const results = await Promise.allSettled([store.claimOutbidReturn(claim('a')), store.claimOutbidReturn(claim('2'))])
		expect(results.filter((value) => value.status === 'fulfilled')).toHaveLength(1)
		expect(results.filter((value) => value.status === 'rejected')).toHaveLength(1)
		database.close()
	})

	test('normalizes compressed proof-Y parity before applying global uniqueness', async () => {
		const root = await mkdtemp('/tmp/plebeian-authority-sqlite-')
		roots.push(root)
		const database = new Database(join(root, 'authority.sqlite3'), { create: true, strict: true })
		const store = new DemoIntegratedAuthoritySqliteStore(database)
		const x = '31'.repeat(32)
		await store.claimOutbidReturn(claim('a', [`02${x}`]))
		await expect(store.claimOutbidReturn(claim('2', [`03${x}`]))).rejects.toThrow(/PROOF_CONFLICT/)
		database.close()
	})

	test('does not leave a partial proof claim when any proof is already owned', async () => {
		const root = await mkdtemp('/tmp/plebeian-authority-sqlite-')
		roots.push(root)
		const database = new Database(join(root, 'authority.sqlite3'), { create: true, strict: true })
		const store = new DemoIntegratedAuthoritySqliteStore(database)
		const shared = `02${'41'.repeat(32)}`
		const free = `03${'42'.repeat(32)}`
		await store.claimOutbidReturn(claim('a', [shared]))
		await expect(store.claimOutbidReturn(claim('2', [free, shared].sort()))).rejects.toThrow(/PROOF_CONFLICT/)
		await expect(store.claimOutbidReturn(claim('3', [free]))).resolves.toMatchObject({ created: true })
		database.close()
	})

	test('persists one monotonic pending/unknown/imported lifecycle and excludes a second terminal branch', async () => {
		const root = await mkdtemp('/tmp/plebeian-authority-sqlite-')
		roots.push(root)
		const database = new Database(join(root, 'authority.sqlite3'), { create: true, strict: true })
		const store = new DemoIntegratedAuthoritySqliteStore(database)
		const held = claim('a')
		await store.claimOutbidReturn(held)
		let lifecycle = await store.readLifecycle(held.operationId)
		expect(lifecycle).toMatchObject({ revision: 0, status: 'outbid_return_pending' })
		lifecycle = await store.transitionLifecycle({
			operationId: held.operationId, expectedRevision: 0, expectedStatus: 'outbid_return_pending', nextStatus: 'execution_pending',
		})
		lifecycle = await store.transitionLifecycle({
			operationId: held.operationId, expectedRevision: lifecycle.revision, expectedStatus: 'execution_pending',
			nextStatus: 'mint_unknown', evidenceDigest: '4'.repeat(64),
		})
		lifecycle = await store.transitionLifecycle({
			operationId: held.operationId, expectedRevision: lifecycle.revision, expectedStatus: 'mint_unknown',
			nextStatus: 'recipient_imported', evidenceDigest: '5'.repeat(64),
		})
		expect(lifecycle).toMatchObject({ revision: 3, status: 'recipient_imported', evidenceDigest: '5'.repeat(64) })
		await expect(store.transitionLifecycle({
			operationId: held.operationId, expectedRevision: lifecycle.revision, expectedStatus: 'recipient_imported', nextStatus: 'quarantined',
		})).rejects.toThrow(/TRANSITION/)
		database.close()
	})
})
