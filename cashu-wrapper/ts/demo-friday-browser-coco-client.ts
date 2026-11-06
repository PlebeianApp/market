import { useFridayWallet } from './demo-friday-wallet-drain'
/**
 * Browser composition seam for Friday Coco funding.
 *
 * The lead-owned server contract is intentionally represented by ports rather
 * than guessed HTTP field names. The normalized contract is two phase:
 * prepare returns one immutable unsigned Nostr bid after FROST authorization;
 * finalize accepts only that exact bid signed by the browser's NIP-07 actor.
 * A separate readExact operation recovers already-admitted status after the
 * original five-minute funding authorization has expired.
 */
import { hasValidDleq } from '@cashu/cashu-ts'
import { getDecodedToken } from '@cashu/coco-core'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import type { CocoMintSnapshot } from './coco-rail'
import type { DemoFridayBrowserCocoWallet } from './demo-friday-browser-coco-wallet'
import {
	exactDemoFridayCocoTerminalNotice,
	importDemoFridayCocoTerminal,
} from './demo-friday-browser-coco-terminal'
import {
	createDemoFridayBrowserPaymentOperation,
	type DemoFridayBrowserOperationIdentity,
	type DemoFridayBrowserOpeningRefV1,
	type DemoFridayBrowserPaymentOperationInput,
	type DemoFridayBrowserPaymentOperationV1,
	type DemoFridayBrowserPaymentStatePort,
	type DemoFridayBrowserRefundDeliveryV1,
	type DemoFridayTerminalAckV1,
	type DemoFridayPreparedBidV1,
	type DemoFridaySignedNostrBidV1,
	type DemoFridayUnsignedNostrBidV1,
} from './demo-friday-browser-payment-state'
import type { DemoFridayFundingAbortRecoveryCapsuleV1 } from './demo-friday-funding-abort-capsule'
import {
	verifyDemoFridayAuctionPayoutSelectionStatic,
	type DemoFridayAuctionPayoutAuthorizationEnvelopeV1,
	type DemoFridayAuctionPayoutSelectionV1,
} from './demo-friday-auction-payout-authorization'
import { createDemoFridayPaymentSignerFromSecret, type DemoFridayPaymentSigner } from './poc-demo-browser-signer'
import {
	demoFridayFundingAuthorizationUnsignedEvent,
	exactDemoFridayFundingAuthorizationContent,
	type DemoFridayFundingKeyAuthorizationTermsV1,
} from './demo-friday-browser-funding-authorization'
import {
	demoIntegratedFundingV4ReceiptDigest,
	verifyDemoIntegratedFundingReceiptV4,
	type DemoIntegratedFundingReceiptV4,
} from './demo-integrated-funding-receipt-v4'
import { verifyDemoFridayPreparedFundingEnvelope } from './demo-friday-prepared-funding'
import type {
	DemoMaintainerExactBranchTemplate,
	DemoMaintainerPackageAuthorization,
} from './demo-maintainer-offline'
import {
	prepareDemoSigAllRecipientOutputs,
	type DemoRecipientCoordinatorRequest,
	type DemoRecipientImportReceipt,
	type DemoRecipientKeyset,
} from './demo-sigall-recipient'
import {
	demoDenominationKeyDigest,
	demoOutputsDigest,
	demoRecipientCapabilityDigest,
	type DemoCommitteeParticipant,
} from './demo-sigall-settlement'
import {
	blindMessage,
	keysetPublicKey,
	randomSecretHex,
	proofPoint,
	splitAmount,
	unblindBlindedSignature,
	type BlindedSignature,
	type BlindingData,
	type CashuProof,
} from './nut-client'

const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/
const BID_KIND = 28_641

export interface DemoFridayTrustedBrowserDeploymentV1 {
	schema: 'PLEBEIAN_FRIDAY_TRUSTED_BROWSER_DEPLOYMENT_V1'
	environmentId: string
	authNetworkId: string
	chainId: string
	/** Exact genesis identity shared by Comet finality and FundingAbort pins. */
	genesisSha256: string
	/** Canonical public identity only; never the internal FIPS transport origin. */
	canonicalMintUrl: string
	mintSnapshot: CocoMintSnapshot
	keyset: DemoRecipientKeyset
	committeePublicKey: string
	committeeKeysetId: string
	committeeKeysetVersion: string
	dkgRunId: string
	publicKeyPackageSha256: string
	signerRosterDigest: string
	participants: [DemoCommitteeParticipant, DemoCommitteeParticipant, DemoCommitteeParticipant, DemoCommitteeParticipant]
}

/** The composition root supplies a deployment validated independently of auction/request data. */
export interface DemoFridayTrustedBrowserDeploymentPort {
	readExact(): Promise<DemoFridayTrustedBrowserDeploymentV1>
}

export interface DemoFridayNostrSignerPort {
	getPublicKey(): Promise<string>
	signEvent(event: DemoFridayUnsignedNostrBidV1): Promise<DemoFridaySignedNostrBidV1>
}

/** Opens Coco only while the caller already holds the browser wallet lock. */
export interface DemoFridayBrowserCocoWalletFactoryPort {
	openExact(request: {
		actor: string
		environmentId: string
		canonicalMintUrl: string
	}): Promise<DemoFridayBrowserCocoWallet>
}

export interface DemoFridayTrustedAuctionFundingV1 {
	schema: 'PLEBEIAN_FRIDAY_TRUSTED_AUCTION_FUNDING_V1'
	auctionId: string
	sellerPaymentPublicKey: string
	leaderBidId: string
	leaderActor: string
	leaderBidAmount: number
	/** Authenticated seller-prepared winner outputs, persisted independently of the package builder. */
	winnerRequest: DemoRecipientCoordinatorRequest
	/** Present only for a single-prompt auction catalog selection. */
	winnerAuctionPayout?: DemoFridayAuctionPayoutBindingV1
}

export interface DemoFridayAuctionPayoutBindingV1 {
	authorization: DemoFridayAuctionPayoutAuthorizationEnvelopeV1
	selection: DemoFridayAuctionPayoutSelectionV1
	keyset: DemoRecipientKeyset
}

export interface DemoFridayTrustedAuctionFundingPort {
	readExact(request: {
		auctionId: string
		fundingOperationId: string
		fullPoolAmount: number
	}): Promise<DemoFridayTrustedAuctionFundingV1>
}

export interface DemoFridayBrowserFundingRequestV1 {
	auctionId: string
	fundingOperationId: string
	/** Total bid recorded by consensus. */
	bidAmount: number
	/** Full committed pool after this bid. */
	fullPoolAmount: number
	/** Newly reserved Coco pool. For an own raise this is only the delta. */
	reservedPoolAmount: number
	/** Empty for the first bid; exact prior accepted bid id for a replacement. */
	replacesBidId: string
	locktime: number
}

/** Immutable redacted view; contains no operation secrets, openings, or bearer token. */
export interface DemoFridayBrowserPublicOperationV1 {
	actor: string
	authNetworkId: string
	chainId: string
	auctionId: string
	fundingOperationId: string
	canonicalMintUrl: string
	mintPublicKey: string
	mintServerVersion: string
	keysetId: string
	denominationKeyDigest: string
	denominationAmounts: number[]
	mintNuts: number[]
	bidAmount: number
	fullPoolAmount: number
	reservedPoolAmount: number
	replacesBidId: string
	priorLeaderActor: string
	paymentPublicKey: string
	refundPublicKey: string
	winnerRecipientPublicKey: string
	winnerRecipientCapabilityDigest: string
	winnerOutputsDigest: string
	winnerAuctionAuthorizationDigest?: string
	winnerAuctionSelectionDigest?: string
	committeePublicKey: string
	committeeKeysetId: string
	committeeKeysetVersion: string
	locktime: number
}

