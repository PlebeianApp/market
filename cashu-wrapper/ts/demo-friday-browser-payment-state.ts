/**
 * Browser-private durable state for Friday threshold funding.
 *
 * Coco remains the authority for proofs and send-operation recovery. This
 * store keeps only the other client-held material needed to rejoin that exact
 * operation after a reload: the payment/refund keys, immutable lock terms,
 * the exact prepared envelope, and recipient-private blinding openings.
 * Nothing in this module is a public API payload. The fake-money browser model
 * deliberately stores operation keys and openings as plaintext structured data
 * in IndexedDB. This protects them from accidental public serialization, not
 * from malicious same-origin JavaScript or XSS. A production deployment must
 * keep the origin free of third-party scripts and enforce its reviewed CSP;
 * wrapping these values with another same-origin key would not cure XSS.
 */
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { runFridayWalletLease } from './demo-friday-wallet-drain'

import type { ThresholdSigAllLockTarget } from './coco-rail'
import type { DemoFridayBrowserAbortRecordV1 } from './demo-friday-browser-funding-abort'
import {
	validateDemoFridayFundingAbortRecoveryCapsule,
	type DemoFridayFundingAbortRecoveryCapsuleV1,
} from './demo-friday-funding-abort-capsule'
import type {
	DemoRecipientIntent,
	DemoRecipientKeyset,
	DemoRecipientPrivateJournalPort,
	DemoRecipientPrivateRecord,
} from './demo-sigall-recipient'

const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const COMPRESSED_KEY = /^(?:02|03)[0-9a-f]{64}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/
const DATABASE_NAME = 'plebeian-friday-browser-private-v1'
const OPERATION_STORE = 'operations'
const RECIPIENT_STORE = 'recipient-openings'
const SELLER_ACK_STORE = 'seller-terminal-acks'
const FAKE_FUNDING_STORE = 'fake-funding'
const FUNDING_ABORT_STORE = 'funding-aborts'

export type DemoFridayBrowserFundingPhase =
	| 'keys_ready'
	/** Exact operation identity is durable; Coco may already hold the proofs. */
	| 'coco_send_pending'
	| 'coco_locked'
	| 'envelope_prepared'
	| 'server_prepared'
	| 'finalized'

export interface DemoFridayUnsignedNostrBidV1 {
	pubkey: string
	created_at: number
	kind: number
	tags: string[][]
	content: string
}

export interface DemoFridaySignedNostrBidV1 extends DemoFridayUnsignedNostrBidV1 {
	id: string
	sig: string
}

/** Normalized client seam. The lead-owned HTTP adapter maps its final wire contract into this. */
export interface DemoFridayPreparedBidV1 {
	preparationId: string
	fundingAuthorizationEventId: string
	receiptDigest: string
	unsignedBid: DemoFridayUnsignedNostrBidV1
}

export interface DemoFridayTerminalAckV1 {
	schema: 'PLEBEIAN_FRIDAY_COCO_TERMINAL_ACK_V1'
	actor: string
	fundingOperationId: string
	noticeDigest: string
	importReceipt: {
		schema: 'COCO_DEMO_RECIPIENT_IMPORT_RECEIPT_V1'
		operationId: string
		role: 'winner_settlement' | 'refund'
		recipientPublicKey: string
		amount: number
		proofCount: number
		imported: true
	}
	recipientAckSignature: string
}

export interface DemoFridaySellerTerminalAckRecordV1 {
	schema: 'PLEBEIAN_FRIDAY_SELLER_TERMINAL_ACK_RECORD_V1'
	actor: string
	environmentId: string
	auctionId: string
	fundingOperationId: string
	ack: DemoFridayTerminalAckV1
}

export interface DemoFridayFakeFundingRecordV1 {
	schema: 'PLEBEIAN_FRIDAY_FAKE_FUNDING_RECORD_V1'
	revision: number
	actor: string
	environmentId: string
	fundingOperationId: string
	canonicalMintUrl: string
	amount: number
	identityCap: number
	phase: 'intent' | 'quote_requested' | 'quoted' | 'operation_bound' | 'finalized'
	quoteId?: string
	mintOperationId?: string
}

export interface DemoFridayFakeFundingPolicyV1 {
	schema: 'PLEBEIAN_FRIDAY_R20_FAKE_FUNDING_POLICY_V1'
	maxPerRequest: number
	browserWalletAdvisoryMaxResultingBalance: number
	digest: string
}

export interface DemoFridayFakeFundingRecordV2 {
	schema: 'PLEBEIAN_FRIDAY_FAKE_FUNDING_RECORD_V2'
	revision: number
	actor: string
	environmentId: string
	fundingOperationId: string
	canonicalMintUrl: string
	amount: number
	browserWalletAdvisoryMaxResultingBalance: number
	maxPerRequest: number
	policySchema: DemoFridayFakeFundingPolicyV1['schema']
	policyDigest: string
	phase: 'intent' | 'quote_requested' | 'quoted' | 'operation_bound' | 'finalized'
	quoteId?: string
	mintOperationId?: string
}

export type DemoFridayFakeFundingRecord = DemoFridayFakeFundingRecordV1 | DemoFridayFakeFundingRecordV2

export interface DemoFridayBrowserRefundDeliveryV1 {
	intent: DemoRecipientIntent
	keyset: DemoRecipientKeyset
}

/**
 * Private record. paymentSecret/refundSecret and envelope are never returned
 * by status/ack transports, rendered into the DOM, or included in Nostr.
 */
