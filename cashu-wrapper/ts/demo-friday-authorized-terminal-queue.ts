/**
 * Authenticated bridge from the consensus/FROST authority journals into the
 * persistent Friday payment queue.
 *
 * This module accepts no caller-authored "paid" assertion.  It re-reads the
 * durable consensus claim and execution-root binding, then requires a receipt
 * proving exact outcome selection and threshold authorization were persisted
 * in the encrypted bearer-proof store before queue insertion.
 */
import {
	demoIntegratedExecutionRootBindingDigest,
	demoIntegratedExecutionRootBindingV2Digest,
	type DemoIntegratedAnyAuthorityClaim,
	type DemoIntegratedAnyExecutionRootBinding,
	type DemoIntegratedTerminalAuthorityStore,
} from './demo-integrated-authority'
import {
	DemoFridayCoordinatorSqlite,
	type DemoFridayCoordinatorRecordV2,
	type DemoFridayCoordinatorRollbackAnchorPort,
	type DemoFridayTerminalBranch,
} from './demo-friday-coordinator-runtime'
import type {
	DemoMaintainerOfflineIdentity,
	DemoMaintainerPreparedAuthorizationV1,
} from './demo-maintainer-offline'

const HEX_32 = /^[0-9a-f]{64}$/

export interface DemoFridayPreparedTerminalInputV1 {
	branch: DemoFridayTerminalBranch
	recipientActorId: string
	claim: DemoIntegratedAnyAuthorityClaim
	executionBinding: DemoIntegratedAnyExecutionRootBinding
	offlineIdentity: DemoMaintainerOfflineIdentity
	prepared: DemoMaintainerPreparedAuthorizationV1
}

export interface DemoFridayAuthorizedTerminalQueuePort {
	enqueuePrepared(input: DemoFridayPreparedTerminalInputV1): Promise<DemoFridayCoordinatorRecordV2>
}

function exactBranch(input: DemoFridayPreparedTerminalInputV1): void {
	const { claim, branch, prepared } = input
	if (!/^[0-9a-f]{64}$/.test(input.recipientActorId)) {
		throw new Error('DEMO_FRIDAY_QUEUE_BRANCH: recipient actor is malformed')
	}
	if (claim.schema === 'COCO_DEMO_INTEGRATED_AUTHORITY_CLAIM_V1') {
		if (branch !== 'outbid_return' || claim.status !== 'outbid_return_pending' || prepared.role !== 'refund') {
			throw new Error('DEMO_FRIDAY_QUEUE_BRANCH: V1 displacement is not an outbid return')
		}
		return
	}
	const expected = claim.cause === 'winner' ? 'winner_payout'
		: claim.cause === 'reserve_unmet' ? 'reserve_unmet_return'
			: claim.cause === 'rejected' ? 'rejected_return'
				: claim.cause === 'funding_abort' ? 'funding_abort_return' : 'outbid_return'
	const expectedRole = claim.cause === 'winner' ? 'winner_settlement' : 'refund'
	if (branch !== expected || claim.status !== 'terminal_pending' || prepared.role !== expectedRole) {
		throw new Error('DEMO_FRIDAY_QUEUE_BRANCH: terminal branch differs from committed authority')
	}
}

async function exactDurableAuthority(
	store: DemoIntegratedTerminalAuthorityStore,
	claim: DemoIntegratedAnyAuthorityClaim,
	binding: DemoIntegratedAnyExecutionRootBinding,
): Promise<void> {
	const lifecycle = await store.readLifecycle(claim.operationId)
	if (lifecycle === null || JSON.stringify(lifecycle.claim) !== JSON.stringify(claim)
		|| (claim.schema === 'COCO_DEMO_INTEGRATED_AUTHORITY_CLAIM_V1'
			? lifecycle.status !== 'outbid_return_pending' : lifecycle.status !== 'terminal_pending')) {
		throw new Error('DEMO_FRIDAY_QUEUE_AUTHORITY: durable pending claim is absent or changed')
	}
	if (claim.schema === 'COCO_DEMO_INTEGRATED_AUTHORITY_CLAIM_V1') {
		if (binding.schema !== 'COCO_DEMO_INTEGRATED_EXECUTION_ROOT_BINDING_V1') {
			throw new Error('DEMO_FRIDAY_QUEUE_BINDING: V1 claim has another binding schema')
		}
		const durable = await store.readExecutionRoot(claim.operationId)
		if (durable === null || JSON.stringify(durable) !== JSON.stringify(binding)
			|| binding.bindingDigest !== demoIntegratedExecutionRootBindingDigest(binding)
			|| binding.operationId !== claim.operationId || binding.authorityOperationRoot !== claim.operationRoot
			|| binding.chainId !== claim.chainId) {
			throw new Error('DEMO_FRIDAY_QUEUE_BINDING: durable V1 execution binding is absent or changed')
		}
		return
	}
	if (binding.schema !== 'COCO_DEMO_INTEGRATED_EXECUTION_ROOT_BINDING_V2') {
		throw new Error('DEMO_FRIDAY_QUEUE_BINDING: V2 claim has another binding schema')
	}
	const durable = await store.readTerminalExecutionRoot(claim.operationId)
	if (durable === null || JSON.stringify(durable) !== JSON.stringify(binding)
		|| binding.bindingDigest !== demoIntegratedExecutionRootBindingV2Digest(binding)
		|| binding.operationId !== claim.operationId || binding.authorityOperationRoot !== claim.operationRoot
		|| binding.chainId !== claim.chainId || binding.outcomeHeight !== claim.outcomeHeight
		|| binding.cause !== claim.cause || binding.role !== claim.role) {
		throw new Error('DEMO_FRIDAY_QUEUE_BINDING: durable V2 execution binding is absent or changed')
	}
}