export interface DemoFridayOperationBoundSigningV1 {
	signCashuPackage(request: {
		operationId: string
		role: 'winner_settlement' | 'refund'
		authority: 'payment' | 'refund'
		inputs: Array<{ secret: string }>
		outputs: Array<{ B_: string }>
	}): Promise<{ digest: string; signature: string }>
	signTemplateAuthorization(request: {
		operationId: string
		role: 'winner_settlement' | 'refund'
		template: DemoMaintainerExactBranchTemplate
	}): Promise<{ packageDigest: string; signature: string }>
	signBundleAuthorization(request: {
		operationId: string
		preparedAt: number
		winner: DemoMaintainerExactBranchTemplate
		refund: DemoMaintainerExactBranchTemplate
		actorWinnerAuthorization: DemoMaintainerPackageAuthorization
		actorReturnAuthorization: DemoMaintainerPackageAuthorization
	}): Promise<{ bundleDigest: string; signature: string }>
	signFundingKeys(value: DemoFridayFundingKeyAuthorizationTermsV1): Promise<{
		paymentKeyAuthorizationSignature: string
		refundKeyAuthorizationSignature: string
	}>
	signNostrFundingAuthorization(event: DemoFridayUnsignedNostrBidV1): Promise<DemoFridaySignedNostrBidV1>
}

/**
 * Contract-independent package builder. Seller outputs come from the
 * independently authenticated trusted-auction port; the builder may not
 * select or replace them. It must return the lead's final exact envelope.
 */
export interface DemoFridayBrowserExactEnvelopeBuilderPort {
	buildAbortCapsuleExact(input: {
		operation: DemoFridayBrowserPublicOperationV1
		lockedToken: string
		keyset: DemoRecipientKeyset
		refundDelivery: DemoFridayBrowserRefundDeliveryV1
		refundRequest: DemoRecipientCoordinatorRequest
		signing: DemoFridayOperationBoundSigningV1
		nowSeconds: number
	}): Promise<DemoFridayFundingAbortRecoveryCapsuleV1>
	buildExact(input: {
		operation: DemoFridayBrowserPublicOperationV1
		lockedToken: string
		keyset: DemoRecipientKeyset
		winnerRequest: DemoRecipientCoordinatorRequest
		winnerAuctionPayout?: DemoFridayAuctionPayoutBindingV1
		refundDelivery: DemoFridayBrowserRefundDeliveryV1
		refundRequest: DemoRecipientCoordinatorRequest
		signing: DemoFridayOperationBoundSigningV1
		nowSeconds: number
	}): Promise<{ envelope: unknown }>
}

export interface DemoFridayFundingAdmissionStatusV1 {
	status: 'prepared' | 'admitted' | 'rejected_return' | 'unknown'
	preparationId: string
	fundingOperationId: string
	fundingAuthorizationEventId: string
	bidAmount: number
	reservedPoolAmount: number
	canonicalMintUrl: string
	signedBidEventId?: string
	receiptDigest?: string
	transactionHash?: string
	committedHeight?: number
	rejectionReason?: 'auction_not_open' | 'seller_self_bid' | 'late' | 'below_minimum' | 'stale_leader' | 'funding_expired'
}

/** Lead-owned same-origin transport maps its final wire schema into these normalized values. */
export interface DemoFridayFundingAdmissionPort {
	prepareExact(envelope: unknown): Promise<DemoFridayPreparedBidV1 & {
		fundingOperationId: string
		bidAmount: number
		reservedPoolAmount: number
		canonicalMintUrl: string
	}>
	finalizeExact(request: {
		preparationId: string
		fundingOperationId: string
		fundingAuthorizationEventId: string
		signedBid: DemoFridaySignedNostrBidV1
	}): Promise<DemoFridayFundingAdmissionStatusV1>
	/** Read-only recovery. It must never create a new authorization or bid. */
	readExact(request: {
		preparationId: string
		fundingOperationId: string
		fundingAuthorizationEventId: string
	}): Promise<DemoFridayFundingAdmissionStatusV1>
}

export interface DemoFridayCocoTerminalPort {
	readNoticeExact(request: { actor: string; fundingOperationId: string }): Promise<unknown | null>
	acknowledgeExact(request: {
		schema: 'PLEBEIAN_FRIDAY_COCO_TERMINAL_ACK_V1'
		actor: string
		fundingOperationId: string
		noticeDigest: string
		importReceipt: DemoFridayTerminalAckV1['importReceipt']
		recipientAckSignature: string
	}): Promise<void>
}

export interface DemoFridayBrowserCocoClient {
	prepareAndFinalize(request: DemoFridayBrowserFundingRequestV1): Promise<DemoFridayFundingAdmissionStatusV1>
	/** Resume only the persisted exact signed bid; cannot lock, rebuild, re-sign, or substitute bytes. */
	recoverExact(identity: DemoFridayBrowserOperationIdentity): Promise<DemoFridayFundingAdmissionStatusV1>
	importRefundExact(identity: DemoFridayBrowserOperationIdentity): Promise<DemoRecipientImportReceipt | null>
}

function refuse(message: string): never {
	throw new Error(`DEMO_FRIDAY_BROWSER_COCO_CLIENT: ${message}`)
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value)) refuse('canonical value contains a non-safe integer')
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
	if (typeof value !== 'object') refuse('canonical value contains an unsupported type')
	const record = value as Record<string, unknown>
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

function exactCanonicalMint(value: string): string {
	let url: URL
	try { url = new URL(value) } catch { return refuse('canonical mint identity is invalid') }
	if (value !== url.origin || url.protocol !== 'https:' || url.port !== '' || url.username !== ''
		|| url.password !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
		refuse('canonical mint identity must be the validated public HTTPS origin')
	}
	return url.origin
}

function exactDeployment(value: DemoFridayTrustedBrowserDeploymentV1): DemoFridayTrustedBrowserDeploymentV1 {
	if (value.schema !== 'PLEBEIAN_FRIDAY_TRUSTED_BROWSER_DEPLOYMENT_V1' || !ID.test(value.environmentId)
		|| !ID.test(value.authNetworkId) || !ID.test(value.chainId) || !HEX_32.test(value.genesisSha256)
		|| !/^(?:02|03)[0-9a-f]{64}$/.test(value.committeePublicKey)
		|| !ID.test(value.committeeKeysetId) || !ID.test(value.committeeKeysetVersion) || !ID.test(value.dkgRunId)
		|| !HEX_32.test(value.publicKeyPackageSha256) || !HEX_32.test(value.signerRosterDigest)
		|| !Array.isArray(value.participants) || value.participants.length !== 4
		|| value.participants.some((participant, index) => participant.identifier !== index + 1
			|| !/^(?:02|03)[0-9a-f]{64}$/.test(participant.verifyingShare))) {
		refuse('trusted deployment is malformed')
	}
	const canonicalMintUrl = exactCanonicalMint(value.canonicalMintUrl)
	const snapshot = structuredClone(value.mintSnapshot)
	const keyset = structuredClone(value.keyset)
	const amounts = Object.keys(keyset.keys).map(Number).filter(Number.isSafeInteger).sort((a, b) => a - b)
	if (snapshot.mintUrl !== canonicalMintUrl || !/^(?:02|03)[0-9a-f]{64}$/.test(snapshot.mintPublicKey)
		|| snapshot.activeSatKeysetId !== keyset.id || keyset.unit !== 'sat'
		|| snapshot.denominationKeyDigest !== demoDenominationKeyDigest(keyset.keys)
		|| JSON.stringify([...snapshot.denominationAmounts].sort((a, b) => a - b)) !== JSON.stringify(amounts)
		|| snapshot.inputFeePpk !== 0 || ![4, 7, 9, 10, 11, 12].every((nut) => snapshot.nuts.includes(nut))) {
		refuse('trusted deployment does not pin the exact zero-fee Coco mint cryptographic snapshot')
	}
	return { ...structuredClone(value), canonicalMintUrl, mintSnapshot: snapshot, keyset }
}

