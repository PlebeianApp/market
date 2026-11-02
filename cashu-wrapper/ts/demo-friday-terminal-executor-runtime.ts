/** Persistent exact terminal executor behind the non-networked Friday queue. */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import type {
	DemoIntegratedAnyAuthorityClaim,
	DemoIntegratedAnyExecutionRootBinding,
	DemoIntegratedTerminalAuthorityStore,
} from './demo-integrated-authority'
import type { DemoFridayCoordinatorPorts, DemoFridayCoordinatorRecordV2 } from './demo-friday-coordinator-runtime'
import {
	executeAuthorizedDemoIntegratedOutbidReturn,
	recoverDemoIntegratedOutbidReturn,
	type DemoIntegratedRecoveryAuditPort,
} from './demo-integrated-outbid-return'
import {
	executeAuthorizedDemoIntegratedTerminal,
	recoverDemoIntegratedTerminal,
} from './demo-integrated-terminal-execution'
import type { DemoMaintainerFederationPort } from './demo-maintainer-federation'
import {
	createDemoMaintainerOfflineExecutor,
	type DemoMaintainerExactBranchTemplate,
	type DemoMaintainerOfflineIdentity,
	type DemoMaintainerOfflineStore,
	type DemoMaintainerRecipientDeliveryPort,
	type DemoMaintainerPreparedAuthorizationV1,
} from './demo-maintainer-offline'
import type {
	DemoSigAllRecoveryMintStatePort,
	DemoSigAllRecoveryRecord,
	DemoSigAllRecoveryStore,
	DemoSigAllTerminalResponsePort,
} from './demo-sigall-recovery'
import type { DemoSigAllMintPort } from './demo-sigall-settlement'
import {
	createDemoFridayFundingAbortCapsuleExecutor,
} from './demo-friday-funding-abort-capsule-executor'
import type {
	DemoFridayFundingAbortCapsuleStore,
	DemoFridayFundingAbortCapsuleTerminalStore,
} from './demo-friday-funding-abort-capsule'

function digest(value: unknown): string { return bytesToHex(sha256(utf8ToBytes(JSON.stringify(value)))) }

function recoveryAudit(store: DemoSigAllRecoveryStore): DemoIntegratedRecoveryAuditPort {
	return {
		async readExact(request) {
			const record = await store.read(request.scope)
			if (record === null) return { state: 'absent' as const }
			if (record.operationRoot !== request.operationRoot) throw new Error('DEMO_FRIDAY_EXECUTOR_RECOVERY: operation root changed')
			return {
				state: record.state, requestDigest: record.requestDigest,
				...(record.terminal === undefined ? {} : { terminalResponseDigest: record.terminal.responseDigest }),
			}
		},
	}
}

function exactBranch(record: DemoFridayCoordinatorRecordV2, claim: DemoIntegratedAnyAuthorityClaim): 'winner_settlement' | 'refund' {
	if (record.authorityOperationId !== claim.operationId || record.operationRoot !== claim.operationRoot
		|| record.chainId !== claim.chainId || record.outcomeHeight !== (claim.schema === 'COCO_DEMO_INTEGRATED_AUTHORITY_CLAIM_V1'
			? claim.displacementHeight : claim.outcomeHeight)) {
		throw new Error('DEMO_FRIDAY_EXECUTOR_AUTHORITY: queue identity differs from durable authority')
	}
	if (claim.schema === 'COCO_DEMO_INTEGRATED_AUTHORITY_CLAIM_V1') {
		if (record.branch !== 'outbid_return') throw new Error('DEMO_FRIDAY_EXECUTOR_BRANCH: V1 authority is not an outbid return')
		return 'refund'
	}
	const expected = claim.cause === 'winner' ? 'winner_payout'
		: claim.cause === 'reserve_unmet' ? 'reserve_unmet_return'
			: claim.cause === 'rejected' ? 'rejected_return'
				: claim.cause === 'funding_abort' ? 'funding_abort_return' : 'outbid_return'
	if (record.branch !== expected) throw new Error('DEMO_FRIDAY_EXECUTOR_BRANCH: queue branch differs from terminal cause')
	return claim.role
}

