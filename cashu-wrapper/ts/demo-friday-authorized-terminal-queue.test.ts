import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import {
	demoIntegratedExecutionRootBindingDigest,
	demoIntegratedProofPoolDigest,
	type DemoIntegratedAuthorityClaim,
	type DemoIntegratedExecutionRootBindingV1,
} from './demo-integrated-authority'
import { DemoIntegratedAuthoritySqliteStore } from './demo-integrated-authority-sqlite'
import { createDemoFridayAuthorizedTerminalQueue } from './demo-friday-authorized-terminal-queue'
import { DemoFridayCoordinatorRollbackAnchorSqlite } from './demo-friday-coordinator-rollback-anchor'
import { DemoFridayCoordinatorSqlite } from './demo-friday-coordinator-runtime'
import type { DemoMaintainerPreparedAuthorizationV1 } from './demo-maintainer-offline'

const h = (value: string): string => value.repeat(64)

function claim(): DemoIntegratedAuthorityClaim {
	return {
		schema: 'COCO_DEMO_INTEGRATED_AUTHORITY_CLAIM_V1', operationId: h('a'), operationRoot: h('b'),
		network: 'fake-only', chainId: 'friday-chain', auctionId: 'auction-a', displacedBidId: 'bid-a',
		replacementBidId: 'bid-b', displacementHeight: 42, templateDigest: h('b'), cashuSigAllDigest: h('c'),
		outputsDigest: h('d'), proofStateRefs: [`02${'31'.repeat(32)}`], poolAmount: 2_500,
		admissionOperationId: h('a'), admissionReceiptDigest: h('e'), committeeKeysetId: 'committee-1',
		committeeKeysetVersion: '1', dkgRunId: 'dkg-1', publicKeyPackageSha256: h('f'),
		signerRosterDigest: h('1'), status: 'outbid_return_pending',
	}
}

function binding(authority: DemoIntegratedAuthorityClaim): DemoIntegratedExecutionRootBindingV1 {
	const stable: Omit<DemoIntegratedExecutionRootBindingV1, 'bindingDigest'> = {
		schema: 'COCO_DEMO_INTEGRATED_EXECUTION_ROOT_BINDING_V1', operationId: authority.operationId,
		authorityOperationRoot: authority.operationRoot, frostOperationRoot: h('2'), network: authority.network,
		chainId: authority.chainId, auctionId: authority.auctionId, displacedBidId: authority.displacedBidId,
		replacementBidId: authority.replacementBidId, displacementHeight: authority.displacementHeight,
		templateDigest: authority.templateDigest, cashuSigAllDigest: authority.cashuSigAllDigest,
		outputsDigest: authority.outputsDigest, proofPoolDigest: demoIntegratedProofPoolDigest(authority.proofStateRefs),
		poolAmount: authority.poolAmount, admissionReceiptDigest: authority.admissionReceiptDigest,
		committeeKeysetId: authority.committeeKeysetId, committeeKeysetVersion: authority.committeeKeysetVersion,
		dkgRunId: authority.dkgRunId, publicKeyPackageSha256: authority.publicKeyPackageSha256,
		signerRosterDigest: authority.signerRosterDigest, processRosterDigest: h('3'), policyPackageDigest: h('4'),
	}
	return { ...stable, bindingDigest: demoIntegratedExecutionRootBindingDigest(stable) }
}

function prepared(): DemoMaintainerPreparedAuthorizationV1 {
	return {
		schema: 'COCO_DEMO_MAINTAINER_PREPARED_AUTHORIZATION_V1', scope: 'auction-a:bid-a',
		bundleDigest: h('5'), selectionRoot: h('6'), authorizationDigest: h('7'),
		operationId: h('a'), operationRoot: h('b'), frostOperationRoot: h('2'), role: 'refund',
	}
}