function exactRequest(value: DemoFridayBrowserFundingRequestV1): DemoFridayBrowserFundingRequestV1 {
	if (!ID.test(value.auctionId) || !ID.test(value.fundingOperationId)
		|| !Number.isSafeInteger(value.bidAmount) || value.bidAmount < 1 || value.bidAmount > 50_000
		|| !Number.isSafeInteger(value.fullPoolAmount) || value.fullPoolAmount < 1 || value.fullPoolAmount > value.bidAmount
		|| !Number.isSafeInteger(value.reservedPoolAmount) || value.reservedPoolAmount < 1
		|| value.reservedPoolAmount > value.fullPoolAmount
		|| (value.replacesBidId !== '' && !HEX_32.test(value.replacesBidId))
		|| !Number.isSafeInteger(value.locktime) || value.locktime < 1) refuse('funding request is invalid')
	return structuredClone(value)
}

function exactTrustedAuctionFunding(options: {
	value: DemoFridayTrustedAuctionFundingV1
	request: DemoFridayBrowserFundingRequestV1
	deployment: DemoFridayTrustedBrowserDeploymentV1
	actor: string
	nowSeconds: number
}): DemoFridayTrustedAuctionFundingV1 {
	const { value, request, deployment, actor } = options
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
			'auctionId', 'leaderActor', 'leaderBidAmount', 'leaderBidId', 'schema', 'sellerPaymentPublicKey', 'winnerRequest',
			...(value.winnerAuctionPayout === undefined ? [] : ['winnerAuctionPayout']),
		].sort())
		|| value.schema !== 'PLEBEIAN_FRIDAY_TRUSTED_AUCTION_FUNDING_V1'
		|| value.auctionId !== request.auctionId
		|| !/^(?:02|03)[0-9a-f]{64}$/.test(value.sellerPaymentPublicKey)
		|| ((value.leaderBidId === '') !== (value.leaderActor === ''))
		|| ((value.leaderBidId === '') !== (value.leaderBidAmount === 0))
		|| (value.leaderBidId !== '' && (!HEX_32.test(value.leaderBidId) || !HEX_32.test(value.leaderActor)
			|| !Number.isSafeInteger(value.leaderBidAmount) || value.leaderBidAmount < 1))) {
		refuse('trusted auction leader identity is malformed or belongs to another auction')
	}
	if (request.replacesBidId !== value.leaderBidId) refuse('replacement id is stale before Coco reservation')
	if (value.leaderActor === actor) {
		refuse('same-actor raise requires prior full-pool proof linkage and stable auction-level keys')
	}
	if (request.fullPoolAmount !== request.bidAmount || request.reservedPoolAmount !== request.fullPoolAmount) {
		refuse('new or competitor bid must reserve its complete committed pool')
	}
	const winnerRequest = value.winnerRequest
	if (winnerRequest === null || typeof winnerRequest !== 'object' || Array.isArray(winnerRequest)
		|| JSON.stringify(Object.keys(winnerRequest).sort()) !== JSON.stringify(['capability', 'outputs'])
		|| !Array.isArray(winnerRequest.outputs) || winnerRequest.outputs.length < 1
		|| winnerRequest.outputs.some((output) => output === null || typeof output !== 'object' || Array.isArray(output)
			|| JSON.stringify(Object.keys(output).sort()) !== JSON.stringify(['B_', 'amount', 'id'])
			|| !Number.isSafeInteger(output.amount) || output.amount < 1 || output.id !== deployment.keyset.id
			|| !/^(?:02|03)[0-9a-f]{64}$/.test(output.B_))
		|| winnerRequest.outputs.reduce((sum, output) => sum + output.amount, 0) !== request.fullPoolAmount) {
		refuse('trusted seller winner outputs are malformed or differ from the full pool')
	}
	const capability = winnerRequest.capability
	if (capability === null || typeof capability !== 'object' || Array.isArray(capability)
		|| JSON.stringify(Object.keys(capability).sort()) !== JSON.stringify([
			'auctionId', 'chainId', 'mintUrl', 'network', 'operationId', 'outputsDigest',
			'recipientPublicKey', 'role', 'schema', 'signature', 'unit',
		].sort())
		|| capability.schema !== 'COCO_DEMO_RECIPIENT_CAPABILITY_V1'
		|| capability.network !== deployment.authNetworkId || capability.chainId !== deployment.chainId
		|| capability.auctionId !== request.auctionId
		|| capability.role !== 'winner_settlement' || capability.mintUrl !== deployment.canonicalMintUrl
		|| capability.unit !== 'sat' || !/^(?:02|03)[0-9a-f]{64}$/.test(capability.recipientPublicKey)
		|| capability.recipientPublicKey !== value.sellerPaymentPublicKey
		|| !HEX_64.test(capability.signature)
		|| !schnorr.verify(hexToBytes(capability.signature), hexToBytes(demoRecipientCapabilityDigest(capability)),
			hexToBytes(capability.recipientPublicKey.slice(2)))) {
		refuse('trusted seller recipient commitment is not exact or authentically signed')
	}
	if (value.winnerAuctionPayout === undefined) {
		if (capability.operationId !== request.fundingOperationId
			|| capability.outputsDigest !== demoOutputsDigest(winnerRequest.outputs)) {
			refuse('operation seller recipient commitment does not bind the exact outputs')
		}
	} else {
		const payout = value.winnerAuctionPayout
		if (JSON.stringify(payout.keyset) !== JSON.stringify(deployment.keyset)) {
			refuse('auction payout keyset differs from the pinned deployment')
		}
		const selection = verifyDemoFridayAuctionPayoutSelectionStatic(payout.selection, {
			authorization: payout.authorization, keyset: payout.keyset, observedAt: options.nowSeconds,
		})
		if (selection.auctionId !== request.auctionId || selection.fundingOperationId !== request.fundingOperationId
			|| selection.bidderActor !== actor || selection.bidAmount !== request.fullPoolAmount
			|| selection.replacesBidId !== request.replacesBidId
			|| canonicalJson(selection.outputs) !== canonicalJson(winnerRequest.outputs)
			|| canonicalJson(payout.authorization.authorization.recipientCatalog.capability) !== canonicalJson(capability)) {
			refuse('auction payout selection differs from the exact bid request')
		}
	}
	return structuredClone(value)
}

export function demoFridayBrowserPublicOperation(record: DemoFridayBrowserPaymentOperationV1): DemoFridayBrowserPublicOperationV1 {
	return {
		actor: record.actor, authNetworkId: record.authNetworkId, chainId: record.chainId,
		auctionId: record.auctionId, fundingOperationId: record.fundingOperationId,
		canonicalMintUrl: record.canonicalMintUrl, mintPublicKey: record.mintPublicKey,
		mintServerVersion: record.mintServerVersion, keysetId: record.keysetId,
		denominationKeyDigest: record.denominationKeyDigest,
		denominationAmounts: [...record.denominationAmounts], mintNuts: [...record.mintNuts],
		bidAmount: record.bidAmount,
		fullPoolAmount: record.fullPoolAmount, reservedPoolAmount: record.reservedPoolAmount,
		replacesBidId: record.replacesBidId, priorLeaderActor: record.priorLeaderActor,
		paymentPublicKey: record.paymentPublicKey, refundPublicKey: record.refundPublicKey,
		winnerRecipientPublicKey: record.winnerRecipientPublicKey,
		winnerRecipientCapabilityDigest: record.winnerRecipientCapabilityDigest,
		winnerOutputsDigest: record.winnerOutputsDigest,
		...(record.winnerAuctionAuthorizationDigest === undefined ? {} : {
			winnerAuctionAuthorizationDigest: record.winnerAuctionAuthorizationDigest,
			winnerAuctionSelectionDigest: record.winnerAuctionSelectionDigest,
		}),
		committeePublicKey: record.lock.committeePubkey,
		committeeKeysetId: record.committeeKeysetId,
		committeeKeysetVersion: record.committeeKeysetVersion, locktime: record.lock.locktime,
	}
}