async function exactBinding(
	store: DemoIntegratedTerminalAuthorityStore,
	record: DemoFridayCoordinatorRecordV2,
	claim: DemoIntegratedAnyAuthorityClaim,
): Promise<DemoIntegratedAnyExecutionRootBinding> {
	const binding = claim.schema === 'COCO_DEMO_INTEGRATED_AUTHORITY_CLAIM_V1'
		? await store.readExecutionRoot(claim.operationId)
		: await store.readTerminalExecutionRoot(claim.operationId)
	if (binding === null || binding.bindingDigest !== record.executionBindingDigest
		|| binding.operationId !== claim.operationId || binding.authorityOperationRoot !== claim.operationRoot
		|| binding.frostOperationRoot !== record.frostOperationRoot) {
		throw new Error('DEMO_FRIDAY_EXECUTOR_BINDING: exact authority/FROST binding is absent or changed')
	}
	return binding
}

function preparedMatches(record: DemoFridayCoordinatorRecordV2, prepared: DemoMaintainerPreparedAuthorizationV1): void {
	if (prepared.scope !== record.scope || prepared.bundleDigest !== record.bundleDigest
		|| prepared.operationId !== record.paymentOperationId || prepared.operationRoot !== record.operationRoot
		|| prepared.authorizationDigest !== record.preparedAuthorizationDigest
		|| prepared.selectionRoot !== record.selectionRoot
		|| prepared.frostOperationRoot !== record.frostOperationRoot) {
		throw new Error('DEMO_FRIDAY_EXECUTOR_PREPARED: encrypted threshold authorization differs from queue')
	}
}

function recipientImportDigest(record: DemoFridayCoordinatorRecordV2, terminalResponseDigest: string): string {
	return digest([
		'PLEBEIAN_FRIDAY_RECIPIENT_IMPORT_V1', record.deploymentId, record.scope,
		record.operationRoot, record.selectionRoot, terminalResponseDigest,
	])
}

function exactRecovery(record: DemoFridayCoordinatorRecordV2, recovery: DemoSigAllRecoveryRecord | null): DemoSigAllRecoveryRecord {
	if (recovery === null || recovery.scope !== record.scope || recovery.operationRoot !== record.operationRoot) {
		throw new Error('DEMO_FRIDAY_EXECUTOR_RECOVERY: exact durable mint operation is absent')
	}
	return recovery
}