function exactPrepared(input: DemoFridayPreparedTerminalInputV1): void {
	const { claim, offlineIdentity, prepared, executionBinding } = input
	if (prepared.schema !== 'COCO_DEMO_MAINTAINER_PREPARED_AUTHORIZATION_V1'
		|| prepared.scope !== offlineIdentity.scope || prepared.bundleDigest !== offlineIdentity.bundleDigest
		|| prepared.operationId !== claim.operationId || prepared.operationRoot !== claim.operationRoot
		|| prepared.frostOperationRoot !== executionBinding.frostOperationRoot
		|| executionBinding.operationId !== claim.operationId
		|| !HEX_32.test(prepared.bundleDigest) || !HEX_32.test(prepared.selectionRoot)
		|| !HEX_32.test(prepared.authorizationDigest)) {
		throw new Error('DEMO_FRIDAY_QUEUE_PREPARED: durable threshold authorization differs from exact authority')
	}
	if ((offlineIdentity.expectedRole !== undefined && offlineIdentity.expectedRole !== prepared.role)
		|| (offlineIdentity.expectedOperationId !== undefined && offlineIdentity.expectedOperationId !== prepared.operationId)
		|| (offlineIdentity.expectedOperationRoot !== undefined && offlineIdentity.expectedOperationRoot !== prepared.operationRoot)
		|| offlineIdentity.expectedFrostOperationRoot !== prepared.frostOperationRoot) {
		throw new Error('DEMO_FRIDAY_QUEUE_PREPARED: offline identity differs from prepared authorization')
	}
}

export function createDemoFridayAuthorizedTerminalQueue(options: {
	authorityStore: DemoIntegratedTerminalAuthorityStore
	coordinatorStore: DemoFridayCoordinatorSqlite
	rollbackAnchor: DemoFridayCoordinatorRollbackAnchorPort
	preparedReader: {
		readPreparedExact(identity: DemoMaintainerOfflineIdentity): Promise<DemoMaintainerPreparedAuthorizationV1>
	}
}): DemoFridayAuthorizedTerminalQueuePort {
	const readPreparedExact = options.preparedReader.readPreparedExact.bind(options.preparedReader)
	return Object.freeze({
		async enqueuePrepared(inputValue: DemoFridayPreparedTerminalInputV1): Promise<DemoFridayCoordinatorRecordV2> {
			options.rollbackAnchor.observeExact(options.coordinatorStore.anchorSnapshot())
			const input = structuredClone(inputValue)
			exactBranch(input)
			exactPrepared(input)
			await exactDurableAuthority(options.authorityStore, input.claim, input.executionBinding)
			const reread = await readPreparedExact(structuredClone(input.offlineIdentity))
			if (JSON.stringify(reread) !== JSON.stringify(input.prepared)) {
				throw new Error('DEMO_FRIDAY_QUEUE_PREPARED: private durable authorization changed before enqueue')
			}
			const queued = options.coordinatorStore.enqueueAuthorized({
				scope: input.prepared.scope, authorityOperationId: input.claim.operationId,
				paymentOperationId: input.prepared.operationId, recipientActorId: input.recipientActorId,
				operationRoot: input.prepared.operationRoot,
				frostOperationRoot: input.prepared.frostOperationRoot!,
				bundleDigest: input.prepared.bundleDigest, branch: input.branch, chainId: input.claim.chainId,
				executionBindingDigest: input.executionBinding.bindingDigest,
				preparedAuthorizationDigest: input.prepared.authorizationDigest,
				selectionRoot: input.prepared.selectionRoot,
				outcomeHeight: input.claim.schema === 'COCO_DEMO_INTEGRATED_AUTHORITY_CLAIM_V1'
					? input.claim.displacementHeight : input.claim.outcomeHeight,
			})
			options.rollbackAnchor.observeExact(options.coordinatorStore.anchorSnapshot())
			return queued
		},
	})
}