export interface DemoFridayBrowserPaymentOperationV1 {
	schema: 'PLEBEIAN_FRIDAY_BROWSER_PAYMENT_OPERATION_V1'
	revision: number
	actor: string
	environmentId: string
	authNetworkId: string
	chainId: string
	auctionId: string
	fundingOperationId: string
	canonicalMintUrl: string
	mintPublicKey: string
	mintServerVersion: string
	bidAmount: number
	/** Full currently committed pool; distinct from a new own-raise reservation delta. */
	fullPoolAmount: number
	reservedPoolAmount: number
	replacesBidId: string
	priorLeaderActor: string
	winnerRecipientPublicKey: string
	winnerRecipientCapabilityDigest: string
	winnerOutputsDigest: string
	keysetId: string
	denominationKeyDigest: string
	denominationAmounts: number[]
	mintNuts: number[]
	inputFeePpk: 0
	committeeKeysetId: string
	committeeKeysetVersion: string
	dkgRunId: string
	publicKeyPackageSha256: string
	signerRosterDigest: string
	lock: ThresholdSigAllLockTarget
	paymentSecret: string
	refundSecret: string
	paymentPublicKey: string
	refundPublicKey: string
	phase: DemoFridayBrowserFundingPhase
	/** Persisted immediately with the Coco lock, before the full bid envelope exists. */
	abortCapsule?: DemoFridayFundingAbortRecoveryCapsuleV1
	/** Exact private envelope for byte-for-byte retry; it can contain bearer proofs. */
	envelope?: unknown
	fundingAuthorizationEventId?: string
	refundDelivery?: DemoFridayBrowserRefundDeliveryV1
	preparedBid?: DemoFridayPreparedBidV1
	signedBid?: DemoFridaySignedNostrBidV1
	finalizedStatusDigest?: string
	/** Canonical public ack persisted before dispatch; replayed byte-for-byte after loss. */
	pendingTerminalAck?: DemoFridayTerminalAckV1
}

export interface DemoFridayBrowserOpeningRefV1 {
	secret: string
	r: string
	B_: string
}

export interface DemoFridayBrowserPaymentStatePort
	extends DemoRecipientPrivateJournalPort<DemoFridayBrowserOpeningRefV1> {
	runOperationExclusive<T>(identity: DemoFridayBrowserOperationIdentity, run: () => Promise<T>): Promise<T>
	/** Wallet lease precedes operation/recipient journal locks. Abort cancels queued acquisition only. */
	runWalletExclusive<T>(identity: Pick<DemoFridayBrowserOperationIdentity, 'actor' | 'environmentId'>, run: () => Promise<T>, signal?: AbortSignal): Promise<T>
	/** Serializes the non-secret cross-actor discovery index across every tab. */
	runPublicIndexExclusive<T>(run: () => Promise<T>): Promise<T>
	loadOperation(identity: DemoFridayBrowserOperationIdentity): Promise<DemoFridayBrowserPaymentOperationV1 | null>
	saveOperation(record: DemoFridayBrowserPaymentOperationV1, expectedRevision: number | null): Promise<void>
	loadSellerTerminalAck(identity: DemoFridayBrowserOperationIdentity): Promise<DemoFridaySellerTerminalAckRecordV1 | null>
	saveSellerTerminalAck(record: DemoFridaySellerTerminalAckRecordV1): Promise<void>
	loadFakeFunding(identity: DemoFridayBrowserOperationIdentity): Promise<DemoFridayFakeFundingRecord | null>
	saveFakeFunding(record: DemoFridayFakeFundingRecord, expectedRevision: number | null): Promise<void>
	loadFundingAbort(identity: DemoFridayBrowserOperationIdentity): Promise<DemoFridayBrowserAbortRecordV1 | null>
	saveFundingAbort(record: DemoFridayBrowserAbortRecordV1, expectedRevision: number | null): Promise<void>
}

export interface DemoFridayBrowserOperationIdentity {
	actor: string
	environmentId: string
	fundingOperationId: string
}

export interface DemoFridayBrowserPaymentOperationInput extends DemoFridayBrowserOperationIdentity {
	authNetworkId: string
	chainId: string
	auctionId: string
	canonicalMintUrl: string
	mintPublicKey: string
	mintServerVersion: string
	bidAmount: number
	fullPoolAmount: number
	reservedPoolAmount: number
	replacesBidId: string
	priorLeaderActor: string
	winnerRecipientPublicKey: string
	winnerRecipientCapabilityDigest: string
	winnerOutputsDigest: string
	keysetId: string
	denominationKeyDigest: string
	denominationAmounts: number[]
	mintNuts: number[]
	inputFeePpk: 0
	committeePublicKey: string
	committeeKeysetId: string
	committeeKeysetVersion: string
	dkgRunId: string
	publicKeyPackageSha256: string
	signerRosterDigest: string
	locktime: number
}

interface BrowserLockManagerLike {
	request<T>(name: string, options: { mode: 'exclusive'; signal?: AbortSignal }, callback: () => Promise<T>): Promise<T>
}

function refuse(message: string): never {
	throw new Error(`DEMO_FRIDAY_BROWSER_PAYMENT_STATE: ${message}`)
}

function exactCanonicalMint(value: string): string {
	let url: URL
	try { url = new URL(value) } catch { return refuse('canonical mint identity is invalid') }
	if (value !== url.origin || url.protocol !== 'https:' || url.port !== '' || url.username !== ''
		|| url.password !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
		refuse('canonical mint identity must be one exact public HTTPS origin')
	}
	return url.origin
}

function exactIdentity(value: DemoFridayBrowserOperationIdentity): DemoFridayBrowserOperationIdentity {
	if (!HEX_32.test(value.actor) || !ID.test(value.environmentId) || !ID.test(value.fundingOperationId)) {
		refuse('operation identity is invalid')
	}
	return { ...value }
}

function phaseRank(value: DemoFridayBrowserFundingPhase): number {
	return ['keys_ready', 'coco_send_pending', 'coco_locked', 'envelope_prepared', 'server_prepared', 'finalized'].indexOf(value)
}

function operationKey(identity: DemoFridayBrowserOperationIdentity): string {
	const exact = exactIdentity(identity)
	return `${exact.environmentId}\u0000${exact.actor}\u0000${exact.fundingOperationId}`
}