export function createDemoFridayTerminalExecutorPorts(options: {
	authorityStore: DemoIntegratedTerminalAuthorityStore
	offlineStore: DemoMaintainerOfflineStore
	abortCapsules?: DemoFridayFundingAbortCapsuleStore
	abortCapsuleTerminalStore?: DemoFridayFundingAbortCapsuleTerminalStore
	recoveryStore: DemoSigAllRecoveryStore
	mint: DemoSigAllMintPort
	recovery: DemoSigAllRecoveryMintStatePort
	terminalResponse: DemoSigAllTerminalResponsePort
	recipientFor(template: DemoMaintainerExactBranchTemplate, recipientActorId: string): DemoMaintainerRecipientDeliveryPort
	now?: () => number
	nowSeconds?: () => number
}): DemoFridayCoordinatorPorts {
	const audit = recoveryAudit(options.recoveryStore)
	async function context(recordValue: Readonly<DemoFridayCoordinatorRecordV2>) {
		const record = structuredClone(recordValue)
		const lifecycle = await options.authorityStore.readLifecycle(record.authorityOperationId)
		if (lifecycle === null) throw new Error('DEMO_FRIDAY_EXECUTOR_AUTHORITY: lifecycle is absent')
		const claim = lifecycle.claim
		const role = exactBranch(record, claim)
		const binding = await exactBinding(options.authorityStore, record, claim)
		if (claim.schema === 'COCO_DEMO_INTEGRATED_TERMINAL_AUTHORITY_CLAIM_V2'
			&& claim.cause === 'funding_abort') {
			if (options.abortCapsules === undefined || options.abortCapsuleTerminalStore === undefined) {
				throw new Error('DEMO_FRIDAY_EXECUTOR_PRIVATE: FundingAbort capsule stores are unavailable')
			}
			const capsule = await options.abortCapsules.readByOperationExact(record.paymentOperationId)
			const template = capsule.refund
			if (capsule.capsuleDigest !== record.bundleDigest || template.role !== 'refund'
				|| template.operationId !== record.paymentOperationId || template.templateDigest !== record.operationRoot) {
				throw new Error('DEMO_FRIDAY_EXECUTOR_PRIVATE: exact abort capsule differs from queue')
			}
			const identity: DemoMaintainerOfflineIdentity = {
				scope: record.scope, bundleDigest: record.bundleDigest, expectedRole: 'refund',
				expectedOperationId: record.paymentOperationId, expectedOperationRoot: record.operationRoot,
				expectedFrostOperationRoot: record.frostOperationRoot,
			}
			const executor = createDemoFridayFundingAbortCapsuleExecutor({
				capsules: options.abortCapsules, terminalStore: options.abortCapsuleTerminalStore,
				recoveryStore: options.recoveryStore, mint: options.mint, recovery: options.recovery,
				terminalResponse: options.terminalResponse, recipientActorId: record.recipientActorId,
				recipientFor: options.recipientFor,
				...(options.now === undefined ? {} : { now: options.now }),
				...(options.nowSeconds === undefined ? {} : { nowSeconds: options.nowSeconds }),
			})
			preparedMatches(record, await executor.readPreparedExact(identity))
			return { record, lifecycle, claim, template, identity, executor, binding }
		}
		const held = await options.offlineStore.loadExact(record.scope, record.bundleDigest)
		if (held === null) throw new Error('DEMO_FRIDAY_EXECUTOR_PRIVATE: encrypted exact bundle is absent')
		const template = role === 'winner_settlement' ? held.bundle.winner : held.bundle.refund
		if (template.role !== role || template.operationId !== record.paymentOperationId
			|| template.templateDigest !== record.operationRoot || held.bundle.bundleDigest !== record.bundleDigest) {
			throw new Error('DEMO_FRIDAY_EXECUTOR_PRIVATE: selected exact template differs from queue')
		}
		const identity: DemoMaintainerOfflineIdentity = {
			scope: record.scope, bundleDigest: record.bundleDigest, expectedRole: role,
			expectedOperationId: record.paymentOperationId, expectedOperationRoot: record.operationRoot,
			expectedFrostOperationRoot: record.frostOperationRoot,
		}
		const noFederation: DemoMaintainerFederationPort = {
			async authorize() { throw new Error('DEMO_FRIDAY_EXECUTOR_SIGNING: queued operation lacks durable prior authorization') },
		}
		const executor = createDemoMaintainerOfflineExecutor({
			store: options.offlineStore,
			outcomes: { async readExact() { throw new Error('DEMO_FRIDAY_EXECUTOR_OUTCOME: queued operation lacks durable prior selection') } },
			federation: noFederation, recoveryStore: options.recoveryStore, mint: options.mint,
			recovery: options.recovery, terminalResponse: options.terminalResponse,
			recipient: options.recipientFor(template, record.recipientActorId),
			...(options.now === undefined ? {} : { now: options.now }),
			...(options.nowSeconds === undefined ? {} : { nowSeconds: options.nowSeconds }),
		})
		preparedMatches(record, await executor.readPreparedExact(identity))
		return { record, lifecycle, claim, template, identity, executor, binding }
	}

	async function terminalDigest(record: DemoFridayCoordinatorRecordV2): Promise<{ requestDigest: string; terminalResponseDigest: string }> {
		const recovery = exactRecovery(record, await options.recoveryStore.read(record.scope))
		if (recovery.terminal === undefined) throw new Error('DEMO_FRIDAY_EXECUTOR_RECOVERY: terminal response is absent')
		return { requestDigest: recovery.requestDigest, terminalResponseDigest: recovery.terminal.responseDigest }
	}

	const ports: DemoFridayCoordinatorPorts = {
		async executeExact(recordValue) {
			const held = await context(recordValue)
			if (held.claim.schema === 'COCO_DEMO_INTEGRATED_AUTHORITY_CLAIM_V1') {
				if (held.binding.schema !== 'COCO_DEMO_INTEGRATED_EXECUTION_ROOT_BINDING_V1') throw new Error('DEMO_FRIDAY_EXECUTOR_BINDING: V1 schema changed')
				await executeAuthorizedDemoIntegratedOutbidReturn({
					claim: held.claim, template: held.template, offlineIdentity: held.identity,
					store: options.authorityStore, executor: held.executor, recoveryAudit: audit,
					executionBinding: held.binding,
				})
			} else {
				if (held.binding.schema !== 'COCO_DEMO_INTEGRATED_EXECUTION_ROOT_BINDING_V2') throw new Error('DEMO_FRIDAY_EXECUTOR_BINDING: V2 schema changed')
				await executeAuthorizedDemoIntegratedTerminal({
					claim: held.claim, template: held.template, offlineIdentity: held.identity,
					store: options.authorityStore, executor: held.executor, recoveryAudit: audit,
					executionBinding: held.binding,
				})
			}
			const terminal = await terminalDigest(held.record)
			return {
				status: 'completed', ...terminal,
				recipientImportDigest: recipientImportDigest(held.record, terminal.terminalResponseDigest),
			}
		},
		async recoverExact(recordValue) {
			const held = await context(recordValue)
			const recovery = await options.recoveryStore.read(held.record.scope)
			if ((held.lifecycle.status === 'outbid_return_pending' || held.lifecycle.status === 'terminal_pending')
				&& (recovery === null || recovery.state === 'prepared' || recovery.state === 'retry_ready')) {
				return { status: 'retry_ready' }
			}
			if (held.claim.schema === 'COCO_DEMO_INTEGRATED_AUTHORITY_CLAIM_V1') {
				if (held.binding.schema !== 'COCO_DEMO_INTEGRATED_EXECUTION_ROOT_BINDING_V1') throw new Error('DEMO_FRIDAY_EXECUTOR_BINDING: V1 schema changed')
				await recoverDemoIntegratedOutbidReturn({
					operationId: held.claim.operationId, template: held.template, offlineIdentity: held.identity,
					store: options.authorityStore, executor: held.executor, recoveryAudit: audit,
					executionBinding: held.binding,
				})
			} else {
				if (held.binding.schema !== 'COCO_DEMO_INTEGRATED_EXECUTION_ROOT_BINDING_V2') throw new Error('DEMO_FRIDAY_EXECUTOR_BINDING: V2 schema changed')
				await recoverDemoIntegratedTerminal({
					operationId: held.claim.operationId, template: held.template, offlineIdentity: held.identity,
					store: options.authorityStore, executor: held.executor, recoveryAudit: audit,
					executionBinding: held.binding,
				})
			}
			const lifecycle = await options.authorityStore.readLifecycle(held.claim.operationId)
			if (lifecycle?.status !== 'recipient_imported') return { status: 'indeterminate' }
			const terminal = await terminalDigest(held.record)
			return { status: 'recipient_pending', terminalResponseDigest: terminal.terminalResponseDigest }
		},
		async importExact(recordValue) {
			const held = await context(recordValue)
			const lifecycle = await options.authorityStore.readLifecycle(held.claim.operationId)
			if (lifecycle?.status !== 'recipient_imported') throw new Error('DEMO_FRIDAY_EXECUTOR_IMPORT: authority has no exact recipient import')
			const terminal = await terminalDigest(held.record)
			return { recipientImportDigest: recipientImportDigest(held.record, terminal.terminalResponseDigest) }
		},
	}
	return Object.freeze(ports)
}