async function opened() {
	const authorityDb = new Database(':memory:', { strict: true })
	const coordinatorDb = new Database(':memory:', { strict: true })
	const anchorDb = new Database(':memory:', { strict: true })
	const authorityStore = new DemoIntegratedAuthoritySqliteStore(authorityDb)
	const coordinatorStore = new DemoFridayCoordinatorSqlite(coordinatorDb, 'friday-blue-20261023')
	const authority = claim(); const executionBinding = binding(authority); const durable = prepared()
	await authorityStore.claimOutbidReturn(authority); await authorityStore.bindExecutionRoot(executionBinding)
	let privateDurable = structuredClone(durable)
	const rollbackAnchor = new DemoFridayCoordinatorRollbackAnchorSqlite(anchorDb, true)
	rollbackAnchor.observeExact(coordinatorStore.anchorSnapshot())
	return {
		authorityDb, coordinatorDb, anchorDb, authorityStore, coordinatorStore, authority, executionBinding, durable,
		setPrivateDurable(value: DemoMaintainerPreparedAuthorizationV1) { privateDurable = structuredClone(value) },
		queue: createDemoFridayAuthorizedTerminalQueue({
			authorityStore, coordinatorStore, rollbackAnchor,
			preparedReader: { async readPreparedExact() { return structuredClone(privateDurable) } },
		}),
		input: {
			branch: 'outbid_return' as const, recipientActorId: h('9'), claim: authority, executionBinding,
			offlineIdentity: {
				scope: durable.scope, bundleDigest: durable.bundleDigest, expectedRole: 'refund' as const,
				expectedOperationId: authority.operationId, expectedOperationRoot: authority.operationRoot,
				expectedFrostOperationRoot: executionBinding.frostOperationRoot,
			},
			prepared: durable,
		},
	}
}

describe('authenticated authority-to-Friday-queue bridge', () => {
	test('enqueues only after exact consensus claim, FROST binding, and private durable authorization agree', async () => {
		const held = await opened()
		try {
			const queued = await held.queue.enqueuePrepared(held.input)
			expect(queued).toMatchObject({
				schema: 'PLEBEIAN_FRIDAY_COORDINATOR_RECORD_V2', phase: 'queued', branch: 'outbid_return',
				recipientActorId: h('9'),
				authorityOperationId: held.authority.operationId, paymentOperationId: held.durable.operationId,
				executionBindingDigest: held.executionBinding.bindingDigest,
				preparedAuthorizationDigest: held.durable.authorizationDigest, selectionRoot: held.durable.selectionRoot,
			})
			expect(await held.authorityStore.readLifecycle(held.authority.operationId))
				.toMatchObject({ status: 'outbid_return_pending', revision: 0 })
			expect(await held.queue.enqueuePrepared(held.input)).toEqual(queued)
		} finally { held.anchorDb.close(false); held.coordinatorDb.close(false); held.authorityDb.close(false) }
	})

	test('rejects caller receipt substitution and a changed durable private authorization before queue insertion', async () => {
		const held = await opened()
		try {
			await expect(held.queue.enqueuePrepared({
				...held.input,
				prepared: { ...held.durable, frostOperationRoot: h('8') },
			})).rejects.toThrow(/differs from exact authority/)
			await expect(held.queue.enqueuePrepared({
				...held.input, prepared: { ...held.durable, authorizationDigest: h('8') },
			})).rejects.toThrow(/private durable authorization changed/)
			held.setPrivateDurable({ ...held.durable, selectionRoot: h('9') })
			await expect(held.queue.enqueuePrepared(held.input)).rejects.toThrow(/private durable authorization changed/)
			expect(held.coordinatorStore.listNonterminal()).toHaveLength(0)
		} finally { held.anchorDb.close(false); held.coordinatorDb.close(false); held.authorityDb.close(false) }
	})

	test('rejects branch substitution and a non-pending authority lifecycle before effects', async () => {
		const held = await opened()
		try {
			await expect(held.queue.enqueuePrepared({ ...held.input, branch: 'winner_payout' }))
				.rejects.toThrow(/not an outbid return/)
			await held.authorityStore.transitionLifecycle({
				operationId: held.authority.operationId, expectedRevision: 0,
				expectedStatus: 'outbid_return_pending', nextStatus: 'execution_pending',
			})
			await expect(held.queue.enqueuePrepared(held.input)).rejects.toThrow(/pending claim is absent or changed/)
			expect(held.coordinatorStore.listNonterminal()).toHaveLength(0)
		} finally { held.anchorDb.close(false); held.coordinatorDb.close(false); held.authorityDb.close(false) }
	})
})