function exactEnvelope(value: unknown, operation: DemoFridayBrowserPaymentOperationV1, nowSeconds: number) {
	const verified = verifyDemoFridayPreparedFundingEnvelope(value, {
		authNetworkId: operation.authNetworkId, chainId: operation.chainId,
		mintUrl: operation.canonicalMintUrl, nowSeconds,
	})
	const { authorization, bundle } = verified
	const winner = bundle.winner, refund = bundle.refund
	const mintSeal = winner.mintSeal
	if (authorization.event.pubkey !== operation.actor || authorization.content.auctionId !== operation.auctionId
		|| authorization.content.fundingOperationId !== operation.fundingOperationId
		|| authorization.content.amount !== operation.fullPoolAmount
		|| authorization.content.paymentPublicKey !== operation.paymentPublicKey
		|| authorization.content.refundPublicKey !== operation.refundPublicKey
		|| winner.amount !== operation.fullPoolAmount || refund.amount !== operation.fullPoolAmount
		|| winner.recipientPublicKey !== operation.winnerRecipientPublicKey
		|| demoRecipientCapabilityDigest(winner.recipientCapability) !== operation.winnerRecipientCapabilityDigest
		|| demoOutputsDigest(winner.outputs) !== operation.winnerOutputsDigest
		|| winner.locktime !== operation.lock.locktime || winner.committeePublicKey !== operation.lock.committeePubkey
		|| winner.committeeKeysetId !== operation.committeeKeysetId
		|| winner.committeeKeysetVersion !== operation.committeeKeysetVersion
		|| mintSeal.mintUrl !== operation.canonicalMintUrl || mintSeal.mintPublicKey !== operation.mintPublicKey
		|| mintSeal.serverVersion !== operation.mintServerVersion || mintSeal.activeSatKeysetId !== operation.keysetId
		|| mintSeal.denominationKeyDigest !== operation.denominationKeyDigest
		|| JSON.stringify(mintSeal.denominationAmounts) !== JSON.stringify(operation.denominationAmounts)
		|| mintSeal.inputFeePpk !== operation.inputFeePpk
		|| JSON.stringify(mintSeal.nuts) !== JSON.stringify(operation.mintNuts)) {
		refuse('verified exact envelope differs from the persisted operation and mint snapshot')
	}
	return verified
}

function exactPrepared(value: DemoFridayPreparedBidV1 & {
	fundingOperationId: string; bidAmount: number; reservedPoolAmount: number; canonicalMintUrl: string
}, operation: DemoFridayBrowserPaymentOperationV1, nowSeconds: number): DemoFridayPreparedBidV1 {
	if (!ID.test(value.preparationId) || value.fundingOperationId !== operation.fundingOperationId
		|| value.fundingAuthorizationEventId !== operation.fundingAuthorizationEventId
		|| value.bidAmount !== operation.bidAmount || value.reservedPoolAmount !== operation.reservedPoolAmount
		|| value.canonicalMintUrl !== operation.canonicalMintUrl) refuse('server preparation differs from the exact operation')
	const receiptDigest = exactUnsignedBid(value.unsignedBid, operation, nowSeconds)
	if (value.receiptDigest !== receiptDigest) refuse('server receipt digest differs from the exact unsigned bid bytes')
	return { preparationId: value.preparationId, fundingAuthorizationEventId: value.fundingAuthorizationEventId,
		receiptDigest, unsignedBid: structuredClone(value.unsignedBid) }
}

/** Strict public parser used before NIP-07; no parallel metadata is trusted. */
export function exactDemoFridayCommitteeBidContent(contentValue: string): {
	receipt: DemoIntegratedFundingReceiptV4
	receiptDigest: string
} {
	let content: unknown
	try { content = JSON.parse(contentValue) } catch { refuse('unsigned bid content is not JSON') }
	if (content === null || typeof content !== 'object' || Array.isArray(content)
		|| JSON.stringify(Object.keys(content).sort()) !== JSON.stringify(['amount', 'auction_id', 'integrated_funding', 'replaces_bid_id'])) {
		refuse('unsigned bid content has missing or unexpected fields')
	}
	const raw = content as Record<string, unknown>
	const receipt = verifyDemoIntegratedFundingReceiptV4(raw.integrated_funding as DemoIntegratedFundingReceiptV4)
	const { participant_policy_digest: _policy, committee_signature: _signature, ...unsignedReceipt } = receipt
	const receiptDigest = demoIntegratedFundingV4ReceiptDigest(unsignedReceipt)
	if (raw.auction_id !== receipt.auction_id || raw.amount !== receipt.bid_amount
		|| raw.replaces_bid_id !== receipt.replaces_bid_id
		|| contentValue !== JSON.stringify({ auction_id: receipt.auction_id, amount: receipt.bid_amount,
			replaces_bid_id: receipt.replaces_bid_id, integrated_funding: receipt })) {
		refuse('unsigned bid content is not the canonical exact receipt body')
	}
	return { receipt, receiptDigest }
}

function exactUnsignedBid(
	value: DemoFridayUnsignedNostrBidV1,
	operation: DemoFridayBrowserPaymentOperationV1,
	nowSeconds: number,
): string {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(['content', 'created_at', 'kind', 'pubkey', 'tags'])
		|| value.pubkey !== operation.actor || value.kind !== BID_KIND
		|| !Number.isSafeInteger(value.created_at) || value.created_at < 1 || JSON.stringify(value.tags) !== '[]'
		|| typeof value.content !== 'string') refuse('server returned a malformed or cross-actor unsigned bid')
	const { receipt, receiptDigest } = exactDemoFridayCommitteeBidContent(value.content)
	const envelope = exactEnvelope(operation.envelope, operation, nowSeconds)
	const winner = envelope.bundle.winner, refund = envelope.bundle.refund
	const proofRefs = winner.inputs.map((proof) => bytesToHex(proofPoint(proof).toBytes(true))).sort()
	if (receipt.auth_network_id !== operation.authNetworkId || receipt.chain_id !== operation.chainId
		|| receipt.mint_url !== operation.canonicalMintUrl || receipt.auction_id !== operation.auctionId
		|| receipt.bidder !== operation.actor || receipt.bid_amount !== operation.bidAmount
		|| receipt.pool_amount !== operation.fullPoolAmount || receipt.replaces_bid_id !== operation.replacesBidId
		|| receipt.funding_operation_id !== operation.fundingOperationId
		|| receipt.attested_at !== value.created_at || receipt.proof_state_refs.join(',') !== proofRefs.join(',')
		|| receipt.active_keyset_id !== operation.keysetId || receipt.input_fee_ppk !== operation.inputFeePpk
		|| receipt.locktime !== operation.lock.locktime || receipt.bidder_public_key !== operation.paymentPublicKey
		|| receipt.refund_public_key !== operation.refundPublicKey || receipt.committee_public_key !== operation.lock.committeePubkey
		|| receipt.committee_keyset_id !== operation.committeeKeysetId
		|| receipt.committee_keyset_version !== operation.committeeKeysetVersion
		|| receipt.dkg_run_id !== operation.dkgRunId || receipt.public_key_package_sha256 !== operation.publicKeyPackageSha256
		|| receipt.signer_roster_digest !== operation.signerRosterDigest
		|| receipt.winner_package_digest !== winner.templateDigest || receipt.return_package_digest !== refund.templateDigest
		|| receipt.return_cashu_sigall_digest !== refund.cashuSigAllDigest
		|| receipt.bidder_return_signature !== refund.bidderMainSignature
		|| receipt.prepared_bundle_digest !== envelope.bundle.bundleDigest
		|| receipt.actor_funding_authorization.id !== operation.fundingAuthorizationEventId) {
		refuse('committee-signed bid receipt differs from persisted operation or exact package bytes')
	}
	return receiptDigest
}