function exactSellerTerminalAckRecord(value: DemoFridaySellerTerminalAckRecordV1): DemoFridaySellerTerminalAckRecordV1 {
	const identity = exactIdentity(value)
	const ack = value.ack
	if (value.schema !== 'PLEBEIAN_FRIDAY_SELLER_TERMINAL_ACK_RECORD_V1' || !ID.test(value.auctionId)
		|| ack.schema !== 'PLEBEIAN_FRIDAY_COCO_TERMINAL_ACK_V1' || ack.actor !== identity.actor
		|| ack.fundingOperationId !== identity.fundingOperationId || !HEX_32.test(ack.noticeDigest)
		|| ack.importReceipt.schema !== 'COCO_DEMO_RECIPIENT_IMPORT_RECEIPT_V1'
		|| ack.importReceipt.operationId !== identity.fundingOperationId
		|| ack.importReceipt.role !== 'winner_settlement' || !COMPRESSED_KEY.test(ack.importReceipt.recipientPublicKey)
		|| !Number.isSafeInteger(ack.importReceipt.amount) || ack.importReceipt.amount < 1
		|| !Number.isSafeInteger(ack.importReceipt.proofCount) || ack.importReceipt.proofCount < 1
		|| ack.importReceipt.imported !== true || !HEX_64.test(ack.recipientAckSignature)
		|| Object.prototype.hasOwnProperty.call(ack.importReceipt, 'alreadyImported')) {
		refuse('seller terminal acknowledgement record is malformed')
	}
	return structuredClone(value)
}

function fakeFundingPhase(value: DemoFridayFakeFundingRecord['phase']): number {
	return ['intent', 'quote_requested', 'quoted', 'operation_bound', 'finalized'].indexOf(value)
}

function fakeFundingPolicyDigest(value: Pick<DemoFridayFakeFundingRecordV2,
	'policySchema' | 'maxPerRequest' | 'browserWalletAdvisoryMaxResultingBalance'>): string {
	return bytesToHex(sha256(utf8ToBytes(`{"max_per_request":${value.maxPerRequest},"max_resulting_balance":${value.browserWalletAdvisoryMaxResultingBalance},"schema":"${value.policySchema}"}`)))
}

function exactFakeFundingRecord(value: DemoFridayFakeFundingRecord): DemoFridayFakeFundingRecord {
	exactIdentity(value)
	const legacy = value.schema === 'PLEBEIAN_FRIDAY_FAKE_FUNDING_RECORD_V1'
	const current = value.schema === 'PLEBEIAN_FRIDAY_FAKE_FUNDING_RECORD_V2'
	const resultingBalanceLimit = legacy ? value.identityCap : value.browserWalletAdvisoryMaxResultingBalance
	if ((!legacy && !current)
		|| !Number.isSafeInteger(value.revision) || value.revision < 0
		|| exactCanonicalMint(value.canonicalMintUrl) !== value.canonicalMintUrl
		|| !Number.isSafeInteger(value.amount) || value.amount < 1
		|| !Number.isSafeInteger(resultingBalanceLimit) || resultingBalanceLimit < value.amount
		|| (legacy && (value.amount > 10_000 || resultingBalanceLimit > 50_000))
		|| (current && (!Number.isSafeInteger(value.maxPerRequest) || value.maxPerRequest < 1
			|| value.amount > value.maxPerRequest || resultingBalanceLimit > Number.MAX_SAFE_INTEGER
			|| value.maxPerRequest > resultingBalanceLimit
			|| value.policySchema !== 'PLEBEIAN_FRIDAY_R20_FAKE_FUNDING_POLICY_V1'
			|| !HEX_32.test(value.policyDigest) || value.policyDigest !== fakeFundingPolicyDigest(value)))
		|| fakeFundingPhase(value.phase) < 0
		|| (fakeFundingPhase(value.phase) >= 2 && !ID.test(value.quoteId ?? ''))
		|| (fakeFundingPhase(value.phase) >= 3 && !ID.test(value.mintOperationId ?? ''))) {
		refuse('fake funding record is malformed')
	}
	return structuredClone(value)
}

export function validateDemoFridayFakeFundingRecord(value: DemoFridayFakeFundingRecord): void {
	exactFakeFundingRecord(value)
}

function abortPhase(value: DemoFridayBrowserAbortRecordV1['phase']): number {
	return ['signed', 'broadcast_unknown', 'committed_abort', 'imported'].indexOf(value)
}

/** Persistence guard; the protocol module performs the cryptographic checks. */
function exactFundingAbortRecord(value: DemoFridayBrowserAbortRecordV1): DemoFridayBrowserAbortRecordV1 {
	exactIdentity(value)
	if (value.schema !== 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_ABORT_RECORD_V1'
		|| !Number.isSafeInteger(value.revision) || value.revision < 0 || abortPhase(value.phase) < 0
		|| value.preparation?.schema !== 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_ABORT_PREPARATION_V1'
		|| !HEX_32.test(value.preparation.preparationId)
		|| value.actorAbortEvent?.kind !== 28_650 || value.actorAbortEvent.pubkey !== value.actor
		|| !HEX_32.test(value.actorAbortEvent.id) || !HEX_64.test(value.actorAbortEvent.sig)
		|| (abortPhase(value.phase) >= abortPhase('committed_abort') && !HEX_32.test(value.committedStatusDigest ?? ''))
		|| (value.phase === 'imported' && value.importReceipt?.imported !== true)) {
		refuse('funding-abort journal record is malformed')
	}
	return structuredClone(value)
}

function freshSecret(random: (bytes: Uint8Array) => Uint8Array): Uint8Array {
	for (;;) {
		const candidate = random(new Uint8Array(32))
		if (candidate.length !== 32) refuse('random source returned the wrong number of bytes')
		try {
			secp256k1.getPublicKey(candidate, true)
			return Uint8Array.from(candidate)
		} catch {
			// Retry the vanishingly rare out-of-range scalar.
		}
	}
}

