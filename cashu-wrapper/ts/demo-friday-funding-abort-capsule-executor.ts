/** Exact post-abort executor for a one-branch recovery capsule. */
import { sha256 } from '@noble/hashes/sha2.js'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import type { DemoIntegratedExecutionRootBindingV2, DemoIntegratedTerminalAuthorityClaimV2 } from './demo-integrated-authority'
import type { DemoMaintainerFederationAuthorization, DemoMaintainerFederationPort, DemoMaintainerFederationRequest } from './demo-maintainer-federation'
import {
	demoMaintainerScopeFor,
	type DemoMaintainerOfflineIdentity,
	type DemoMaintainerOfflineRecoveryResult,
	type DemoMaintainerOfflineSuccess,
	type DemoMaintainerPreparedAuthorizationV1,
	type DemoMaintainerRecipientDeliveryPort,
	type DemoMaintainerExactBranchTemplate,
} from './demo-maintainer-offline'
import {
	readDemoSigAllTerminal,
	reconcileDemoSigAllSwap,
	restoreDemoSigAllTerminalByIdentity,
	restoreDemoSigAllTerminalResponse,
	submitDemoSigAllSwap,
	type DemoSigAllRecoveryMintStatePort,
	type DemoSigAllRecoveryStore,
	type DemoSigAllTerminalResponsePort,
} from './demo-sigall-recovery'
import {
	demoRecipientCapabilityDigest,
	type DemoSigAllMintPort,
	type DemoSigAllSwapRequest,
} from './demo-sigall-settlement'
import {
	validateDemoFridayFundingAbortRecoveryCapsule,
	type DemoFridayFundingAbortCapsuleStore,
	type DemoFridayFundingAbortCapsuleTerminalStore,
	type DemoFridayFundingAbortCapsuleTerminalV1,
} from './demo-friday-funding-abort-capsule'
import { proofPoint } from './nut-client'

function digest(value: unknown): string { return bytesToHex(sha256(utf8ToBytes(JSON.stringify(value)))) }
function fail(message: string): never { throw new Error(`DEMO_FRIDAY_ABORT_CAPSULE_EXECUTOR: ${message}`) }

function exactAuthorization(
	value: DemoMaintainerFederationAuthorization,
	request: DemoMaintainerFederationRequest,
	frostOperationRoot: string,
): DemoMaintainerFederationAuthorization {
	if (value.schema !== 'COCO_DEMO_MAINTAINER_FEDERATION_AUTHORIZATION_V1' || value.threshold !== 3
		|| value.participantIds.length !== 3 || new Set(value.participantIds).size !== 3
		|| value.sessionId !== request.sessionId || value.packageDigest !== request.packageDigest
		|| value.cashuSigAllDigest !== request.cashuSigAllDigest
		|| value.committeeKeysetId !== request.committeeKeysetId
		|| value.committeeKeysetVersion !== request.committeeKeysetVersion
		|| value.frostOperationRoot !== frostOperationRoot
		|| !schnorr.verify(hexToBytes(value.signature), hexToBytes(request.cashuSigAllDigest),
			hexToBytes(request.committeePublicKey.slice(2)))) {
		fail('threshold authorization differs from the exact request')
	}
	return structuredClone(value)
}