function exactSignedBid(
	value: DemoFridaySignedNostrBidV1,
	unsigned: DemoFridayUnsignedNostrBidV1,
): DemoFridaySignedNostrBidV1 {
	if (!HEX_32.test(value.id) || !HEX_64.test(value.sig)
		|| value.pubkey !== unsigned.pubkey || value.created_at !== unsigned.created_at || value.kind !== unsigned.kind
		|| value.content !== unsigned.content || JSON.stringify(value.tags) !== JSON.stringify(unsigned.tags)) {
		refuse('NIP-07 signer changed the immutable unsigned bid')
	}
	const id = bytesToHex(sha256(utf8ToBytes(JSON.stringify([
		0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content,
	]))))
	if (value.id !== id || !schnorr.verify(hexToBytes(value.sig), hexToBytes(id), hexToBytes(unsigned.pubkey))) {
		refuse('NIP-07 returned an invalid bid event id or signature')
	}
	return structuredClone(value)
}

export function demoFridayAdmissionStatusDigest(status: DemoFridayFundingAdmissionStatusV1): string {
	return bytesToHex(sha256(utf8ToBytes(JSON.stringify([
		'PLEBEIAN_FRIDAY_ADMISSION_STATUS_DIGEST_V1', status.status, status.preparationId,
		status.fundingOperationId, status.fundingAuthorizationEventId, status.bidAmount,
		status.reservedPoolAmount, status.canonicalMintUrl, status.signedBidEventId ?? null,
		status.receiptDigest ?? null, status.transactionHash ?? null, status.committedHeight ?? null,
		status.rejectionReason ?? null,
	]))))
}

function exactStatus(
	status: DemoFridayFundingAdmissionStatusV1,
	operation: DemoFridayBrowserPaymentOperationV1,
	prepared: DemoFridayPreparedBidV1,
): DemoFridayFundingAdmissionStatusV1 {
	if (!['prepared', 'admitted', 'rejected_return', 'unknown'].includes(status.status)
		|| status.preparationId !== prepared.preparationId || status.fundingOperationId !== operation.fundingOperationId
		|| status.fundingAuthorizationEventId !== operation.fundingAuthorizationEventId
		|| status.bidAmount !== operation.bidAmount || status.reservedPoolAmount !== operation.reservedPoolAmount
		|| status.canonicalMintUrl !== operation.canonicalMintUrl) refuse('admission status differs from the persisted operation')
	const committed = status.status === 'admitted' || status.status === 'rejected_return'
	if (committed && (!HEX_32.test(status.signedBidEventId ?? '')
		|| !HEX_32.test(status.receiptDigest ?? '') || !HEX_32.test(status.transactionHash ?? '')
		|| !Number.isSafeInteger(status.committedHeight) || Number(status.committedHeight) < 1)) {
		refuse('committed status lacks its exact durable identity')
	}
	if (committed && (status.receiptDigest !== prepared.receiptDigest
		|| operation.signedBid === undefined || status.signedBidEventId !== operation.signedBid.id)) {
		refuse('committed status differs from the stored signed event or validated receipt digest')
	}
	if ((status.status === 'rejected_return') !== (status.rejectionReason !== undefined)
		|| (status.rejectionReason !== undefined && ![
			'auction_not_open', 'seller_self_bid', 'late', 'below_minimum', 'stale_leader', 'funding_expired',
		].includes(status.rejectionReason))) {
		refuse('committed rejection reason is malformed')
	}
	if (operation.phase === 'finalized' && !committed) {
		refuse('finalized operation regressed to a non-committed status')
	}
	if (operation.phase === 'finalized' && operation.finalizedStatusDigest !== demoFridayAdmissionStatusDigest(status)) {
		refuse('finalized recovery status differs from its canonical stored digest')
	}
	return structuredClone(status)
}

function phaseRank(value: DemoFridayBrowserPaymentOperationV1['phase']): number {
	return ['keys_ready', 'coco_send_pending', 'coco_locked', 'envelope_prepared', 'server_prepared', 'finalized'].indexOf(value)
}

function nextRecord(
	prior: DemoFridayBrowserPaymentOperationV1,
	patch: Partial<DemoFridayBrowserPaymentOperationV1>,
): DemoFridayBrowserPaymentOperationV1 {
	return { ...structuredClone(prior), ...structuredClone(patch), revision: prior.revision + 1 }
}

function assertSameRequest(
	operation: DemoFridayBrowserPaymentOperationV1,
	deployment: DemoFridayTrustedBrowserDeploymentV1,
	request: DemoFridayBrowserFundingRequestV1,
	auction: DemoFridayTrustedAuctionFundingV1,
): void {
	const winnerCapabilityDigest = demoRecipientCapabilityDigest(auction.winnerRequest.capability)
	const winnerOutputDigest = demoOutputsDigest(auction.winnerRequest.outputs)
	if (operation.environmentId !== deployment.environmentId || operation.authNetworkId !== deployment.authNetworkId
		|| operation.chainId !== deployment.chainId || operation.canonicalMintUrl !== deployment.canonicalMintUrl
		|| operation.auctionId !== request.auctionId || operation.fundingOperationId !== request.fundingOperationId
		|| operation.bidAmount !== request.bidAmount || operation.fullPoolAmount !== request.fullPoolAmount
		|| operation.reservedPoolAmount !== request.reservedPoolAmount || operation.replacesBidId !== request.replacesBidId
		|| operation.priorLeaderActor !== auction.leaderActor
		|| operation.winnerRecipientPublicKey !== auction.winnerRequest.capability.recipientPublicKey
		|| operation.winnerRecipientCapabilityDigest !== winnerCapabilityDigest
		|| operation.winnerOutputsDigest !== winnerOutputDigest
		|| operation.winnerAuctionAuthorizationDigest !== auction.winnerAuctionPayout?.authorization.authorizationDigest
		|| operation.winnerAuctionSelectionDigest !== auction.winnerAuctionPayout?.selection.selectionDigest
		|| operation.keysetId !== deployment.keyset.id || operation.lock.committeePubkey !== deployment.committeePublicKey
		|| operation.lock.locktime !== request.locktime) refuse('operation retry changed immutable funding terms')
}

async function prepareRefundDelivery(options: {
	operation: DemoFridayBrowserPaymentOperationV1
	keyset: DemoRecipientKeyset
	state: DemoFridayBrowserPaymentStatePort
	refundSigner: DemoFridayPaymentSigner
}): Promise<{ delivery: DemoFridayBrowserRefundDeliveryV1; request: DemoRecipientCoordinatorRequest }> {
	const operation = options.operation
	const intent = {
		schema: 'COCO_DEMO_RECIPIENT_INTENT_V1' as const, network: operation.authNetworkId,
		chainId: operation.chainId, auctionId: operation.auctionId, operationId: operation.fundingOperationId,
		role: 'refund' as const, mintUrl: operation.canonicalMintUrl, unit: 'sat' as const,
		recipientPublicKey: operation.refundPublicKey, amounts: splitAmount(operation.fullPoolAmount),
	}
	const request = await prepareDemoSigAllRecipientOutputs({
		intent, keyset: options.keyset, journal: options.state,
		roleBinding: {
			async assertWinnerRecipient() { refuse('refund operation was presented as winner settlement') },
			async assertRefundRecipient(binding) {
				if (binding.recipientPublicKey !== operation.refundPublicKey
					|| binding.operationId !== operation.fundingOperationId) refuse('refund recipient differs from operation')
			},
		},
		signer: { signCapability: (value) => options.refundSigner.signRecipientCapability(value) },
		outputFactory: {
			async createRecipientOwnedOutput(value) {
				const opening = blindMessage(randomSecretHex())
				return {
					message: { amount: value.amount, id: value.keysetId, B_: opening.B_ },
					privateOpeningRef: { secret: opening.secret, r: opening.r.toString(16).padStart(64, '0'), B_: opening.B_ },
				}
			},
		},
	})
	return { delivery: { intent, keyset: structuredClone(options.keyset) }, request }
}

async function assertOpeningsStayPrivate(
	state: DemoFridayBrowserPaymentStatePort,
	delivery: DemoFridayBrowserRefundDeliveryV1,
	envelope: unknown,
): Promise<void> {
	const scope = `${delivery.intent.network}\u0000${delivery.intent.chainId}\u0000${delivery.intent.auctionId}\u0000${delivery.intent.operationId}`
	const record = await state.load(scope)
	if (record === null) refuse('refund opening journal is absent after package construction')
	const serialized = JSON.stringify(envelope)
	if (serialized.includes('http://')) {
		refuse('exact browser envelope contains a cleartext/internal transport origin')
	}
	for (const opening of record.privateOpeningRefs) {
		if (serialized.includes(opening.secret) || serialized.includes(opening.r)) {
			refuse('exact envelope attempted to publish recipient-private opening material')
		}
	}
}