function validateRecord(value: DemoFridayBrowserPaymentOperationV1): DemoFridayBrowserPaymentOperationV1 {
	if (value.schema !== 'PLEBEIAN_FRIDAY_BROWSER_PAYMENT_OPERATION_V1'
		|| !Number.isSafeInteger(value.revision) || value.revision < 0
		|| !ID.test(value.authNetworkId) || !ID.test(value.chainId) || !ID.test(value.auctionId)
		|| !Number.isSafeInteger(value.bidAmount) || value.bidAmount < 1 || value.bidAmount > 50_000
		|| !Number.isSafeInteger(value.fullPoolAmount) || value.fullPoolAmount < 1 || value.fullPoolAmount > value.bidAmount
		|| !Number.isSafeInteger(value.reservedPoolAmount) || value.reservedPoolAmount < 1
		|| value.reservedPoolAmount > value.fullPoolAmount || (value.replacesBidId !== '' && !HEX_32.test(value.replacesBidId))
		|| (value.priorLeaderActor !== '' && !HEX_32.test(value.priorLeaderActor))
		|| ((value.replacesBidId === '') !== (value.priorLeaderActor === ''))
		|| !COMPRESSED_KEY.test(value.winnerRecipientPublicKey)
		|| !HEX_32.test(value.winnerRecipientCapabilityDigest) || !HEX_32.test(value.winnerOutputsDigest)
		|| typeof value.keysetId !== 'string' || value.keysetId.length < 1
		|| !COMPRESSED_KEY.test(value.mintPublicKey) || typeof value.mintServerVersion !== 'string' || value.mintServerVersion.length < 1
		|| !HEX_32.test(value.denominationKeyDigest) || !Array.isArray(value.denominationAmounts)
		|| value.denominationAmounts.length < 1 || value.denominationAmounts.some((amount) => !Number.isSafeInteger(amount) || amount < 1)
		|| JSON.stringify(value.denominationAmounts) !== JSON.stringify([...value.denominationAmounts].sort((a, b) => a - b))
		|| !Array.isArray(value.mintNuts) || value.mintNuts.some((nut) => !Number.isSafeInteger(nut) || nut < 0)
		|| ![4, 7, 9, 10, 11, 12].every((nut) => value.mintNuts.includes(nut))
		|| value.inputFeePpk !== 0 || !ID.test(value.committeeKeysetId) || !ID.test(value.committeeKeysetVersion)
		|| !ID.test(value.dkgRunId) || !HEX_32.test(value.publicKeyPackageSha256) || !HEX_32.test(value.signerRosterDigest)
		|| !COMPRESSED_KEY.test(value.lock.committeePubkey) || !Number.isSafeInteger(value.lock.locktime)
		|| value.lock.locktime < 1 || !HEX_32.test(value.paymentSecret) || !HEX_32.test(value.refundSecret)
		|| !COMPRESSED_KEY.test(value.paymentPublicKey) || !COMPRESSED_KEY.test(value.refundPublicKey)
		|| value.lock.bidderPubkey !== value.paymentPublicKey || value.lock.refundPubkey !== value.refundPublicKey
		|| !['keys_ready', 'coco_send_pending', 'coco_locked', 'envelope_prepared', 'server_prepared', 'finalized'].includes(value.phase)) {
		refuse('private operation record is malformed')
	}
	exactIdentity(value)
	exactCanonicalMint(value.canonicalMintUrl)
	let expectedPayment: string
	let expectedRefund: string
	try {
		expectedPayment = bytesToHex(secp256k1.getPublicKey(hexToBytes(value.paymentSecret), true))
		expectedRefund = bytesToHex(secp256k1.getPublicKey(hexToBytes(value.refundSecret), true))
	} catch { return refuse('private operation key is invalid') }
	if (expectedPayment !== value.paymentPublicKey || expectedRefund !== value.refundPublicKey
		|| expectedPayment === expectedRefund || value.lock.committeePubkey === expectedPayment
		|| value.lock.committeePubkey === expectedRefund) refuse('private operation keys differ from the exact lock')
	const rank = ['keys_ready', 'coco_send_pending', 'coco_locked', 'envelope_prepared', 'server_prepared', 'finalized'].indexOf(value.phase)
	let exactAbortCapsule: DemoFridayFundingAbortRecoveryCapsuleV1 | undefined
	if (rank >= 2) {
		try { exactAbortCapsule = validateDemoFridayFundingAbortRecoveryCapsule(value.abortCapsule as DemoFridayFundingAbortRecoveryCapsuleV1) }
		catch { return refuse('locked operation lacks a valid independent exact abort recovery capsule') }
	}
	if (rank >= 2 && (exactAbortCapsule?.schema !== 'PLEBEIAN_FRIDAY_FUNDING_ABORT_RECOVERY_CAPSULE_V1'
		|| exactAbortCapsule.refund.operationId !== value.fundingOperationId
		|| exactAbortCapsule.refund.auctionId !== value.auctionId
		|| exactAbortCapsule.refund.bidderActorId !== value.actor
		|| exactAbortCapsule.refund.bidderPublicKey !== value.paymentPublicKey
		|| exactAbortCapsule.refund.refundPublicKey !== value.refundPublicKey
		|| exactAbortCapsule.refund.committeePublicKey !== value.lock.committeePubkey
		|| exactAbortCapsule.refund.locktime !== value.lock.locktime
		|| exactAbortCapsule.refund.amount !== value.fullPoolAmount
		|| exactAbortCapsule.refund.mintUrl !== value.canonicalMintUrl
		|| exactAbortCapsule.refund.mintSeal.activeSatKeysetId !== value.keysetId
		|| exactAbortCapsule.refund.templateDigest !== exactAbortCapsule.actorReturnAuthorization.packageDigest
		|| !HEX_32.test(exactAbortCapsule.capsuleDigest))) {
		refuse('locked operation lacks its independent exact abort recovery capsule')
	}
	if (rank >= 3 && (value.envelope === undefined || !HEX_32.test(value.fundingAuthorizationEventId ?? ''))) {
		refuse('prepared operation lacks its exact envelope identity')
	}
	if (rank >= 2 && (value.refundDelivery === undefined || value.refundDelivery.intent.role !== 'refund'
		|| value.refundDelivery.intent.operationId !== value.fundingOperationId
		|| value.refundDelivery.intent.auctionId !== value.auctionId
		|| value.refundDelivery.intent.network !== value.authNetworkId
		|| value.refundDelivery.intent.chainId !== value.chainId
		|| value.refundDelivery.intent.mintUrl !== value.canonicalMintUrl
		|| value.refundDelivery.intent.recipientPublicKey !== value.refundPublicKey
		|| value.refundDelivery.intent.amounts.reduce((sum, amount) => sum + amount, 0) !== value.fullPoolAmount
		|| value.refundDelivery.keyset.id !== value.keysetId)) refuse('refund delivery differs from the exact reserved pool')
	if (rank >= 4 && (value.preparedBid === undefined || !ID.test(value.preparedBid.preparationId)
		|| value.preparedBid.fundingAuthorizationEventId !== value.fundingAuthorizationEventId
		|| !HEX_32.test(value.preparedBid.receiptDigest)
		|| value.preparedBid.unsignedBid.pubkey !== value.actor
		|| !Number.isSafeInteger(value.preparedBid.unsignedBid.created_at) || value.preparedBid.unsignedBid.kind !== 28_641
		|| typeof value.preparedBid.unsignedBid.content !== 'string' || !Array.isArray(value.preparedBid.unsignedBid.tags)
		|| value.preparedBid.unsignedBid.tags.some((tag) => !Array.isArray(tag)
			|| tag.some((entry) => typeof entry !== 'string')))) {
		refuse('server-prepared operation lacks the immutable unsigned bid')
	}
	if (value.signedBid !== undefined) {
		const unsigned = value.preparedBid?.unsignedBid
		const id = unsigned === undefined ? '' : bytesToHex(sha256(utf8ToBytes(JSON.stringify([
			0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content,
		]))))
		if (!HEX_32.test(value.signedBid.id) || !HEX_64.test(value.signedBid.sig) || unsigned === undefined
			|| value.signedBid.pubkey !== unsigned.pubkey || value.signedBid.created_at !== unsigned.created_at
			|| value.signedBid.kind !== unsigned.kind || value.signedBid.content !== unsigned.content
			|| JSON.stringify(value.signedBid.tags) !== JSON.stringify(unsigned.tags) || value.signedBid.id !== id
			|| !schnorr.verify(hexToBytes(value.signedBid.sig), hexToBytes(id), hexToBytes(value.actor))) {
			refuse('stored signed bid is malformed')
		}
	}
	if (rank >= 5 && (value.signedBid === undefined || !HEX_32.test(value.finalizedStatusDigest ?? ''))) {
		refuse('finalized operation lacks its signed bid or status digest')
	}
	if (value.pendingTerminalAck !== undefined) {
		const ack = value.pendingTerminalAck
		if (ack.schema !== 'PLEBEIAN_FRIDAY_COCO_TERMINAL_ACK_V1' || ack.actor !== value.actor
			|| ack.fundingOperationId !== value.fundingOperationId || !HEX_32.test(ack.noticeDigest)
			|| ack.importReceipt.schema !== 'COCO_DEMO_RECIPIENT_IMPORT_RECEIPT_V1'
			|| ack.importReceipt.operationId !== value.fundingOperationId || ack.importReceipt.role !== 'refund'
			|| ack.importReceipt.recipientPublicKey !== value.refundPublicKey || ack.importReceipt.imported !== true
			|| !Number.isSafeInteger(ack.importReceipt.amount) || ack.importReceipt.amount !== value.fullPoolAmount
			|| !Number.isSafeInteger(ack.importReceipt.proofCount) || ack.importReceipt.proofCount < 1
			|| !HEX_64.test(ack.recipientAckSignature)
			|| Object.prototype.hasOwnProperty.call(ack.importReceipt, 'alreadyImported')) {
			refuse('terminal ack is not the canonical public operation-bound receipt')
		}
	}
	return structuredClone(value)
}

