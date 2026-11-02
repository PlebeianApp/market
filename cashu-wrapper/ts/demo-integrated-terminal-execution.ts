/** Durable mint execution/recovery for a V2 terminal authority claim. */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	demoIntegratedExecutionRootBindingV2Digest,
	demoIntegratedProofPoolDigest,
	type DemoIntegratedExecutionRootBindingV2,
	type DemoIntegratedLifecycleRecord,
	type DemoIntegratedLifecycleStatus,
	type DemoIntegratedTerminalAuthorityClaimV2,
	type DemoIntegratedTerminalAuthorityStore,
} from './demo-integrated-authority'
import type {
	DemoIntegratedMaintainerExecutorPort,
	DemoIntegratedRecoveryAuditPort,
	DemoIntegratedRecoveryAuditState,
} from './demo-integrated-outbid-return'
import type {
	DemoMaintainerExactBranchTemplate,
	DemoMaintainerOfflineIdentity,
	DemoMaintainerOfflineRecoveryResult,
	DemoMaintainerOfflineSuccess,
} from './demo-maintainer-offline'
import { demoMaintainerScopeFor } from './demo-maintainer-offline'

export interface DemoIntegratedTerminalExecutionResult {
	lifecycle: DemoIntegratedLifecycleRecord
	outcome?: DemoMaintainerOfflineSuccess
	recovery?: DemoMaintainerOfflineRecoveryResult
}

function evidenceDigest(value: unknown): string { return bytesToHex(sha256(utf8ToBytes(JSON.stringify(value)))) }

async function exactBinding(
	store: DemoIntegratedTerminalAuthorityStore,
	claim: DemoIntegratedTerminalAuthorityClaimV2,
	expected: DemoIntegratedExecutionRootBindingV2,
): Promise<void> {
	const durable = await store.readTerminalExecutionRoot(claim.operationId)
	if (durable === null || JSON.stringify(durable) !== JSON.stringify(expected)
		|| expected.bindingDigest !== demoIntegratedExecutionRootBindingV2Digest(expected)
		|| expected.operationId !== claim.operationId || expected.authorityOperationRoot !== claim.operationRoot
		|| expected.network !== claim.network || expected.chainId !== claim.chainId || expected.auctionId !== claim.auctionId
		|| expected.bidId !== claim.bidId || expected.successorBidId !== claim.successorBidId
		|| expected.cause !== claim.cause || expected.role !== claim.role
		|| expected.outcomeHeight !== claim.outcomeHeight || expected.outcomeStateHash !== claim.outcomeStateHash
		|| expected.outcomeEvidenceDigest !== claim.outcomeEvidenceDigest || expected.templateDigest !== claim.templateDigest
		|| expected.cashuSigAllDigest !== claim.cashuSigAllDigest || expected.outputsDigest !== claim.outputsDigest
		|| expected.proofPoolDigest !== demoIntegratedProofPoolDigest(claim.proofStateRefs)
		|| expected.poolAmount !== claim.poolAmount || expected.admissionReceiptDigest !== claim.admissionReceiptDigest
		|| expected.committeeKeysetId !== claim.committeeKeysetId
		|| expected.committeeKeysetVersion !== claim.committeeKeysetVersion || expected.dkgRunId !== claim.dkgRunId
		|| expected.publicKeyPackageSha256 !== claim.publicKeyPackageSha256
		|| expected.signerRosterDigest !== claim.signerRosterDigest) {
		throw new Error('DEMO_TERMINAL_EXECUTION: durable authority/FROST binding is absent or changed')
	}
}

async function advance(
	store: DemoIntegratedTerminalAuthorityStore,
	record: DemoIntegratedLifecycleRecord,
	nextStatus: DemoIntegratedLifecycleStatus,
	evidence?: string,
): Promise<DemoIntegratedLifecycleRecord> {
	return store.transitionLifecycle({
		operationId: record.claim.operationId, expectedRevision: record.revision,
		expectedStatus: record.status, nextStatus, evidenceDigest: evidence,
	})
}