function exactFundingTerms(
	value: DemoFridayFundingKeyAuthorizationTermsV1,
	operation: DemoFridayBrowserPaymentOperationV1,
): void {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
			'auctionId', 'authNetworkId', 'bidderReturnSignature', 'bundleDigest', 'chainId', 'expiresAt',
			'fundingOperationId', 'mintUrl', 'paymentPublicKey', 'refundPublicKey', 'returnCashuSigAllDigest',
			'returnPackageDigest', 'schema', 'amount',
		].sort())
		|| value.schema !== 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_AUTHORIZATION_V1'
		|| value.authNetworkId !== operation.authNetworkId || value.chainId !== operation.chainId
		|| value.auctionId !== operation.auctionId || value.amount !== operation.fullPoolAmount
		|| value.mintUrl !== operation.canonicalMintUrl || value.paymentPublicKey !== operation.paymentPublicKey
		|| value.refundPublicKey !== operation.refundPublicKey
		|| value.fundingOperationId !== operation.fundingOperationId
		|| !HEX_32.test(value.bundleDigest) || !HEX_32.test(value.returnPackageDigest)
		|| !HEX_32.test(value.returnCashuSigAllDigest) || !HEX_64.test(value.bidderReturnSignature)
		|| !Number.isSafeInteger(value.expiresAt) || value.expiresAt < 1) {
		refuse('builder requested a funding signature outside the persisted operation')
	}
}

export function createDemoFridayOperationBoundSigning(options: {
	operation: DemoFridayBrowserPaymentOperationV1
	paymentSigner: DemoFridayPaymentSigner
	refundSigner: DemoFridayPaymentSigner
	nostrSigner: DemoFridayNostrSignerPort
	lockedToken: string
	winnerRequest: DemoRecipientCoordinatorRequest
	refundRequest: DemoRecipientCoordinatorRequest
}): DemoFridayOperationBoundSigningV1 {
	const { operation } = options
	let decoded: { proofs?: Array<{ secret?: unknown }> }
	try { decoded = getDecodedToken(options.lockedToken, [operation.keysetId]) as typeof decoded }
	catch { return refuse('locked Coco token cannot bind package signing capabilities') }
	const lockedSecrets = (decoded.proofs ?? []).map((proof) => proof.secret)
	if (lockedSecrets.length < 1 || lockedSecrets.some((secret) => typeof secret !== 'string')) {
		refuse('locked Coco token contains no exact package inputs')
	}
	lockedSecrets.sort((left, right) => bytesToHex(proofPoint({ secret: String(left) }).toBytes(true))
		.localeCompare(bytesToHex(proofPoint({ secret: String(right) }).toBytes(true))))
	const refundOutputs = options.refundRequest.outputs.map(({ B_ }) => ({ B_ }))
	const winnerOutputs = options.winnerRequest.outputs.map(({ B_ }) => ({ B_ }))
	const cashuUses = new Set<string>()
	const templateUses = new Set<string>()
	let bundleAuthorizationUsed = false
	let keyAuthorizationUsed = false
	let nostrAuthorizationUsed = false
	return Object.freeze({
		async signCashuPackage(request) {
			if (request === null || typeof request !== 'object' || Array.isArray(request)
				|| JSON.stringify(Object.keys(request).sort()) !== JSON.stringify(['authority', 'inputs', 'operationId', 'outputs', 'role'])
				|| request.inputs.some((input) => JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(['secret']))
				|| request.outputs.some((output) => JSON.stringify(Object.keys(output).sort()) !== JSON.stringify(['B_']))
				|| JSON.stringify(request.inputs.map(({ secret }) => secret)) !== JSON.stringify(lockedSecrets)
				|| (request.role === 'winner_settlement' && JSON.stringify(request.outputs) !== JSON.stringify(winnerOutputs))
				|| (request.role === 'refund' && JSON.stringify(request.outputs) !== JSON.stringify(refundOutputs))
				|| request.operationId !== operation.fundingOperationId
				|| !['winner_settlement', 'refund'].includes(request.role)
				|| !['payment', 'refund'].includes(request.authority)
				|| (request.authority === 'refund' && request.role !== 'refund')) {
				refuse('builder requested a Cashu signature outside its role and operation')
			}
			const use = `${request.role}:${request.authority}`
			if (cashuUses.has(use)) refuse('builder requested the same role-bound Cashu signature twice')
			cashuUses.add(use)
			const signer = request.authority === 'payment' ? options.paymentSigner : options.refundSigner
			return signer.signCashuSigAllPackage({ inputs: request.inputs, outputs: request.outputs })
		},
		async signTemplateAuthorization(request) {
			if (request === null || typeof request !== 'object' || request.operationId !== operation.fundingOperationId
				|| request.template.operationId !== operation.fundingOperationId || request.template.role !== request.role
				|| request.template.bidderPublicKey !== operation.paymentPublicKey
				|| !['winner_settlement', 'refund'].includes(request.role)) {
				refuse('builder requested a template authorization outside its role and operation')
			}
			if (templateUses.has(request.role)) refuse('builder requested the same role-bound template authorization twice')
			templateUses.add(request.role)
			return options.paymentSigner.signFridayTemplateAuthorization(request)
		},
		async signBundleAuthorization(request) {
			if (bundleAuthorizationUsed || request === null || typeof request !== 'object'
				|| request.operationId !== operation.fundingOperationId
				|| request.winner.operationId !== operation.fundingOperationId
				|| request.refund.operationId !== operation.fundingOperationId) {
				refuse('builder requested a repeated or cross-operation bundle authorization')
			}
			bundleAuthorizationUsed = true
			return options.paymentSigner.signFridayBundleAuthorization(request)
		},
		async signFundingKeys(value) {
			if (keyAuthorizationUsed) refuse('builder requested funding-key signatures twice')
			exactFundingTerms(value, operation)
			keyAuthorizationUsed = true
			return {
				paymentKeyAuthorizationSignature: await options.paymentSigner.signFridayFundingKeyAuthorization(operation.actor, value),
				refundKeyAuthorizationSignature: await options.refundSigner.signFridayFundingKeyAuthorization(operation.actor, value),
			}
		},
		async signNostrFundingAuthorization(event) {
			if (nostrAuthorizationUsed || event.pubkey !== operation.actor
				|| JSON.stringify(Object.keys(event).sort()) !== JSON.stringify(['content', 'created_at', 'kind', 'pubkey', 'tags'])) {
				refuse('builder requested a repeated or cross-actor Nostr funding authorization')
			}
			let content: unknown
			try { content = JSON.parse(event.content) } catch { refuse('builder funding authorization is not JSON') }
			const exactContent = exactDemoFridayFundingAuthorizationContent(content)
			const { paymentKeyAuthorizationSignature: _payment, refundKeyAuthorizationSignature: _refund, ...terms } = exactContent
			exactFundingTerms(terms, operation)
			const expected = demoFridayFundingAuthorizationUnsignedEvent(operation.actor, event.created_at, exactContent)
			if (JSON.stringify(event) !== JSON.stringify(expected)) {
				refuse('builder funding authorization is not the canonical exact event')
			}
			nostrAuthorizationUsed = true
			return exactSignedBid(await options.nostrSigner.signEvent(structuredClone(event)), event)
		},
	} satisfies DemoFridayOperationBoundSigningV1)
}

