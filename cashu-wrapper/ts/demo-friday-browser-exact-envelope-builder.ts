/**
 * Exact V2 threshold envelope construction for the fake-money browser flow.
 *
 * The browser signs only parsed, role-bound Cashu packages. The template uses
 * the auction's maximum possible end (derived from the approved emergency
 * lock policy) as its validity/close bound. Consensus still proves the actual
 * close before any committee settlement; no browser clock authorizes payout.
 */
import { hasValidDleq } from '@cashu/cashu-ts'
import { getDecodedToken } from '@cashu/coco-core'
import { bytesToHex } from '@noble/hashes/utils.js'

import type {
	DemoFridayBrowserExactEnvelopeBuilderPort,
	DemoFridayOperationBoundSigningV1,
} from './demo-friday-browser-coco-client'
import {
	demoFridayFundingAuthorizationUnsignedEvent,
	type DemoFridayBrowserFundingAuthorizationContentV1,
} from './demo-friday-browser-funding-authorization'
import {
	demoMaintainerExactTemplateDigest,
	type DemoMaintainerExactBranchTemplate,
	type DemoMaintainerExactTemplateBundle,
	type DemoMaintainerPackageAuthorization,
} from './demo-maintainer-offline'
import {
	demoCashuSigAllDigest,
	type DemoCommitteeParticipant,
} from './demo-sigall-settlement'
import { proofPoint, type CashuProof } from './nut-client'
import type { DemoRecipientKeyset } from './demo-sigall-recipient'
import {
	demoFridayFundingAbortCapsuleDigest,
	validateDemoFridayFundingAbortRecoveryCapsule,
	type DemoFridayFundingAbortRecoveryCapsuleV1,
} from './demo-friday-funding-abort-capsule'

const HEX_32 = /^[0-9a-f]{64}$/
const COMPRESSED = /^(?:02|03)[0-9a-f]{64}$/
const EMERGENCY_RECOVERY_SECONDS = 900
const SETTLEMENT_WINDOW_SECONDS = 600

function refuse(message: string): never {
	throw new Error(`DEMO_FRIDAY_EXACT_ENVELOPE_BUILDER: ${message}`)
}

function exactAmount(value: unknown): number {
	if (typeof value === 'number') return Number.isSafeInteger(value) ? value : 0
	if (typeof value === 'bigint') return Number.isSafeInteger(Number(value)) ? Number(value) : 0
	if (typeof value === 'string') {
		const parsed = Number(value)
		return Number.isSafeInteger(parsed) ? parsed : 0
	}
	if (value !== null && typeof value === 'object' && 'value' in value) {
		return exactAmount((value as { value: unknown }).value)
	}
	return 0
}