export async function prepareDemoFridayFundingAbortCapsuleExact(options: {
	claim: DemoIntegratedTerminalAuthorityClaimV2
	executionBinding: DemoIntegratedExecutionRootBindingV2
	capsules: DemoFridayFundingAbortCapsuleStore
	terminalStore: DemoFridayFundingAbortCapsuleTerminalStore
	federation: DemoMaintainerFederationPort
	request: DemoMaintainerFederationRequest
}): Promise<{ identity: DemoMaintainerOfflineIdentity; prepared: DemoMaintainerPreparedAuthorizationV1 }> {
	const capsule = validateDemoFridayFundingAbortRecoveryCapsule(
		await options.capsules.readByOperationExact(options.claim.operationId),
	)
	const template = capsule.refund
	if (options.claim.cause !== 'funding_abort' || options.claim.role !== 'refund'
		|| options.claim.operationRoot !== template.templateDigest
		|| options.claim.cashuSigAllDigest !== template.cashuSigAllDigest
		|| options.executionBinding.operationId !== options.claim.operationId
		|| options.executionBinding.authorityOperationRoot !== options.claim.operationRoot
		|| options.request.packageDigest !== template.templateDigest
		|| options.request.cashuSigAllDigest !== template.cashuSigAllDigest) {
		fail('claim, execution binding, request, and independent capsule differ')
	}
	const authorization = exactAuthorization(
		await options.federation.authorize(structuredClone(options.request)),
		options.request,
		options.executionBinding.frostOperationRoot,
	)
	const scope = demoMaintainerScopeFor(template)
	const selectionRoot = digest([
		'PLEBEIAN_FRIDAY_FUNDING_ABORT_CAPSULE_SELECTION_V1', capsule.capsuleDigest,
		options.claim.operationRoot, options.executionBinding.bindingDigest,
		options.claim.outcomeEvidenceDigest,
	])
	const prepared: DemoMaintainerPreparedAuthorizationV1 = {
		schema: 'COCO_DEMO_MAINTAINER_PREPARED_AUTHORIZATION_V1', scope,
		bundleDigest: capsule.capsuleDigest, selectionRoot,
		authorizationDigest: digest(['PLEBEIAN_FRIDAY_FUNDING_ABORT_DURABLE_AUTHORIZATION_V1', authorization]),
		operationId: template.operationId, operationRoot: template.templateDigest,
		frostOperationRoot: options.executionBinding.frostOperationRoot, role: 'refund',
	}
	const terminal: DemoFridayFundingAbortCapsuleTerminalV1 = {
		schema: 'PLEBEIAN_FRIDAY_FUNDING_ABORT_CAPSULE_TERMINAL_V1', operationId: template.operationId,
		capsuleDigest: capsule.capsuleDigest, scope, selectionRoot, authorization, prepared,
	}
	const saved = await options.terminalStore.persistTerminalExact(terminal)
	if (JSON.stringify(saved) !== JSON.stringify(terminal)) fail('durable terminal authority changed')
	return { identity: { scope, bundleDigest: capsule.capsuleDigest, expectedRole: 'refund',
		expectedOperationId: template.operationId, expectedOperationRoot: template.templateDigest,
		expectedFrostOperationRoot: options.executionBinding.frostOperationRoot }, prepared }
}