function exactIdentity(
	identity: DemoMaintainerOfflineIdentity,
	template: DemoMaintainerExactBranchTemplate,
	claim: DemoIntegratedTerminalAuthorityClaimV2,
): DemoMaintainerOfflineIdentity {
	const canonicalScope = demoMaintainerScopeFor(template)
	if (identity.scope !== canonicalScope) throw new Error('DEMO_TERMINAL_EXECUTION: executor scope differs from authority')
	return {
		scope: canonicalScope, bundleDigest: identity.bundleDigest, expectedRole: claim.role,
		expectedOperationId: claim.operationId, expectedOperationRoot: claim.operationRoot,
	}
}

function statusForAudit(state: DemoIntegratedRecoveryAuditState): 'execution_unknown' | 'mint_unknown' | 'retry_ready' | 'recipient_pending' {
	if (state === 'attempting' || state === 'ambiguous') return 'mint_unknown'
	if (state === 'succeeded') return 'recipient_pending'
	if (state === 'retry_ready') return 'retry_ready'
	return 'execution_unknown'
}

function preMint(state: DemoIntegratedRecoveryAuditState): boolean {
	return state === 'absent' || state === 'prepared' || state === 'retry_ready'
}

async function persistAudit(
	store: DemoIntegratedTerminalAuthorityStore,
	lifecycle: DemoIntegratedLifecycleRecord,
	audit: Awaited<ReturnType<DemoIntegratedRecoveryAuditPort['readExact']>>,
): Promise<DemoIntegratedLifecycleRecord> {
	if ((audit.state === 'absent' || audit.state === 'prepared')
		&& (lifecycle.status === 'mint_unknown' || lifecycle.status === 'retry_ready' || lifecycle.status === 'recipient_pending')) {
		return advance(store, lifecycle, 'quarantined', evidenceDigest(audit))
	}
	const next = statusForAudit(audit.state)
	return next === lifecycle.status ? lifecycle : advance(store, lifecycle, next, evidenceDigest(audit))
}

function exactSuccess(claim: DemoIntegratedTerminalAuthorityClaimV2, outcome: DemoMaintainerOfflineSuccess): void {
	const expected = claim.role === 'winner_settlement' ? 'settled' : 'refunded'
	if (outcome.status !== expected || outcome.terminal.responseDigest.length !== 64 || outcome.recipient.imported !== true) {
		throw new Error('DEMO_TERMINAL_EXECUTION: executor did not prove exact terminal recipient import')
	}
}

export async function executeAuthorizedDemoIntegratedTerminal(options: {
	claim: DemoIntegratedTerminalAuthorityClaimV2
	template: DemoMaintainerExactBranchTemplate
	offlineIdentity: DemoMaintainerOfflineIdentity
	store: DemoIntegratedTerminalAuthorityStore
	executor: DemoIntegratedMaintainerExecutorPort
	recoveryAudit: DemoIntegratedRecoveryAuditPort
	executionBinding: DemoIntegratedExecutionRootBindingV2
}): Promise<DemoIntegratedTerminalExecutionResult> {
	const claim = structuredClone(options.claim)
	let lifecycle = await options.store.readLifecycle(claim.operationId)
	if (lifecycle === null || lifecycle.claim.schema !== claim.schema || JSON.stringify(lifecycle.claim) !== JSON.stringify(claim)) {
		throw new Error('DEMO_TERMINAL_EXECUTION: durable lifecycle is missing or differs from terminal authority')
	}
	if (lifecycle.status === 'recipient_imported') return { lifecycle }
	if (lifecycle.status !== 'terminal_pending') throw new Error('DEMO_TERMINAL_EXECUTION: first execution requires terminal_pending')
	await exactBinding(options.store, claim, options.executionBinding)
	lifecycle = await advance(options.store, lifecycle, 'execution_pending')
	try {
		const outcome = await options.executor.executeExact(exactIdentity(options.offlineIdentity, options.template, claim))
		exactSuccess(claim, outcome)
		lifecycle = await advance(options.store, lifecycle, 'recipient_imported', outcome.terminal.responseDigest)
		return { lifecycle, outcome }
	} catch (error) {
		const audit = await options.recoveryAudit.readExact({ scope: options.offlineIdentity.scope, operationRoot: claim.operationRoot })
		lifecycle = await advance(options.store, lifecycle, statusForAudit(audit.state), evidenceDigest(audit))
		throw error
	}
}