function exactInputs(token: string, keyset: DemoRecipientKeyset, amount: number): CashuProof[] {
	let decoded: { mint?: unknown; unit?: unknown; proofs?: unknown }
	try { decoded = getDecodedToken(token, [keyset.id]) as typeof decoded }
	catch { return refuse('Coco locked token is not decodable for the pinned keyset') }
	if (decoded.unit !== 'sat' || !Array.isArray(decoded.proofs) || decoded.proofs.length < 1
		|| decoded.proofs.length > 32 || keyset.unit !== 'sat') refuse('Coco locked token has an invalid unit or proof count')
	const inputs = decoded.proofs.map((value, index) => {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) refuse(`proof ${index} is invalid`)
		const proof = value as Record<string, unknown>
		if (proof.dleq === undefined) refuse(`proof ${index} DLEQ is required`)
		const keys = ['amount', 'id', 'secret', 'C', 'dleq']
		const proofAmount = exactAmount(proof.amount)
		if (JSON.stringify(Object.keys(proof).sort()) !== JSON.stringify(keys.sort())
			|| proofAmount < 1 || proof.id !== keyset.id
			|| typeof proof.secret !== 'string' || proof.secret.length < 1 || proof.secret.length > 4096
			|| !COMPRESSED.test(String(proof.C))) refuse(`proof ${index} differs from the exact pinned pool`)
		if (proof.dleq === null || typeof proof.dleq !== 'object' || Array.isArray(proof.dleq)) refuse(`proof ${index} DLEQ is required`)
		const raw = proof.dleq as Record<string, unknown>
		const dleqKeys = raw.r === undefined ? ['e', 's'] : ['e', 's', 'r']
		if (JSON.stringify(Object.keys(raw).sort()) !== JSON.stringify(dleqKeys.sort())
			|| !HEX_32.test(String(raw.e)) || !HEX_32.test(String(raw.s))
			|| (raw.r !== undefined && !HEX_32.test(String(raw.r)))) refuse(`proof ${index} DLEQ is malformed`)
		const exact = { amount: proofAmount, id: String(proof.id), secret: String(proof.secret), C: String(proof.C),
			dleq: { e: String(raw.e), s: String(raw.s), ...(raw.r === undefined ? {} : { r: String(raw.r) }) } } as CashuProof
		if (!hasValidDleq(exact as never, keyset as never, { require: true })) refuse(`proof ${index} DLEQ/keyset binding failed`)
		return exact
	})
	if (inputs.reduce((sum, proof) => sum + proof.amount, 0) !== amount
		|| new Set(inputs.map((proof) => proof.secret)).size !== inputs.length) {
		refuse('Coco locked token does not contain the exact full pool')
	}
	return inputs.sort((left, right) => bytesToHex(proofPoint(left).toBytes(true))
		.localeCompare(bytesToHex(proofPoint(right).toBytes(true))))
}

async function makeTemplate(options: {
	role: 'winner_settlement' | 'refund'
	operation: Parameters<DemoFridayBrowserExactEnvelopeBuilderPort['buildExact']>[0]['operation']
	inputs: CashuProof[]
	request: Parameters<DemoFridayBrowserExactEnvelopeBuilderPort['buildExact']>[0]['winnerRequest']
	participants: DemoCommitteeParticipant[]
	signing: DemoFridayOperationBoundSigningV1
}): Promise<DemoMaintainerExactBranchTemplate> {
	const operation = options.operation
	const maximumEndTime = operation.locktime - EMERGENCY_RECOVERY_SECONDS
	if (!HEX_32.test(operation.fundingOperationId) || !Number.isSafeInteger(maximumEndTime) || maximumEndTime < 1
		|| maximumEndTime + SETTLEMENT_WINDOW_SECONDS !== operation.locktime - 300) {
		refuse('operation does not use the approved maximum-end emergency timing policy')
	}
	const recipientPublicKey = options.request.capability.recipientPublicKey
	const template: DemoMaintainerExactBranchTemplate = {
		schema: 'COCO_DEMO_MAINTAINER_EXACT_BRANCH_V2', role: options.role,
		network: operation.authNetworkId, chainId: operation.chainId, auctionId: operation.auctionId,
		operationId: operation.fundingOperationId, bidId: operation.fundingOperationId,
		bidEventId: operation.fundingOperationId, bidderActorId: operation.actor,
		amount: operation.fullPoolAmount, inputFee: 0, mintUrl: operation.canonicalMintUrl, unit: 'sat',
		locktime: operation.locktime, validUntil: maximumEndTime, closeTime: maximumEndTime,
		settlementWindowSeconds: SETTLEMENT_WINDOW_SECONDS,
		sellerPaymentPublicKey: operation.winnerRecipientPublicKey, recipientPublicKey,
		bidderPublicKey: operation.paymentPublicKey, refundPublicKey: operation.refundPublicKey,
		committeePublicKey: operation.committeePublicKey,
		committeeKeysetId: operation.committeeKeysetId,
		committeeKeysetVersion: operation.committeeKeysetVersion,
		threshold: 3, participants: structuredClone(options.participants),
		mintSeal: {
			mintUrl: operation.canonicalMintUrl, mintPublicKey: operation.mintPublicKey,
			serverVersion: operation.mintServerVersion, activeSatKeysetId: operation.keysetId,
			denominationKeyDigest: operation.denominationKeyDigest,
			denominationAmounts: [...operation.denominationAmounts], inputFeePpk: 0,
			nuts: [...operation.mintNuts],
		},
		inputs: structuredClone(options.inputs), outputs: structuredClone(options.request.outputs),
		recipientCapability: structuredClone(options.request.capability),
		templateDigest: '', cashuSigAllDigest: '', bidderMainSignature: '',
	}
	const main = await options.signing.signCashuPackage({
		operationId: operation.fundingOperationId, role: options.role, authority: 'payment',
		inputs: template.inputs.map(({ secret }) => ({ secret })), outputs: template.outputs.map(({ B_ }) => ({ B_ })),
	})
	template.cashuSigAllDigest = demoCashuSigAllDigest(template.inputs, template.outputs)
	if (main.digest !== template.cashuSigAllDigest) refuse('payment signer changed the exact Cashu SIG_ALL digest')
	template.bidderMainSignature = main.signature
	if (options.role === 'refund') {
		const refund = await options.signing.signCashuPackage({
			operationId: operation.fundingOperationId, role: 'refund', authority: 'refund',
			inputs: template.inputs.map(({ secret }) => ({ secret })), outputs: template.outputs.map(({ B_ }) => ({ B_ })),
		})
		if (refund.digest !== template.cashuSigAllDigest) refuse('refund signer changed the exact Cashu SIG_ALL digest')
		template.refundSignature = refund.signature
	}
	template.templateDigest = demoMaintainerExactTemplateDigest(template)
	return template
}