export function createDemoFridayFundingAbortCapsuleExecutor(options: {
	capsules: DemoFridayFundingAbortCapsuleStore
	terminalStore: DemoFridayFundingAbortCapsuleTerminalStore
	recoveryStore: DemoSigAllRecoveryStore
	mint: DemoSigAllMintPort
	recovery: DemoSigAllRecoveryMintStatePort
	terminalResponse: DemoSigAllTerminalResponsePort
	recipientActorId: string
	recipientFor(template: DemoMaintainerExactBranchTemplate, recipientActorId: string): DemoMaintainerRecipientDeliveryPort
	now?: () => number
	nowSeconds?: () => number
}) {
	const now = options.now ?? Date.now
	async function load(identity: DemoMaintainerOfflineIdentity) {
		const terminal = await options.terminalStore.readTerminalExact(identity)
		if (terminal === null) fail('durable capsule threshold authority is absent')
		const capsule = validateDemoFridayFundingAbortRecoveryCapsule(
			await options.capsules.readByOperationExact(terminal.operationId),
		)
		if (capsule.capsuleDigest !== terminal.capsuleDigest
			|| capsule.refund.templateDigest !== terminal.prepared.operationRoot) fail('capsule changed after threshold authorization')
		return { terminal, capsule, template: capsule.refund }
	}

	function durableRequest(held: Awaited<ReturnType<typeof load>>) {
		const { terminal, template } = held
		const witness = JSON.stringify({ signatures: [template.bidderMainSignature, terminal.authorization.signature] })
		const request: DemoSigAllSwapRequest = {
			schema: 'COCO_DEMO_SIGALL_SWAP_V1', mintUrl: template.mintUrl, operationId: template.operationId,
			locktime: template.locktime, packageDigest: template.templateDigest,
			cashuSigAllDigest: template.cashuSigAllDigest,
			recipientCapabilityDigest: demoRecipientCapabilityDigest(template.recipientCapability),
			mintSeal: structuredClone(template.mintSeal),
			inputs: template.inputs.map((input, index) => ({ ...structuredClone(input),
				witness: index === 0 ? witness : undefined })),
			outputs: template.outputs.map((output) => structuredClone(output)),
		}
		return { scope: terminal.scope, operationRoot: template.templateDigest, request,
			proofStateRefs: template.inputs.map((proof) => bytesToHex(proofPoint(proof).toBytes(true))) }
	}

	async function deliver(held: Awaited<ReturnType<typeof load>>, signatures: Parameters<DemoMaintainerRecipientDeliveryPort['deliverExact']>[0]['signatures']) {
		const { terminal, template } = held
		return options.recipientFor(template, options.recipientActorId).deliverExact({
			selectionRoot: terminal.selectionRoot, templateDigest: template.templateDigest, role: 'refund',
			operationId: template.operationId,
			recipientCapabilityDigest: demoRecipientCapabilityDigest(template.recipientCapability), signatures,
		})
	}

	return Object.freeze({
		async readPreparedExact(identity: DemoMaintainerOfflineIdentity) {
			return structuredClone((await load(identity)).terminal.prepared)
		},
		async executeExact(identity: DemoMaintainerOfflineIdentity): Promise<DemoMaintainerOfflineSuccess> {
			const held = await load(identity)
			const terminal = await readDemoSigAllTerminal({ store: options.recoveryStore,
				scope: held.terminal.scope, operationRoot: held.template.templateDigest })
			if (terminal !== null) {
				const restored = await restoreDemoSigAllTerminalByIdentity({ store: options.recoveryStore,
					recovery: options.terminalResponse, scope: held.terminal.scope,
					operationRoot: held.template.templateDigest })
				return { status: 'refunded', deliverySource: 'terminal_restore',
					selectionRoot: held.terminal.selectionRoot,
					terminal: restored.terminal, recipient: await deliver(held, restored.signatures) }
			}
			const value = durableRequest(held)
			const result = await submitDemoSigAllSwap({ store: options.recoveryStore, mint: options.mint, value, now,
				...(options.nowSeconds === undefined ? {} : { nowSeconds: options.nowSeconds }) })
			if (result.status === 'submitted') {
				return { status: 'refunded', deliverySource: 'mint_response',
					selectionRoot: held.terminal.selectionRoot,
					terminal: result.terminal, recipient: await deliver(held, result.signatures) }
			}
			const restored = await restoreDemoSigAllTerminalResponse({ store: options.recoveryStore,
				recovery: options.terminalResponse, value, now })
			return { status: 'refunded', deliverySource: 'terminal_restore',
				selectionRoot: held.terminal.selectionRoot,
				terminal: result.terminal, recipient: await deliver(held, restored) }
		},
		async recoverExact(identity: DemoMaintainerOfflineIdentity): Promise<DemoMaintainerOfflineRecoveryResult> {
			const held = await load(identity), value = durableRequest(held)
			const result = await reconcileDemoSigAllSwap({ store: options.recoveryStore, recovery: options.recovery, value, now })
			if (result.status === 'recovered') {
				return { status: 'refunded', deliverySource: 'exact_recovery',
					selectionRoot: held.terminal.selectionRoot, terminal: result.terminal,
					recipient: await deliver(held, result.signatures) }
			}
			if (result.status === 'terminal_replay') {
				const restored = await restoreDemoSigAllTerminalResponse({ store: options.recoveryStore,
					recovery: options.terminalResponse, value, now })
				return { status: 'refunded', deliverySource: 'terminal_restore',
					selectionRoot: held.terminal.selectionRoot, terminal: result.terminal,
					recipient: await deliver(held, restored) }
			}
			return result
		},
	})
}
