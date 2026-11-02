/**
 * Non-test composition for one cooperative outbid return.
 *
 * Consensus authorization, the exact template/FROST operation root, durable
 * mint recovery and recipient import all use the same operation identity. The
 * SQLite authority lifecycle is not represented as cross-database atomicity:
 * after a crash, the recovery journal is inspected and the exact operation is
 * resumed or quarantined. A fresh payment is never inferred from an absent UI
 * result.
 */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	authorizeDemoCooperativeOutbidReturn,
	demoIntegratedExecutionRootBindingDigest,
	demoIntegratedProofPoolDigest,
	type DemoCertifiedDisplacementV1,
	type DemoCertifiedDisplacementVerifierPort,
	type DemoIntegratedAuthorityClaim,
	type DemoIntegratedAuthorityStore,
	type DemoIntegratedExecutionRootBindingV1,
	type DemoIntegratedLifecycleRecord,
	type DemoIntegratedLifecycleStatus,
} from './demo-integrated-authority'
import type {
	DemoMaintainerExactBranchTemplate,
	DemoMaintainerOfflineIdentity,
	DemoMaintainerOfflineRecoveryResult,
	DemoMaintainerOfflineSuccess,
} from './demo-maintainer-offline'
import { demoMaintainerScopeFor } from './demo-maintainer-offline'

export type DemoIntegratedRecoveryAuditState =
	| 'absent'
	| 'prepared'
	| 'attempting'
	| 'ambiguous'
	| 'retry_ready'
	| 'succeeded'

export interface DemoIntegratedRecoveryAuditPort {
	/** Read the durable SIG_ALL recovery row for this exact operation root. */
	readExact(request: { scope: string; operationRoot: string }): Promise<{
		state: DemoIntegratedRecoveryAuditState
		requestDigest?: string
		terminalResponseDigest?: string
	}>
}

export interface DemoIntegratedMaintainerExecutorPort {
	executeExact(identity: DemoMaintainerOfflineIdentity): Promise<DemoMaintainerOfflineSuccess>
	recoverExact(identity: DemoMaintainerOfflineIdentity): Promise<DemoMaintainerOfflineRecoveryResult>
}

export interface DemoIntegratedOutbidReturnResult {
	lifecycle: DemoIntegratedLifecycleRecord
	outcome?: DemoMaintainerOfflineSuccess
	recovery?: DemoMaintainerOfflineRecoveryResult
}

function evidenceDigest(value: unknown): string {
	return bytesToHex(sha256(utf8ToBytes(JSON.stringify(value))))
}

async function exactExecutionBinding(
	store: DemoIntegratedAuthorityStore,
	claim: DemoIntegratedLifecycleRecord['claim'],
	expected: DemoIntegratedExecutionRootBindingV1,
): Promise<DemoIntegratedExecutionRootBindingV1> {
	if (claim.schema !== 'COCO_DEMO_INTEGRATED_AUTHORITY_CLAIM_V1') {
		throw new Error('DEMO_INTEGRATED_COMPOSITION: outbid-only executor received a V2 terminal claim')
	}
	const durable = await store.readExecutionRoot(claim.operationId)
	const stable = {
		schema: expected.schema, operationId: expected.operationId,
		authorityOperationRoot: expected.authorityOperationRoot, frostOperationRoot: expected.frostOperationRoot,
		network: expected.network, chainId: expected.chainId, auctionId: expected.auctionId,
		displacedBidId: expected.displacedBidId, replacementBidId: expected.replacementBidId,
		displacementHeight: expected.displacementHeight, templateDigest: expected.templateDigest,
		cashuSigAllDigest: expected.cashuSigAllDigest, outputsDigest: expected.outputsDigest,
		proofPoolDigest: expected.proofPoolDigest, poolAmount: expected.poolAmount,
		admissionReceiptDigest: expected.admissionReceiptDigest,
		committeeKeysetId: expected.committeeKeysetId, committeeKeysetVersion: expected.committeeKeysetVersion,
		dkgRunId: expected.dkgRunId, publicKeyPackageSha256: expected.publicKeyPackageSha256,
		signerRosterDigest: expected.signerRosterDigest, processRosterDigest: expected.processRosterDigest,
		policyPackageDigest: expected.policyPackageDigest,
	} satisfies Omit<DemoIntegratedExecutionRootBindingV1, 'bindingDigest'>
	if (durable === null || JSON.stringify(durable) !== JSON.stringify(expected)
		|| expected.bindingDigest !== demoIntegratedExecutionRootBindingDigest(stable)
		|| expected.operationId !== claim.operationId || expected.authorityOperationRoot !== claim.operationRoot
		|| expected.network !== claim.network || expected.chainId !== claim.chainId || expected.auctionId !== claim.auctionId
		|| expected.displacedBidId !== claim.displacedBidId || expected.replacementBidId !== claim.replacementBidId
		|| expected.displacementHeight !== claim.displacementHeight || expected.templateDigest !== claim.templateDigest
		|| expected.cashuSigAllDigest !== claim.cashuSigAllDigest || expected.outputsDigest !== claim.outputsDigest
		|| expected.proofPoolDigest !== demoIntegratedProofPoolDigest(claim.proofStateRefs)
		|| expected.poolAmount !== claim.poolAmount || expected.admissionReceiptDigest !== claim.admissionReceiptDigest
		|| expected.committeeKeysetId !== claim.committeeKeysetId
		|| expected.committeeKeysetVersion !== claim.committeeKeysetVersion
		|| expected.dkgRunId !== claim.dkgRunId || expected.publicKeyPackageSha256 !== claim.publicKeyPackageSha256
		|| expected.signerRosterDigest !== claim.signerRosterDigest) {
		throw new Error('DEMO_INTEGRATED_COMPOSITION: durable authority/FROST execution-root binding is absent or changed')
	}
	return structuredClone(durable)
}