/** Strict public validator used by recovery/import boundaries and cross-store regression tests. */
export function validateDemoFridayBrowserPaymentOperation(
	value: DemoFridayBrowserPaymentOperationV1,
): DemoFridayBrowserPaymentOperationV1 {
	return validateRecord(value)
}

/** The exact immutable-state transition enforced by the IndexedDB compare-and-put path. */
export function validateDemoFridayBrowserPaymentRevision(
	prior: DemoFridayBrowserPaymentOperationV1,
	next: DemoFridayBrowserPaymentOperationV1,
	expectedRevision: number,
): DemoFridayBrowserPaymentOperationV1 {
	const exactPrior = validateRecord(prior), exact = validateRecord(next)
	if (exactPrior.revision !== expectedRevision || exact.revision !== expectedRevision + 1
		|| !sameIdentity(exactPrior, exact) || phaseRank(exact.phase) < phaseRank(exactPrior.phase)
		|| phaseRank(exact.phase) > phaseRank(exactPrior.phase) + 1
		|| (exactPrior.abortCapsule !== undefined
			&& JSON.stringify(exactPrior.abortCapsule) !== JSON.stringify(exact.abortCapsule))
		|| (exactPrior.refundDelivery !== undefined
			&& JSON.stringify(exactPrior.refundDelivery) !== JSON.stringify(exact.refundDelivery))
		|| (exactPrior.envelope !== undefined && JSON.stringify(exactPrior.envelope) !== JSON.stringify(exact.envelope))
		|| (exactPrior.preparedBid !== undefined && JSON.stringify(exactPrior.preparedBid) !== JSON.stringify(exact.preparedBid))
		|| (exactPrior.signedBid !== undefined && JSON.stringify(exactPrior.signedBid) !== JSON.stringify(exact.signedBid))
		|| (exactPrior.finalizedStatusDigest !== undefined
			&& exactPrior.finalizedStatusDigest !== exact.finalizedStatusDigest)
		|| (exactPrior.pendingTerminalAck !== undefined
			&& JSON.stringify(exactPrior.pendingTerminalAck) !== JSON.stringify(exact.pendingTerminalAck))) {
		refuse('operation revision, phase, or immutable terms changed')
	}
	return exact
}

