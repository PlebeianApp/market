import { describe, expect, test } from 'bun:test'

import type {
	DemoIntegratedAuthorityClaim,
	DemoIntegratedAuthorityStore,
	DemoIntegratedExecutionRootBindingV1,
	DemoIntegratedLifecycleRecord,
	DemoIntegratedLifecycleStatus,
} from './demo-integrated-authority'
import {
	demoIntegratedExecutionRootBindingDigest,
	demoIntegratedProofPoolDigest,
} from './demo-integrated-authority'
import {
	recoverDemoIntegratedOutbidReturn,
	type DemoIntegratedMaintainerExecutorPort,
} from './demo-integrated-outbid-return'
import {
	demoMaintainerScopeFor,
	type DemoMaintainerExactBranchTemplate,
} from './demo-maintainer-offline'

const hex = (digit: string): string => digit.repeat(64)

function fixture(status: DemoIntegratedLifecycleStatus) {
	const template = {
		network: 'demo-network', chainId: 'demo-chain', auctionId: 'auction-1', operationId: 'operation-1',
		templateDigest: hex('1'),
	} as DemoMaintainerExactBranchTemplate
	const claim = {
		schema: 'COCO_DEMO_INTEGRATED_AUTHORITY_CLAIM_V1', operationId: template.operationId,
		operationRoot: template.templateDigest, network: template.network, chainId: template.chainId,
		auctionId: template.auctionId, displacedBidId: 'bid-1', replacementBidId: 'bid-2', displacementHeight: 42,
		templateDigest: template.templateDigest, cashuSigAllDigest: hex('2'), outputsDigest: hex('3'),
		proofStateRefs: [`02${hex('4')}`], poolAmount: 1_000, admissionOperationId: template.operationId,
		admissionReceiptDigest: hex('5'), committeeKeysetId: 'committee-1', committeeKeysetVersion: '1',
		dkgRunId: 'dkg-1', publicKeyPackageSha256: hex('6'), signerRosterDigest: hex('7'),
		status: 'outbid_return_pending',
	} satisfies DemoIntegratedAuthorityClaim
	let lifecycle: DemoIntegratedLifecycleRecord = {
		schema: 'COCO_DEMO_INTEGRATED_LIFECYCLE_V1', revision: 3, claim, status,
	}
	const transitions: DemoIntegratedLifecycleStatus[] = []
	const stableBinding: Omit<DemoIntegratedExecutionRootBindingV1, 'bindingDigest'> = {
		schema: 'COCO_DEMO_INTEGRATED_EXECUTION_ROOT_BINDING_V1', operationId: claim.operationId,
		authorityOperationRoot: claim.operationRoot, frostOperationRoot: hex('9'),
		network: claim.network, chainId: claim.chainId, auctionId: claim.auctionId,
		displacedBidId: claim.displacedBidId, replacementBidId: claim.replacementBidId,
		displacementHeight: claim.displacementHeight, templateDigest: claim.templateDigest,
		cashuSigAllDigest: claim.cashuSigAllDigest, outputsDigest: claim.outputsDigest,
		proofPoolDigest: demoIntegratedProofPoolDigest(claim.proofStateRefs), poolAmount: claim.poolAmount,
		admissionReceiptDigest: claim.admissionReceiptDigest,
		committeeKeysetId: claim.committeeKeysetId, committeeKeysetVersion: claim.committeeKeysetVersion,
		dkgRunId: claim.dkgRunId, publicKeyPackageSha256: claim.publicKeyPackageSha256,
		signerRosterDigest: claim.signerRosterDigest, processRosterDigest: hex('a'), policyPackageDigest: hex('b'),
	}
	const executionBinding: DemoIntegratedExecutionRootBindingV1 = {
		...stableBinding, bindingDigest: demoIntegratedExecutionRootBindingDigest(stableBinding),
	}
	const store: DemoIntegratedAuthorityStore = {
		async claimOutbidReturn() { throw new Error('not used by recovery test') },
		async bindExecutionRoot(binding) {
			if (JSON.stringify(binding) !== JSON.stringify(executionBinding)) throw new Error('test binding conflict')
			return { binding: structuredClone(executionBinding), created: false }
		},
		async readExecutionRoot() { return structuredClone(executionBinding) },
		async readLifecycle() { return structuredClone(lifecycle) },
		async transitionLifecycle(request) {
			if (request.expectedRevision !== lifecycle.revision || request.expectedStatus !== lifecycle.status) {
				throw new Error('test CAS mismatch')
			}
			transitions.push(request.nextStatus)
			lifecycle = { ...lifecycle, revision: lifecycle.revision + 1, status: request.nextStatus, evidenceDigest: request.evidenceDigest }
			return structuredClone(lifecycle)
		},
	}
	return {
		template, store, transitions, executionBinding,
		offlineIdentity: { scope: demoMaintainerScopeFor(template), bundleDigest: hex('8') },
	}
}