async function advance(
	store: DemoIntegratedAuthorityStore,
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
	record: DemoIntegratedLifecycleRecord,
): DemoMaintainerOfflineIdentity {
	const canonicalScope = demoMaintainerScopeFor(template)
	if (identity.scope !== canonicalScope) {
		throw new Error('DEMO_INTEGRATED_COMPOSITION: executor scope differs from the consensus-authorized operation')
	}
	return {
		scope: canonicalScope, bundleDigest: identity.bundleDigest, expectedRole: 'refund',
		expectedOperationId: record.claim.admissionOperationId,
		expectedOperationRoot: record.claim.operationRoot,
	}
}

function statusForAudit(state: DemoIntegratedRecoveryAuditState): 'execution_unknown' | 'mint_unknown' | 'retry_ready' | 'recipient_pending' {
	if (state === 'attempting' || state === 'ambiguous') return 'mint_unknown'
	if (state === 'succeeded') return 'recipient_pending'
	if (state === 'retry_ready') return 'retry_ready'
	return 'execution_unknown'
}

function preMintAudit(state: DemoIntegratedRecoveryAuditState): boolean {
	return state === 'absent' || state === 'prepared' || state === 'retry_ready'
}

async function persistObservedAudit(
	store: DemoIntegratedAuthorityStore,
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

/**
 * Compose the first execution attempt. `mint_unknown` means exactly that; a
 * pre-mint signing failure is retained as `execution_unknown` instead.
 */
export async function executeDemoIntegratedOutbidReturn(options: {
	certificate: DemoCertifiedDisplacementV1
	template: DemoMaintainerExactBranchTemplate
	offlineIdentity: DemoMaintainerOfflineIdentity
	displacementVerifier: DemoCertifiedDisplacementVerifierPort
	store: DemoIntegratedAuthorityStore
	executor: DemoIntegratedMaintainerExecutorPort
	recoveryAudit: DemoIntegratedRecoveryAuditPort
	executionBinding: DemoIntegratedExecutionRootBindingV1
	nowSeconds: number
}): Promise<DemoIntegratedOutbidReturnResult> {
	const claim = await authorizeDemoCooperativeOutbidReturn(options)
	return executeAuthorizedDemoIntegratedOutbidReturn({ ...options, claim })
}

/**
 * Low-level execution after this exact claim was derived from participant-local
 * history and durably claimed. It is exported only so the concrete service can
 * avoid a second moving-height Comet query between authorization and signing.
 */
export async function executeAuthorizedDemoIntegratedOutbidReturn(options: {
	claim: DemoIntegratedAuthorityClaim
	template: DemoMaintainerExactBranchTemplate
	offlineIdentity: DemoMaintainerOfflineIdentity
	store: DemoIntegratedAuthorityStore
	executor: DemoIntegratedMaintainerExecutorPort
	recoveryAudit: DemoIntegratedRecoveryAuditPort
	executionBinding: DemoIntegratedExecutionRootBindingV1
}): Promise<DemoIntegratedOutbidReturnResult> {
	const claim = structuredClone(options.claim)
	let lifecycle = await options.store.readLifecycle(claim.operationId)
	if (lifecycle === null || JSON.stringify(lifecycle.claim) !== JSON.stringify(claim)) {
		throw new Error('DEMO_INTEGRATED_COMPOSITION: durable lifecycle is missing or differs from authority')
	}
	if (lifecycle.status === 'recipient_imported') return { lifecycle }
	if (lifecycle.status !== 'outbid_return_pending') {
		throw new Error('DEMO_INTEGRATED_COMPOSITION: first execution requires a newly pending authorized return')
	}
	await exactExecutionBinding(options.store, lifecycle.claim, options.executionBinding)
	lifecycle = await advance(options.store, lifecycle, 'execution_pending')
	try {
		const outcome = await options.executor.executeExact(exactIdentity(options.offlineIdentity, options.template, lifecycle))
		if (outcome.status !== 'refunded' || outcome.terminal.responseDigest.length !== 64 || outcome.recipient.imported !== true) {
			throw new Error('DEMO_INTEGRATED_COMPOSITION: executor did not prove exact refund import')
		}
		lifecycle = await advance(options.store, lifecycle, 'recipient_imported', outcome.terminal.responseDigest)
		return { lifecycle, outcome }
	} catch (error) {
		const audit = await options.recoveryAudit.readExact({ scope: options.offlineIdentity.scope, operationRoot: claim.operationRoot })
		lifecycle = await advance(options.store, lifecycle, statusForAudit(audit.state), evidenceDigest(audit))
		throw error
	}
}

/**
 * Restart path. It consults the durable recovery row before deciding whether
 * the original exact operation may be entered again. An ambiguous mint row is
 * reconciled; it is never replaced by a new spend.
 */
export async function recoverDemoIntegratedOutbidReturn(options: {
	operationId: string
	template: DemoMaintainerExactBranchTemplate
	offlineIdentity: DemoMaintainerOfflineIdentity
	store: DemoIntegratedAuthorityStore
	executor: DemoIntegratedMaintainerExecutorPort
	recoveryAudit: DemoIntegratedRecoveryAuditPort
	executionBinding: DemoIntegratedExecutionRootBindingV1
}): Promise<DemoIntegratedOutbidReturnResult> {
	let lifecycle = await options.store.readLifecycle(options.operationId)
	if (lifecycle === null) throw new Error('DEMO_INTEGRATED_COMPOSITION: operation lifecycle is absent')
	if (lifecycle.claim.schema !== 'COCO_DEMO_INTEGRATED_AUTHORITY_CLAIM_V1') {
		throw new Error('DEMO_INTEGRATED_COMPOSITION: outbid-only recovery received a V2 terminal claim')
	}
	if (lifecycle.status === 'recipient_imported') return { lifecycle }
	if (lifecycle.status === 'quarantined' || lifecycle.status === 'outbid_return_pending') {
		throw new Error('DEMO_INTEGRATED_COMPOSITION: lifecycle is not eligible for recovery')
	}
	await exactExecutionBinding(options.store, lifecycle.claim, options.executionBinding)
	const audit = await options.recoveryAudit.readExact({ scope: options.offlineIdentity.scope, operationRoot: lifecycle.claim.operationRoot })
	const identity = exactIdentity(options.offlineIdentity, options.template, lifecycle)
	const beforeMint = preMintAudit(audit.state)
	if ((audit.state === 'absent' || audit.state === 'prepared')
		&& lifecycle.status !== 'execution_pending' && lifecycle.status !== 'execution_unknown') {
		lifecycle = await advance(options.store, lifecycle, 'quarantined', evidenceDigest(audit))
		throw new Error('DEMO_INTEGRATED_COMPOSITION: recovery journal regressed behind the durable authority lifecycle')
	}
	if (!beforeMint || audit.state === 'retry_ready') {
		// Persist the recovery journal's authoritative mint boundary before any
		// recovery call. A crash during recoverExact must not leave an older
		// execution_pending/execution_unknown row that could re-enter fresh send.
		lifecycle = await persistObservedAudit(options.store, lifecycle, audit)
	}
	try {
		if (beforeMint) {
			const outcome = await options.executor.executeExact(identity)
			if (outcome.status !== 'refunded' || outcome.recipient.imported !== true) throw new Error('DEMO_INTEGRATED_COMPOSITION: exact return was not imported')
			lifecycle = await advance(options.store, lifecycle, 'recipient_imported', outcome.terminal.responseDigest)
			return { lifecycle, outcome }
		}
		const recovery = await options.executor.recoverExact(identity)
		if (recovery.status === 'refunded') {
			lifecycle = await advance(options.store, lifecycle, 'recipient_imported', recovery.terminal.responseDigest)
			return { lifecycle, outcome: recovery }
		}
		if (recovery.status === 'indeterminate') {
			const after = await options.recoveryAudit.readExact({
				scope: options.offlineIdentity.scope, operationRoot: lifecycle.claim.operationRoot,
			})
			lifecycle = await persistObservedAudit(options.store, lifecycle, after)
			if (lifecycle.status === 'quarantined') {
				throw new Error('DEMO_INTEGRATED_COMPOSITION: recovery journal regressed while mint outcome remained indeterminate')
			}
			return { lifecycle, recovery }
		}
		const after = await options.recoveryAudit.readExact({
			scope: options.offlineIdentity.scope, operationRoot: lifecycle.claim.operationRoot,
		})
		lifecycle = await persistObservedAudit(options.store, lifecycle, after)
		if (lifecycle.status === 'quarantined') {
			throw new Error('DEMO_INTEGRATED_COMPOSITION: recovery journal regressed after reconciliation')
		}
		return { lifecycle, recovery }
	} catch (error) {
		const after = await options.recoveryAudit.readExact({ scope: options.offlineIdentity.scope, operationRoot: lifecycle.claim.operationRoot })
		if (lifecycle.status !== 'quarantined') lifecycle = await persistObservedAudit(options.store, lifecycle, after)
		throw error
	}
}