export async function recoverDemoIntegratedTerminal(options: {
	operationId: string
	template: DemoMaintainerExactBranchTemplate
	offlineIdentity: DemoMaintainerOfflineIdentity
	store: DemoIntegratedTerminalAuthorityStore
	executor: DemoIntegratedMaintainerExecutorPort
	recoveryAudit: DemoIntegratedRecoveryAuditPort
	executionBinding: DemoIntegratedExecutionRootBindingV2
}): Promise<DemoIntegratedTerminalExecutionResult> {
	let lifecycle = await options.store.readLifecycle(options.operationId)
	if (lifecycle === null || lifecycle.claim.schema !== 'COCO_DEMO_INTEGRATED_TERMINAL_AUTHORITY_CLAIM_V2') {
		throw new Error('DEMO_TERMINAL_EXECUTION: V2 terminal lifecycle is absent')
	}
	const claim = lifecycle.claim
	if (lifecycle.status === 'recipient_imported') return { lifecycle }
	if (lifecycle.status === 'quarantined' || lifecycle.status === 'terminal_pending') {
		throw new Error('DEMO_TERMINAL_EXECUTION: lifecycle is not eligible for recovery')
	}
	await exactBinding(options.store, claim, options.executionBinding)
	const identity = exactIdentity(options.offlineIdentity, options.template, claim)
	const audit = await options.recoveryAudit.readExact({ scope: identity.scope, operationRoot: claim.operationRoot })
	const beforeMint = preMint(audit.state)
	if ((audit.state === 'absent' || audit.state === 'prepared')
		&& lifecycle.status !== 'execution_pending' && lifecycle.status !== 'execution_unknown') {
		await advance(options.store, lifecycle, 'quarantined', evidenceDigest(audit))
		throw new Error('DEMO_TERMINAL_EXECUTION: recovery journal regressed behind authority lifecycle')
	}
	if (!beforeMint || audit.state === 'retry_ready') lifecycle = await persistAudit(options.store, lifecycle, audit)
	try {
		if (beforeMint) {
			const outcome = await options.executor.executeExact(identity)
			exactSuccess(claim, outcome)
			lifecycle = await advance(options.store, lifecycle, 'recipient_imported', outcome.terminal.responseDigest)
			return { lifecycle, outcome }
		}
		const recovery = await options.executor.recoverExact(identity)
		if (recovery.status === 'settled' || recovery.status === 'refunded') {
			exactSuccess(claim, recovery)
			lifecycle = await advance(options.store, lifecycle, 'recipient_imported', recovery.terminal.responseDigest)
			return { lifecycle, outcome: recovery }
		}
		const after = await options.recoveryAudit.readExact({ scope: identity.scope, operationRoot: claim.operationRoot })
		lifecycle = await persistAudit(options.store, lifecycle, after)
		if (lifecycle.status === 'quarantined') throw new Error('DEMO_TERMINAL_EXECUTION: mint recovery regressed')
		return { lifecycle, recovery }
	} catch (error) {
		const after = await options.recoveryAudit.readExact({ scope: identity.scope, operationRoot: claim.operationRoot })
		if (lifecycle.status !== 'quarantined') lifecycle = await persistAudit(options.store, lifecycle, after)
		throw error
	}
}