export function createDemoFridayBrowserPaymentOperation(
	input: DemoFridayBrowserPaymentOperationInput,
	random: (bytes: Uint8Array) => Uint8Array = (bytes) => globalThis.crypto.getRandomValues(bytes as Uint8Array<ArrayBuffer>),
): DemoFridayBrowserPaymentOperationV1 {
	exactIdentity(input)
	if (!ID.test(input.authNetworkId) || !ID.test(input.chainId) || !ID.test(input.auctionId)
		|| !Number.isSafeInteger(input.bidAmount) || input.bidAmount < 1 || input.bidAmount > 50_000
		|| !Number.isSafeInteger(input.fullPoolAmount) || input.fullPoolAmount < 1 || input.fullPoolAmount > input.bidAmount
		|| !Number.isSafeInteger(input.reservedPoolAmount) || input.reservedPoolAmount < 1
		|| input.reservedPoolAmount > input.fullPoolAmount || (input.replacesBidId !== '' && !HEX_32.test(input.replacesBidId))
		|| (input.priorLeaderActor !== '' && !HEX_32.test(input.priorLeaderActor))
		|| ((input.replacesBidId === '') !== (input.priorLeaderActor === ''))
		|| !COMPRESSED_KEY.test(input.winnerRecipientPublicKey)
		|| !HEX_32.test(input.winnerRecipientCapabilityDigest) || !HEX_32.test(input.winnerOutputsDigest)
		|| typeof input.keysetId !== 'string' || input.keysetId.length < 1
		|| !COMPRESSED_KEY.test(input.mintPublicKey) || typeof input.mintServerVersion !== 'string' || input.mintServerVersion.length < 1
		|| !HEX_32.test(input.denominationKeyDigest) || input.denominationAmounts.length < 1
		|| ![4, 7, 9, 10, 11, 12].every((nut) => input.mintNuts.includes(nut))
		|| input.inputFeePpk !== 0 || !ID.test(input.committeeKeysetId) || !ID.test(input.committeeKeysetVersion)
		|| !ID.test(input.dkgRunId) || !HEX_32.test(input.publicKeyPackageSha256) || !HEX_32.test(input.signerRosterDigest)
		|| !COMPRESSED_KEY.test(input.committeePublicKey) || !Number.isSafeInteger(input.locktime) || input.locktime < 1) {
		refuse('new operation terms are invalid')
	}
	const payment = freshSecret(random), refund = freshSecret(random)
	const paymentPublicKey = bytesToHex(secp256k1.getPublicKey(payment, true))
	const refundPublicKey = bytesToHex(secp256k1.getPublicKey(refund, true))
	const record: DemoFridayBrowserPaymentOperationV1 = {
		schema: 'PLEBEIAN_FRIDAY_BROWSER_PAYMENT_OPERATION_V1', revision: 0,
		actor: input.actor, environmentId: input.environmentId, authNetworkId: input.authNetworkId,
		chainId: input.chainId, auctionId: input.auctionId, fundingOperationId: input.fundingOperationId,
		canonicalMintUrl: exactCanonicalMint(input.canonicalMintUrl), mintPublicKey: input.mintPublicKey,
		mintServerVersion: input.mintServerVersion, bidAmount: input.bidAmount, fullPoolAmount: input.fullPoolAmount,
		reservedPoolAmount: input.reservedPoolAmount, replacesBidId: input.replacesBidId, keysetId: input.keysetId,
		priorLeaderActor: input.priorLeaderActor, winnerRecipientPublicKey: input.winnerRecipientPublicKey,
		winnerRecipientCapabilityDigest: input.winnerRecipientCapabilityDigest,
		winnerOutputsDigest: input.winnerOutputsDigest,
		denominationKeyDigest: input.denominationKeyDigest,
		denominationAmounts: [...input.denominationAmounts].sort((a, b) => a - b), mintNuts: [...input.mintNuts].sort((a, b) => a - b),
		inputFeePpk: input.inputFeePpk, committeeKeysetId: input.committeeKeysetId,
		committeeKeysetVersion: input.committeeKeysetVersion, dkgRunId: input.dkgRunId,
		publicKeyPackageSha256: input.publicKeyPackageSha256, signerRosterDigest: input.signerRosterDigest,
		lock: { bidderPubkey: paymentPublicKey, committeePubkey: input.committeePublicKey,
			refundPubkey: refundPublicKey, locktime: input.locktime },
		paymentSecret: bytesToHex(payment), refundSecret: bytesToHex(refund),
		paymentPublicKey, refundPublicKey, phase: 'keys_ready',
	}
	payment.fill(0); refund.fill(0)
	return validateRecord(record)
}

function sameIdentity(left: DemoFridayBrowserPaymentOperationV1, right: DemoFridayBrowserPaymentOperationV1): boolean {
	return operationKey(left) === operationKey(right)
		&& left.authNetworkId === right.authNetworkId && left.chainId === right.chainId
		&& left.auctionId === right.auctionId && left.canonicalMintUrl === right.canonicalMintUrl
		&& left.mintPublicKey === right.mintPublicKey && left.mintServerVersion === right.mintServerVersion
		&& left.bidAmount === right.bidAmount && left.fullPoolAmount === right.fullPoolAmount
		&& left.reservedPoolAmount === right.reservedPoolAmount && left.replacesBidId === right.replacesBidId
		&& left.priorLeaderActor === right.priorLeaderActor
		&& left.winnerRecipientPublicKey === right.winnerRecipientPublicKey
		&& left.winnerRecipientCapabilityDigest === right.winnerRecipientCapabilityDigest
		&& left.winnerOutputsDigest === right.winnerOutputsDigest
		&& left.keysetId === right.keysetId && JSON.stringify(left.lock) === JSON.stringify(right.lock)
		&& left.denominationKeyDigest === right.denominationKeyDigest
		&& JSON.stringify(left.denominationAmounts) === JSON.stringify(right.denominationAmounts)
		&& JSON.stringify(left.mintNuts) === JSON.stringify(right.mintNuts) && left.inputFeePpk === right.inputFeePpk
		&& left.committeeKeysetId === right.committeeKeysetId && left.committeeKeysetVersion === right.committeeKeysetVersion
		&& left.dkgRunId === right.dkgRunId && left.publicKeyPackageSha256 === right.publicKeyPackageSha256
		&& left.signerRosterDigest === right.signerRosterDigest
		&& left.paymentSecret === right.paymentSecret && left.refundSecret === right.refundSecret
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
	})
}