describe('integrated outbid-return restart composition', () => {
	test('refuses execution when the caller cannot reproduce the durable authority-to-FROST root mapping', async () => {
		const held = fixture('execution_unknown')
		const changed = { ...held.executionBinding, frostOperationRoot: hex('c') }
		changed.bindingDigest = demoIntegratedExecutionRootBindingDigest(changed)
		let calls = 0
		await expect(recoverDemoIntegratedOutbidReturn({
			operationId: 'operation-1', template: held.template, offlineIdentity: held.offlineIdentity,
			store: held.store, executionBinding: changed,
			executor: {
				async executeExact() { calls += 1; throw new Error('must not execute') },
				async recoverExact() { calls += 1; throw new Error('must not recover') },
			},
			recoveryAudit: { async readExact() { calls += 1; return { state: 'attempting' } } },
		})).rejects.toThrow(/execution-root binding is absent or changed/)
		expect(calls).toBe(0)
	})

	test.each(['attempting', 'ambiguous'] as const)('persists %s audit as mint_unknown before exact recovery', async (auditState) => {
		const held = fixture('execution_unknown')
		let statusSeenByRecovery: DemoIntegratedLifecycleStatus | undefined
		const executor: DemoIntegratedMaintainerExecutorPort = {
			async executeExact() { throw new Error('must not fresh-send') },
			async recoverExact() {
				statusSeenByRecovery = (await held.store.readLifecycle('operation-1'))?.status
				return { status: 'indeterminate', reasonCode: 'mint_outcome_unknown' }
			},
		}
		const result = await recoverDemoIntegratedOutbidReturn({
			operationId: 'operation-1', template: held.template, offlineIdentity: held.offlineIdentity,
			store: held.store, executor, executionBinding: held.executionBinding,
			recoveryAudit: { async readExact() { return { state: auditState } } },
		})
		expect(statusSeenByRecovery).toBe('mint_unknown')
		expect(result.lifecycle.status).toBe('mint_unknown')
		expect(held.transitions).toEqual(['mint_unknown'])
	})

	test('persists succeeded mint audit as recipient_pending before restoring/importing the terminal result', async () => {
		const held = fixture('execution_pending')
		let statusSeenByRecovery: DemoIntegratedLifecycleStatus | undefined
		const executor: DemoIntegratedMaintainerExecutorPort = {
			async executeExact() { throw new Error('must not fresh-send') },
			async recoverExact() {
				statusSeenByRecovery = (await held.store.readLifecycle('operation-1'))?.status
				return { status: 'indeterminate', reasonCode: 'recipient_import_pending' }
			},
		}
		const result = await recoverDemoIntegratedOutbidReturn({
			operationId: 'operation-1', template: held.template, offlineIdentity: held.offlineIdentity,
			store: held.store, executor, executionBinding: held.executionBinding,
			recoveryAudit: { async readExact() { return { state: 'succeeded', terminalResponseDigest: hex('a') } } },
		})
		expect(statusSeenByRecovery).toBe('recipient_pending')
		expect(result.lifecycle.status).toBe('recipient_pending')
		expect(held.transitions).toEqual(['recipient_pending'])
	})

	test('quarantines an indeterminate recovery whose audit regresses behind the observed mint boundary', async () => {
		const held = fixture('execution_unknown')
		let auditReads = 0
		await expect(recoverDemoIntegratedOutbidReturn({
			operationId: 'operation-1', template: held.template, offlineIdentity: held.offlineIdentity,
			store: held.store, executionBinding: held.executionBinding,
			executor: {
				async executeExact() { throw new Error('must not fresh-send') },
				async recoverExact() { return { status: 'indeterminate', reasonCode: 'mint_outcome_unknown' } },
			},
			recoveryAudit: { async readExact() { auditReads += 1; return { state: auditReads === 1 ? 'attempting' : 'prepared' } } },
		})).rejects.toThrow(/journal regressed/)
		expect(held.transitions).toEqual(['mint_unknown', 'quarantined'])
	})

	test('quarantines a mint-unknown authority row when the mint recovery journal regresses', async () => {
		const held = fixture('mint_unknown')
		let executions = 0
		const executor: DemoIntegratedMaintainerExecutorPort = {
			async executeExact() { executions += 1; throw new Error('must not execute') },
			async recoverExact() { executions += 1; throw new Error('must not recover') },
		}
		await expect(recoverDemoIntegratedOutbidReturn({
			operationId: 'operation-1', template: held.template, offlineIdentity: held.offlineIdentity,
			store: held.store, executor, executionBinding: held.executionBinding,
			recoveryAudit: { async readExact() { return { state: 'absent' } } },
		})).rejects.toThrow(/recovery journal regressed/)
		expect(executions).toBe(0)
		expect(held.transitions).toEqual(['quarantined'])
	})

	test('re-enters only the same pre-mint operation root after an execution-stage interruption', async () => {
		const held = fixture('execution_unknown')
		let seen: unknown
		const executor: DemoIntegratedMaintainerExecutorPort = {
			async executeExact(identity) {
				seen = identity
				return {
					status: 'refunded', deliverySource: 'mint_response', selectionRoot: hex('9'),
					terminal: {
						schema: 'COCO_DEMO_SIGALL_TERMINAL_V1', requestDigest: hex('b'), responseDigest: hex('a'),
						outputCount: 1, amountTotal: 1_000, keysetIds: ['keyset-1'], source: 'mint_response', completedAt: 1_000,
					},
					recipient: { imported: true, alreadyImported: false },
				}
			},
			async recoverExact() { throw new Error('must not recover before mint attempt') },
		}
		const result = await recoverDemoIntegratedOutbidReturn({
			operationId: 'operation-1', template: held.template, offlineIdentity: held.offlineIdentity,
			store: held.store, executor, executionBinding: held.executionBinding,
			recoveryAudit: { async readExact() { return { state: 'prepared' } } },
		})
		expect(seen).toMatchObject({ expectedRole: 'refund', expectedOperationId: 'operation-1', expectedOperationRoot: hex('1') })
		expect(result.lifecycle.status).toBe('recipient_imported')
		expect(held.transitions).toEqual(['recipient_imported'])
	})

	test('persists an authoritative retry fence before re-entering only the same exact operation', async () => {
		const held = fixture('mint_unknown')
		let statusSeenByRetry: DemoIntegratedLifecycleStatus | undefined
		const result = await recoverDemoIntegratedOutbidReturn({
			operationId: 'operation-1', template: held.template, offlineIdentity: held.offlineIdentity,
			store: held.store, executionBinding: held.executionBinding,
			executor: {
				async executeExact() {
					statusSeenByRetry = (await held.store.readLifecycle('operation-1'))?.status
					return {
						status: 'refunded', deliverySource: 'mint_response', selectionRoot: hex('9'),
						terminal: {
							schema: 'COCO_DEMO_SIGALL_TERMINAL_V1', requestDigest: hex('b'), responseDigest: hex('a'),
							outputCount: 1, amountTotal: 1_000, keysetIds: ['keyset-1'], source: 'mint_response', completedAt: 1_000,
						},
						recipient: { imported: true, alreadyImported: false },
					}
				},
				async recoverExact() { throw new Error('retry fence must re-enter exact execute path') },
			},
			recoveryAudit: { async readExact() { return { state: 'retry_ready', requestDigest: hex('d') } } },
		})
		expect(statusSeenByRetry).toBe('retry_ready')
		expect(result.lifecycle.status).toBe('recipient_imported')
		expect(held.transitions).toEqual(['retry_ready', 'recipient_imported'])
	})
})