export function createDemoFridayBrowserCocoClient(options: {
	deployment: DemoFridayTrustedBrowserDeploymentPort
	auction: DemoFridayTrustedAuctionFundingPort
	walletFactory: DemoFridayBrowserCocoWalletFactoryPort
	state: DemoFridayBrowserPaymentStatePort
	nostrSigner: DemoFridayNostrSignerPort
	builder: DemoFridayBrowserExactEnvelopeBuilderPort
	admission: DemoFridayFundingAdmissionPort
	terminal: DemoFridayCocoTerminalPort
	nowSeconds?: () => number
}): DemoFridayBrowserCocoClient {
	const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1_000))
	return Object.freeze({
		async prepareAndFinalize(requestValue) {
			const request = exactRequest(requestValue)
			const deployment = exactDeployment(await options.deployment.readExact())
			const actor = await options.nostrSigner.getPublicKey()
			if (!HEX_32.test(actor)) refuse('Nostr actor identity is malformed')
			const identity = { actor, environmentId: deployment.environmentId, fundingOperationId: request.fundingOperationId }
			return options.state.runWalletExclusive(identity, async () => {
				const auction = exactTrustedAuctionFunding({
					value: await options.auction.readExact({ auctionId: request.auctionId,
						fundingOperationId: request.fundingOperationId, fullPoolAmount: request.fullPoolAmount }),
					request, deployment, actor, nowSeconds: nowSeconds(),
				})
				const wallet = await options.walletFactory.openExact({ actor, environmentId: deployment.environmentId,
					canonicalMintUrl: deployment.canonicalMintUrl })
				return useFridayWallet(wallet, async () => {
					if (wallet.actor !== actor || wallet.mintUrl !== deployment.canonicalMintUrl) {
						refuse('Coco wallet identity differs after wallet-locked opening')
					}
					const snapshot = await wallet.inspect()
					if (JSON.stringify(snapshot) !== JSON.stringify(deployment.mintSnapshot)) {
						refuse('Coco mint inspection differs from the pinned cryptographic deployment snapshot')
					}
					return await options.state.runOperationExclusive(identity, async () => {
				let operation = await options.state.loadOperation(identity)
				if (operation === null) {
					const input: DemoFridayBrowserPaymentOperationInput = {
						...identity, authNetworkId: deployment.authNetworkId, chainId: deployment.chainId,
						auctionId: request.auctionId, canonicalMintUrl: deployment.canonicalMintUrl,
						mintPublicKey: deployment.mintSnapshot.mintPublicKey,
						mintServerVersion: deployment.mintSnapshot.serverVersion,
						bidAmount: request.bidAmount, fullPoolAmount: request.fullPoolAmount,
						reservedPoolAmount: request.reservedPoolAmount, replacesBidId: request.replacesBidId,
						priorLeaderActor: auction.leaderActor,
						winnerRecipientPublicKey: auction.winnerRequest.capability.recipientPublicKey,
						winnerRecipientCapabilityDigest: demoRecipientCapabilityDigest(auction.winnerRequest.capability),
						winnerOutputsDigest: demoOutputsDigest(auction.winnerRequest.outputs),
						...(auction.winnerAuctionPayout === undefined ? {} : {
							winnerAuctionAuthorizationDigest: auction.winnerAuctionPayout.authorization.authorizationDigest,
							winnerAuctionSelectionDigest: auction.winnerAuctionPayout.selection.selectionDigest,
						}),
						keysetId: deployment.keyset.id, denominationKeyDigest: deployment.mintSnapshot.denominationKeyDigest,
						denominationAmounts: [...deployment.mintSnapshot.denominationAmounts],
						mintNuts: [...deployment.mintSnapshot.nuts], inputFeePpk: 0,
						committeePublicKey: deployment.committeePublicKey,
						committeeKeysetId: deployment.committeeKeysetId,
						committeeKeysetVersion: deployment.committeeKeysetVersion, dkgRunId: deployment.dkgRunId,
						publicKeyPackageSha256: deployment.publicKeyPackageSha256,
						signerRosterDigest: deployment.signerRosterDigest,
						locktime: request.locktime,
					}
					operation = createDemoFridayBrowserPaymentOperation(input)
					await options.state.saveOperation(operation, null)
				} else assertSameRequest(operation, deployment, request, auction)

				const paymentSigner = createDemoFridayPaymentSignerFromSecret(hexToBytes(operation.paymentSecret))
				const refundSigner = createDemoFridayPaymentSignerFromSecret(hexToBytes(operation.refundSecret))
				let lockedToken: string
				if (operation.phase === 'keys_ready') {
					// First make the exact Coco operation durable without mint I/O.
					// Only then record the application marker that authorizes resume.
					// A marker with a missing Coco operation therefore fails closed.
					const prepared = await wallet.prepareThresholdFundingOperation({
						amount: operation.reservedPoolAmount, operationId: operation.fundingOperationId, lock: operation.lock,
					})
					if (prepared.operationId !== operation.fundingOperationId
						|| !['prepared', 'executing', 'pending'].includes(prepared.state)) {
						refuse('Coco threshold operation was not durably prepared')
					}
					const advanced = nextRecord(operation, { phase: 'coco_send_pending' })
					await options.state.saveOperation(advanced, operation.revision); operation = advanced
				}
				if (operation.phase === 'coco_send_pending') {
					const locked = await wallet.prepareThresholdFunding({
						amount: operation.reservedPoolAmount, operationId: operation.fundingOperationId, lock: operation.lock,
					})
					if (locked.keysetId !== operation.keysetId) refuse('Coco locked another keyset')
					lockedToken = locked.token
					// Construct and persist the independent return capsule before any
					// winner/bid envelope work. A structural winner-package failure must
					// not strand the already locked Coco operation.
					const refund = await prepareRefundDelivery({ operation, keyset: deployment.keyset,
						state: options.state, refundSigner })
					const capsule = await options.builder.buildAbortCapsuleExact({
						operation: demoFridayBrowserPublicOperation(operation), lockedToken,
						keyset: deployment.keyset,
						refundDelivery: refund.delivery, refundRequest: refund.request,
						signing: createDemoFridayOperationBoundSigning({ operation, paymentSigner, refundSigner,
							nostrSigner: options.nostrSigner, lockedToken,
							winnerRequest: auction.winnerRequest, refundRequest: refund.request }),
						nowSeconds: nowSeconds(),
					})
					const advanced = nextRecord(operation, { phase: 'coco_locked', abortCapsule: capsule,
						refundDelivery: refund.delivery })
					await options.state.saveOperation(advanced, operation.revision); operation = advanced
				} else {
					const locked = await wallet.recoverThresholdFunding({
						amount: operation.reservedPoolAmount, operationId: operation.fundingOperationId,
						keysetId: operation.keysetId, lock: operation.lock,
					})
					lockedToken = locked.token
				}

				try {
					if (operation.phase === 'coco_locked') {
						const refund = await prepareRefundDelivery({ operation, keyset: deployment.keyset, state: options.state, refundSigner })
						const built = await options.builder.buildExact({
							operation: demoFridayBrowserPublicOperation(operation), lockedToken,
							keyset: deployment.keyset,
							winnerRequest: structuredClone(auction.winnerRequest),
							winnerAuctionPayout: auction.winnerAuctionPayout === undefined
								? undefined : structuredClone(auction.winnerAuctionPayout),
							refundDelivery: refund.delivery, refundRequest: refund.request,
							signing: createDemoFridayOperationBoundSigning({ operation, paymentSigner, refundSigner,
								nostrSigner: options.nostrSigner, lockedToken,
								winnerRequest: auction.winnerRequest, refundRequest: refund.request }),
							nowSeconds: nowSeconds(),
						})
						const verified = exactEnvelope(built.envelope, operation, nowSeconds())
						await assertOpeningsStayPrivate(options.state, refund.delivery, built.envelope)
						const advanced = nextRecord(operation, {
							phase: 'envelope_prepared', envelope: structuredClone(built.envelope),
							fundingAuthorizationEventId: verified.authorization.event.id,
							refundDelivery: refund.delivery,
						})
						await options.state.saveOperation(advanced, operation.revision); operation = advanced
					}
					if (operation.phase === 'envelope_prepared') {
						const prepared = exactPrepared(
							await options.admission.prepareExact(structuredClone(operation.envelope)), operation, nowSeconds(),
						)
						const advanced = nextRecord(operation, { phase: 'server_prepared', preparedBid: prepared })
						await options.state.saveOperation(advanced, operation.revision); operation = advanced
					}
					if (operation.preparedBid === undefined) refuse('prepared bid is absent')
					if (operation.phase === 'server_prepared' && operation.signedBid === undefined) {
						const signed = exactSignedBid(
							await options.nostrSigner.signEvent(structuredClone(operation.preparedBid.unsignedBid)),
							operation.preparedBid.unsignedBid,
						)
						const advanced = nextRecord(operation, { signedBid: signed })
						await options.state.saveOperation(advanced, operation.revision); operation = advanced
					}
					if (operation.signedBid === undefined) refuse('signed bid is absent')
					const preparedBid = operation.preparedBid
					const signedBid = operation.signedBid
					const authorizationEventId = operation.fundingAuthorizationEventId
					if (preparedBid === undefined || authorizationEventId === undefined) refuse('prepared funding identity is absent')
					let status = exactStatus(await options.admission.readExact({
						preparationId: preparedBid.preparationId,
						fundingOperationId: operation.fundingOperationId,
						fundingAuthorizationEventId: authorizationEventId,
					}), operation, preparedBid)
					// The server persists the exact signed transaction before its first
					// broadcast attempt.  Re-submitting these same immutable bytes asks it
					// to recover that transaction; it must never create or blindly
					// rebroadcast another bid when the prior outcome is unknown.
					if (status.status !== 'admitted' && status.status !== 'rejected_return') {
						status = exactStatus(await options.admission.finalizeExact({
							preparationId: preparedBid.preparationId,
							fundingOperationId: operation.fundingOperationId,
							fundingAuthorizationEventId: authorizationEventId,
							signedBid,
						}), operation, preparedBid)
					}
					if (status.status !== 'admitted' && status.status !== 'rejected_return') {
						refuse('funding admission did not reach authenticated committed status')
					}
					if (status.signedBidEventId !== signedBid.id) refuse('admitted status names another signed bid')
					if (operation.phase !== 'finalized') {
						const advanced = nextRecord(operation, { phase: 'finalized', finalizedStatusDigest: demoFridayAdmissionStatusDigest(status) })
						await options.state.saveOperation(advanced, operation.revision)
					}
					return status
				} finally { paymentSigner.dispose(); refundSigner.dispose() }
					})
				})
			})
		},

		async recoverExact(identityValue) {
			const identity = { ...identityValue }
			return options.state.runWalletExclusive(identity, () => options.state.runOperationExclusive(identity, async () => {
				const operation = await options.state.loadOperation(identity)
				if (operation === null || phaseRank(operation.phase) < phaseRank('server_prepared')
					|| operation.preparedBid === undefined || operation.fundingAuthorizationEventId === undefined) {
					refuse('operation has no server-prepared identity to recover')
				}
				let status = exactStatus(await options.admission.readExact({
					preparationId: operation.preparedBid.preparationId,
					fundingOperationId: operation.fundingOperationId,
					fundingAuthorizationEventId: operation.fundingAuthorizationEventId,
				}), operation, operation.preparedBid)
				if (status.status !== 'admitted' && status.status !== 'rejected_return') {
					if (operation.signedBid === undefined) refuse('operation has no exact signed bid to recover')
					status = exactStatus(await options.admission.finalizeExact({
						preparationId: operation.preparedBid.preparationId,
						fundingOperationId: operation.fundingOperationId,
						fundingAuthorizationEventId: operation.fundingAuthorizationEventId,
						signedBid: structuredClone(operation.signedBid),
					}), operation, operation.preparedBid)
				}
				if ((status.status === 'admitted' || status.status === 'rejected_return') && operation.phase !== 'finalized') {
					const advanced = nextRecord(operation, { phase: 'finalized', finalizedStatusDigest: demoFridayAdmissionStatusDigest(status) })
					await options.state.saveOperation(advanced, operation.revision)
				}
				return status
			}))
		},

		async importRefundExact(identityValue) {
			const identity = { ...identityValue }
			return options.state.runWalletExclusive(identity, () => options.state.runOperationExclusive(identity, async () => {
				const operation = await options.state.loadOperation(identity)
				// A seller-plan intent is indexed before the bidder locks proofs so a
				// lost seller response is discoverable. It is not yet a refundable
				// payment operation and must not abort recovery of later entries.
				if (operation === null || operation.refundDelivery === undefined) return null
				if (operation.pendingTerminalAck !== undefined) {
					await options.terminal.acknowledgeExact(structuredClone(operation.pendingTerminalAck))
					return { ...structuredClone(operation.pendingTerminalAck.importReceipt), alreadyImported: true }
				}
				const rawNotice = await options.terminal.readNoticeExact({
					actor: operation.actor, fundingOperationId: operation.fundingOperationId,
				})
				if (rawNotice === null) return null
				const notice = exactDemoFridayCocoTerminalNotice(rawNotice)
				if (notice.role !== 'refund') refuse('bidder browser cannot import a winner-settlement notice')
				const wallet = await options.walletFactory.openExact({ actor: operation.actor,
					environmentId: operation.environmentId, canonicalMintUrl: operation.canonicalMintUrl })
				const refundDelivery = operation.refundDelivery
				const receipt = await useFridayWallet(wallet, async () => {
					return importDemoFridayCocoTerminal<DemoFridayBrowserOpeningRefV1, CashuProof[]>({
					notice, expectedActor: operation.actor, intent: refundDelivery.intent,
					keyset: refundDelivery.keyset, journal: options.state, wallet,
					roleBinding: {
						async assertWinnerRecipient() { refuse('refund operation changed role') },
						async assertRefundRecipient(binding) {
							if (binding.operationId !== operation.fundingOperationId
								|| binding.recipientPublicKey !== operation.refundPublicKey) refuse('refund role binding changed')
						},
					},
					unblinder: {
						async unblindExact(value) {
							return value.signatures.map((signature, index) => {
								const opening = value.privateOpeningRefs[index]
								if (opening === undefined || opening.B_ !== value.outputs[index]?.B_) refuse('refund opening differs from output')
								const blinding: BlindingData = { secret: opening.secret, r: BigInt(`0x${opening.r}`), B_: opening.B_ }
								return unblindBlindedSignature(signature as BlindedSignature, blinding, keysetPublicKey(value.keyset, signature.amount))
							})
						},
					},
					verifier: {
						async verifyExact(value) {
							if (value.unblindedRef.length !== value.outputs.length
								|| value.unblindedRef.some((proof) => !hasValidDleq(proof as never, value.keyset as never, { require: true }))) {
								refuse('refund proofs failed exact mint DLEQ verification')
							}
							return value.unblindedRef
						},
					},
					})
				})
				const { alreadyImported: _localReplayFact, ...publicImportReceipt } = receipt
				const noticeDigest = bytesToHex(sha256(utf8ToBytes(canonicalJson(notice))))
				const refundSigner = createDemoFridayPaymentSignerFromSecret(hexToBytes(operation.refundSecret))
				let recipientAckSignature: string
				try {
					recipientAckSignature = await refundSigner.signTerminalAck({
						noticeDigest, recipientPublicKey: operation.refundPublicKey,
						importReceiptCanonical: canonicalJson(publicImportReceipt),
					})
				} finally { refundSigner.dispose() }
				const ack: DemoFridayTerminalAckV1 = {
					schema: 'PLEBEIAN_FRIDAY_COCO_TERMINAL_ACK_V1', actor: operation.actor,
					fundingOperationId: operation.fundingOperationId, noticeDigest,
					importReceipt: publicImportReceipt, recipientAckSignature,
				}
				const advanced = nextRecord(operation, { pendingTerminalAck: ack })
				await options.state.saveOperation(advanced, operation.revision)
				await options.terminal.acknowledgeExact(structuredClone(ack))
				return receipt
			}))
		},
	} satisfies DemoFridayBrowserCocoClient)
}