export function createDemoFridayBrowserExactEnvelopeBuilder(options: {
	participants: [DemoCommitteeParticipant, DemoCommitteeParticipant, DemoCommitteeParticipant, DemoCommitteeParticipant]
}): DemoFridayBrowserExactEnvelopeBuilderPort {
	const participants = structuredClone(options.participants)
	return Object.freeze({
		async buildAbortCapsuleExact(
			input: Parameters<DemoFridayBrowserExactEnvelopeBuilderPort['buildAbortCapsuleExact']>[0],
		) {
			const operation = input.operation
			if (!Number.isSafeInteger(input.nowSeconds) || input.nowSeconds < 1
				|| operation.refundPublicKey !== input.refundRequest.capability.recipientPublicKey
				|| input.refundDelivery.intent.recipientPublicKey !== operation.refundPublicKey) {
				refuse('abort capsule refund plan or preparation time differs from the persisted operation')
			}
			const inputs = exactInputs(input.lockedToken, input.keyset, operation.fullPoolAmount)
			const refund = await makeTemplate({ role: 'refund', operation, inputs,
				request: input.refundRequest, participants, signing: input.signing })
			const signed = await input.signing.signTemplateAuthorization({
				operationId: operation.fundingOperationId, role: 'refund', template: refund,
			})
			const actorReturnAuthorization: DemoMaintainerPackageAuthorization = {
				schema: 'COCO_DEMO_PAYMENT_KEY_PACKAGE_AUTHORIZATION_V1',
				paymentPublicKey: operation.paymentPublicKey,
				packageDigest: signed.packageDigest, signature: signed.signature,
			}
			const body: Omit<DemoFridayFundingAbortRecoveryCapsuleV1, 'capsuleDigest'> = {
				schema: 'PLEBEIAN_FRIDAY_FUNDING_ABORT_RECOVERY_CAPSULE_V1',
				createdAt: input.nowSeconds, refund, actorReturnAuthorization,
			}
			return validateDemoFridayFundingAbortRecoveryCapsule({
				...body, capsuleDigest: demoFridayFundingAbortCapsuleDigest(body),
			})
		},
		async buildExact(input: Parameters<DemoFridayBrowserExactEnvelopeBuilderPort['buildExact']>[0]) {
			const operation = input.operation
			if (!Number.isSafeInteger(input.nowSeconds) || input.nowSeconds < 1
				|| operation.winnerRecipientPublicKey !== input.winnerRequest.capability.recipientPublicKey
				|| operation.refundPublicKey !== input.refundRequest.capability.recipientPublicKey
				|| input.refundDelivery.intent.recipientPublicKey !== operation.refundPublicKey) {
				refuse('recipient plans or preparation time differ from the persisted operation')
			}
			const inputs = exactInputs(input.lockedToken, input.keyset, operation.fullPoolAmount)
			const winner = await makeTemplate({ role: 'winner_settlement', operation, inputs,
				request: input.winnerRequest, participants, signing: input.signing })
			const refund = await makeTemplate({ role: 'refund', operation, inputs,
				request: input.refundRequest, participants, signing: input.signing })
			const winnerAuthorization = await input.signing.signTemplateAuthorization({
				operationId: operation.fundingOperationId, role: 'winner_settlement', template: winner,
			})
			const returnAuthorization = await input.signing.signTemplateAuthorization({
				operationId: operation.fundingOperationId, role: 'refund', template: refund,
			})
			const actorWinnerAuthorization: DemoMaintainerPackageAuthorization = {
				schema: 'COCO_DEMO_PAYMENT_KEY_PACKAGE_AUTHORIZATION_V1',
				paymentPublicKey: operation.paymentPublicKey,
				packageDigest: winnerAuthorization.packageDigest, signature: winnerAuthorization.signature,
			}
			const actorReturnAuthorization: DemoMaintainerPackageAuthorization = {
				schema: 'COCO_DEMO_PAYMENT_KEY_PACKAGE_AUTHORIZATION_V1',
				paymentPublicKey: operation.paymentPublicKey,
				packageDigest: returnAuthorization.packageDigest, signature: returnAuthorization.signature,
			}
			const bundleAuthorization = await input.signing.signBundleAuthorization({
				operationId: operation.fundingOperationId, preparedAt: input.nowSeconds, winner, refund,
				actorWinnerAuthorization, actorReturnAuthorization,
			})
			const bundle: DemoMaintainerExactTemplateBundle = {
				schema: 'COCO_DEMO_MAINTAINER_TEMPLATE_BUNDLE_V1', preparedAt: input.nowSeconds,
				winner, refund, actorWinnerAuthorization, actorReturnAuthorization,
				bundleDigest: bundleAuthorization.bundleDigest,
				actorBundleSignature: bundleAuthorization.signature,
				bidderBundleSignature: bundleAuthorization.signature,
			}
			const terms = {
				schema: 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_AUTHORIZATION_V1' as const,
				authNetworkId: operation.authNetworkId, chainId: operation.chainId,
				auctionId: operation.auctionId, amount: operation.fullPoolAmount,
				mintUrl: operation.canonicalMintUrl, paymentPublicKey: operation.paymentPublicKey,
				refundPublicKey: operation.refundPublicKey, fundingOperationId: operation.fundingOperationId,
				bundleDigest: bundle.bundleDigest, returnPackageDigest: refund.templateDigest,
				returnCashuSigAllDigest: refund.cashuSigAllDigest,
				bidderReturnSignature: refund.bidderMainSignature, expiresAt: input.nowSeconds + 240,
			}
			const keySignatures = await input.signing.signFundingKeys(terms)
			const content: DemoFridayBrowserFundingAuthorizationContentV1 = { ...terms, ...keySignatures }
			const unsigned = demoFridayFundingAuthorizationUnsignedEvent(operation.actor, input.nowSeconds, content)
			const authorization = await input.signing.signNostrFundingAuthorization(unsigned)
			return { envelope: {
				schema: 'PLEBEIAN_FRIDAY_PREPARED_FUNDING_ENVELOPE_V1', authorization, bundle,
			} }
		},
	})
}