async function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
	const request = factory.open(DATABASE_NAME, 3)
	request.onupgradeneeded = () => {
		if (!request.result.objectStoreNames.contains(OPERATION_STORE)) request.result.createObjectStore(OPERATION_STORE)
		if (!request.result.objectStoreNames.contains(RECIPIENT_STORE)) request.result.createObjectStore(RECIPIENT_STORE)
		if (!request.result.objectStoreNames.contains(SELLER_ACK_STORE)) request.result.createObjectStore(SELLER_ACK_STORE)
		if (!request.result.objectStoreNames.contains(FAKE_FUNDING_STORE)) request.result.createObjectStore(FAKE_FUNDING_STORE)
		if (!request.result.objectStoreNames.contains(FUNDING_ABORT_STORE)) request.result.createObjectStore(FUNDING_ABORT_STORE)
	}
	return requestResult(request)
}

async function readStore<T>(factory: IDBFactory, storeName: string, key: string): Promise<T | null> {
	const database = await openDatabase(factory)
	try {
		const value = await requestResult(database.transaction(storeName, 'readonly').objectStore(storeName).get(key))
		return value === undefined ? null : structuredClone(value as T)
	} finally { database.close() }
}

/** One IndexedDB read/check/put transaction; no time-of-check/time-of-use gap across tabs. */
async function compareAndPut<T>(
	factory: IDBFactory,
	storeName: string,
	key: string,
	next: (prior: T | null) => T,
): Promise<void> {
	const database = await openDatabase(factory)
	try {
		const transaction = database.transaction(storeName, 'readwrite')
		const store = transaction.objectStore(storeName)
		let applicationError: unknown
		const completed = new Promise<void>((resolve, reject) => {
			transaction.oncomplete = () => resolve()
			transaction.onerror = () => reject(applicationError ?? transaction.error ?? new Error('IndexedDB transaction failed'))
			transaction.onabort = () => reject(applicationError ?? transaction.error ?? new Error('IndexedDB transaction aborted'))
		})
		const request = store.get(key)
		request.onerror = () => { applicationError = request.error; transaction.abort() }
		request.onsuccess = () => {
			try {
				const prior = request.result === undefined ? null : structuredClone(request.result as T)
				store.put(structuredClone(next(prior)), key)
			} catch (error) {
				applicationError = error
				transaction.abort()
			}
		}
		await completed
	} finally { database.close() }
}

export function createDemoFridayBrowserPaymentState(options: {
	indexedDB?: IDBFactory
	locks?: BrowserLockManagerLike
} = {}): DemoFridayBrowserPaymentStatePort {
	const platform = globalThis as typeof globalThis & {
		indexedDB?: IDBFactory
		navigator?: { locks?: BrowserLockManagerLike }
	}
	const indexedDB = options.indexedDB ?? platform.indexedDB
	const locks = options.locks ?? platform.navigator?.locks
	if (indexedDB === undefined || locks === undefined) {
		refuse('durable IndexedDB and cross-tab Web Locks are required')
	}
	const exclusive = <T>(name: string, run: () => Promise<T>, signal?: AbortSignal) => {
		signal?.throwIfAborted()
		return locks.request(`plebeian-friday-private:${name}`, { mode: 'exclusive', ...(signal ? { signal } : {}) }, async () => {
			// Check again even if a test adapter or old implementation ignores the
			// queued-acquisition signal. An acquired lease stays held through cleanup.
			signal?.throwIfAborted()
			return run()
		})
	}
	return Object.freeze({
		runOperationExclusive(identity, run) { return exclusive(`operation:${operationKey(identity)}`, run) },
		runWalletExclusive(identity, run, signal) {
			const exact = exactIdentity({ ...identity, fundingOperationId: 'wallet' })
			return runFridayWalletLease(locks, `plebeian-friday-private:wallet:${exact.environmentId}\u0000${exact.actor}`, run, signal)
		},
		runPublicIndexExclusive(run) { return exclusive('public-operation-index', run) },
		async loadOperation(identity) {
			const value = await readStore<DemoFridayBrowserPaymentOperationV1>(indexedDB, OPERATION_STORE, operationKey(identity))
			return value === null ? null : validateRecord(value)
		},
		async saveOperation(record, expectedRevision) {
			const exact = validateRecord(record)
			const key = operationKey(exact)
			await compareAndPut<DemoFridayBrowserPaymentOperationV1>(indexedDB, OPERATION_STORE, key, (priorValue) => {
				const prior = priorValue === null ? null : validateRecord(priorValue)
				if (expectedRevision === null) {
					if (prior !== null && JSON.stringify(prior) !== JSON.stringify(exact)) {
						refuse('operation identity is already bound to different private state')
					}
				} else if (prior === null) refuse('operation revision, phase, or immutable terms changed')
				else validateDemoFridayBrowserPaymentRevision(prior, exact, expectedRevision)
				return exact
			})
		},
		async loadSellerTerminalAck(identity) {
			const value = await readStore<DemoFridaySellerTerminalAckRecordV1>(
				indexedDB, SELLER_ACK_STORE, operationKey(identity),
			)
			return value === null ? null : exactSellerTerminalAckRecord(value)
		},
		async saveSellerTerminalAck(recordValue) {
			const record = exactSellerTerminalAckRecord(recordValue), key = operationKey(record)
			await compareAndPut<DemoFridaySellerTerminalAckRecordV1>(indexedDB, SELLER_ACK_STORE, key, (priorValue) => {
				const prior = priorValue === null ? null : exactSellerTerminalAckRecord(priorValue)
				if (prior !== null && JSON.stringify(prior) !== JSON.stringify(record)) {
					refuse('seller terminal acknowledgement changed after import')
				}
				return record
			})
		},
		async loadFakeFunding(identity) {
			const value = await readStore<DemoFridayFakeFundingRecord>(indexedDB, FAKE_FUNDING_STORE, operationKey(identity))
			return value === null ? null : exactFakeFundingRecord(value)
		},
		async saveFakeFunding(recordValue, expectedRevision) {
			const record = exactFakeFundingRecord(recordValue), key = operationKey(record)
			await compareAndPut<DemoFridayFakeFundingRecord>(indexedDB, FAKE_FUNDING_STORE, key, (priorValue) => {
				const prior = priorValue === null ? null : exactFakeFundingRecord(priorValue)
				if (expectedRevision === null) {
					if (prior !== null && JSON.stringify(prior) !== JSON.stringify(record)) {
						refuse('fake funding identity is already bound to another operation')
					}
				} else if (prior === null || prior.revision !== expectedRevision || record.revision !== expectedRevision + 1
					|| prior.actor !== record.actor || prior.environmentId !== record.environmentId
					|| prior.fundingOperationId !== record.fundingOperationId
					|| prior.canonicalMintUrl !== record.canonicalMintUrl || prior.amount !== record.amount
					|| prior.schema !== record.schema
					|| (prior.schema === 'PLEBEIAN_FRIDAY_FAKE_FUNDING_RECORD_V1'
						&& record.schema === 'PLEBEIAN_FRIDAY_FAKE_FUNDING_RECORD_V1'
						&& prior.identityCap !== record.identityCap)
					|| (prior.schema === 'PLEBEIAN_FRIDAY_FAKE_FUNDING_RECORD_V2'
						&& record.schema === 'PLEBEIAN_FRIDAY_FAKE_FUNDING_RECORD_V2'
						&& (prior.browserWalletAdvisoryMaxResultingBalance !== record.browserWalletAdvisoryMaxResultingBalance
							|| prior.maxPerRequest !== record.maxPerRequest || prior.policySchema !== record.policySchema
							|| prior.policyDigest !== record.policyDigest))
					|| fakeFundingPhase(record.phase) < fakeFundingPhase(prior.phase)
					|| fakeFundingPhase(record.phase) > fakeFundingPhase(prior.phase) + 1
					|| (prior.quoteId !== undefined && prior.quoteId !== record.quoteId)
					|| (prior.mintOperationId !== undefined && prior.mintOperationId !== record.mintOperationId)) {
					refuse('fake funding revision or immutable recovery identity changed')
				}
				return record
			})
		},
		async loadFundingAbort(identity) {
			const value = await readStore<DemoFridayBrowserAbortRecordV1>(indexedDB, FUNDING_ABORT_STORE, operationKey(identity))
			return value === null ? null : exactFundingAbortRecord(value)
		},
		async saveFundingAbort(recordValue, expectedRevision) {
			const record = exactFundingAbortRecord(recordValue), key = operationKey(record)
			await compareAndPut<DemoFridayBrowserAbortRecordV1>(indexedDB, FUNDING_ABORT_STORE, key, (priorValue) => {
				const prior = priorValue === null ? null : exactFundingAbortRecord(priorValue)
				if (expectedRevision === null) {
					if (prior !== null && JSON.stringify(prior) !== JSON.stringify(record)) {
						refuse('funding-abort identity is already bound to another record')
					}
				} else if (prior === null || prior.revision !== expectedRevision || record.revision !== expectedRevision + 1
					|| prior.actor !== record.actor || prior.environmentId !== record.environmentId
					|| prior.fundingOperationId !== record.fundingOperationId
					|| JSON.stringify(prior.preparation) !== JSON.stringify(record.preparation)
					|| JSON.stringify(prior.actorAbortEvent) !== JSON.stringify(record.actorAbortEvent)
					|| abortPhase(record.phase) < abortPhase(prior.phase)
					|| abortPhase(record.phase) > abortPhase(prior.phase) + 1
					|| (prior.committedStatusDigest !== undefined
						&& prior.committedStatusDigest !== record.committedStatusDigest)
					|| (prior.importReceipt !== undefined
						&& JSON.stringify(prior.importReceipt) !== JSON.stringify(record.importReceipt))) {
					refuse('funding-abort revision, phase, or immutable terms changed')
				}
				return record
			})
		},
		runExclusive(scope, run) { return exclusive(`recipient:${scope}`, run) },
		async load(scope) {
			return readStore<DemoRecipientPrivateRecord<DemoFridayBrowserOpeningRefV1>>(indexedDB, RECIPIENT_STORE, scope)
		},
		async savePrepared(scope, record) {
			await compareAndPut<DemoRecipientPrivateRecord<DemoFridayBrowserOpeningRefV1>>(
				indexedDB, RECIPIENT_STORE, scope, (prior) => {
					if (prior !== null && JSON.stringify(prior) !== JSON.stringify(record)) {
						refuse('recipient scope already owns different openings')
					}
					return structuredClone(record)
				},
			)
		},
		async markImported(scope, requestDigest, responseDigest) {
			if (!HEX_32.test(requestDigest) || !HEX_32.test(responseDigest)) refuse('recipient import digest is invalid')
			await compareAndPut<DemoRecipientPrivateRecord<DemoFridayBrowserOpeningRefV1>>(
				indexedDB, RECIPIENT_STORE, scope, (prior) => {
					if (prior === null || prior.requestDigest !== requestDigest
						|| (prior.importedResponseDigest !== undefined && prior.importedResponseDigest !== responseDigest)) {
						refuse('recipient import differs from the prepared opening record')
					}
					return { ...prior, importedResponseDigest: responseDigest }
				},
			)
		},
	} satisfies DemoFridayBrowserPaymentStatePort)
}
