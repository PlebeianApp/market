import { useFridayWallet } from './demo-friday-wallet-drain'
/**
 * Browser recovery for a pre-broadcast FundingAbortV1 cancellation.
 *
 * This module never treats a missing bid, elapsed browser time, or a failed
 * HTTP response as an abort. The Coco send remains pending and discoverable
 * until the authenticated service reports a committed abort, every local pool
 * binding matches, and the exact return has been imported and acknowledged.
 */
import { getDecodedToken } from '@cashu/coco-core'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import { verifyThresholdSigAllToken } from './coco-rail'
import type { DemoFridayBrowserCocoWallet } from './demo-friday-browser-coco-wallet'
import type {
	DemoFridayBrowserOperationIdentity,
	DemoFridayBrowserPaymentOperationV1,
	DemoFridayBrowserPaymentStatePort,
} from './demo-friday-browser-payment-state'
import {
	claimDemoFridayCommittedAbort,
	demoFridayFundingAbortActorUnsignedEvent,
	emptyDemoFridayFundingLifecycleState,
	type DemoFridayFundingAbortCertificateV1,
	type DemoFridayFundingAbortNostrEventV1,
	type DemoFridayFundingAbortPinsV1,
} from './demo-friday-funding-pool-lifecycle'
import {
	validateDemoFridayFundingAbortRecoveryCapsule,
	type DemoFridayFundingAbortRecoveryCapsuleV1,
} from './demo-friday-funding-abort-capsule'
import type { DemoRecipientImportReceipt } from './demo-sigall-recipient'
import { proofPoint, type CashuProof } from './nut-client'

const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const COMPRESSED = /^(?:02|03)[0-9a-f]{64}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/
const ABORT_KIND = 28_650
const POOL_CONTEXT = 'PLEBEIAN_FRIDAY_FUNDING_ABORT_POOL_V1'

export type DemoFridayBrowserAbortActorTermsV1 = Omit<DemoFridayFundingAbortCertificateV1,
	'participantPolicyDigest' | 'actorAbortEvent' | 'committeeAbortSignature'>

export interface DemoFridayBrowserAbortPreparationV1 {
	schema: 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_ABORT_PREPARATION_V1'
	preparationId: string
	terms: DemoFridayBrowserAbortActorTermsV1
}

export interface DemoFridayBrowserAbortFinalityV1 {
	schema: 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_ABORT_FINALITY_V1'
	/** NIP-07 kind-28650 actor authorization event. */
	actorAuthorizationEventId: string
	/** Permanent consensus lifecycle identity (the canonical abort-certificate digest). */
	lifecycleEventId: string
	transactionHash: string
	committedHeight: number
	committedAt: number
	appHash: string
	blockHash: string
	commitSignatures: 3 | 4
}

export type DemoFridayBrowserAbortProofState = 'UNSPENT' | 'SPENT' | 'PENDING' | 'UNKNOWN'

interface AbortStatusBase {
	schema: 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_ABORT_STATUS_V1'
	preparationId: string
	actor: string
	fundingOperationId: string
}

export type DemoFridayBrowserAbortStatusV1 =
	| (AbortStatusBase & { status: 'PENDING' | 'UNKNOWN' | 'SPENT' })
	| (AbortStatusBase & {
		status: 'COMMITTED_ABORT'
		certificate: DemoFridayFundingAbortCertificateV1
		finality: DemoFridayBrowserAbortFinalityV1
		proofStates: Array<{ proofY: string; state: DemoFridayBrowserAbortProofState }>
	})

export interface DemoFridayBrowserFundingAbortPort {
	registerCapsuleExact(capsule: DemoFridayFundingAbortRecoveryCapsuleV1): Promise<{ capsuleDigest: string }>
	/** Returns server-held public terms. It does not sign or broadcast. */
	prepareExact(request: DemoFridayBrowserOperationIdentity & {
		reason: 'prebroadcast_client_abandonment' | 'prebroadcast_service_failure'
	}): Promise<DemoFridayBrowserAbortPreparationV1>
	/** Broadcasts only the exact NIP-07 event saved by the browser. */
	requestAbortExact(request: {
		preparationId: string
		actorAbortEvent: DemoFridayFundingAbortNostrEventV1
	}): Promise<DemoFridayBrowserAbortStatusV1>
	/** Read-only recovery. It must never broadcast or manufacture an abort. */
	readExact(request: {
		preparationId: string
		actor: string
		fundingOperationId: string
	}): Promise<DemoFridayBrowserAbortStatusV1>
}

export interface DemoFridayBrowserAbortRecordV1 {
	schema: 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_ABORT_RECORD_V1'
	revision: number
	actor: string
	environmentId: string
	fundingOperationId: string
	phase: 'signed' | 'broadcast_unknown' | 'committed_abort' | 'imported'
	preparation: DemoFridayBrowserAbortPreparationV1
	actorAbortEvent: DemoFridayFundingAbortNostrEventV1
	committedStatusDigest?: string
	importReceipt?: DemoRecipientImportReceipt
}

export interface DemoFridayBrowserAbortJournalPort {
	runExclusive<T>(identity: DemoFridayBrowserOperationIdentity, run: () => Promise<T>): Promise<T>
	loadExact(identity: DemoFridayBrowserOperationIdentity): Promise<DemoFridayBrowserAbortRecordV1 | null>
	saveExact(record: DemoFridayBrowserAbortRecordV1, expectedRevision: number | null): Promise<void>
}

export interface DemoFridayBrowserAbortDiscoveryPort {
	/** Refuses if the public operation is no longer discoverable. */
	assertRetainedExact(identity: DemoFridayBrowserOperationIdentity): Promise<void>
	/** Called only after Coco import and the recipient acknowledgement both finish. */
	markImportedExact(request: DemoFridayBrowserOperationIdentity & {
		committedStatusDigest: string
		importReceipt: DemoRecipientImportReceipt
	}): Promise<void>
}

export interface DemoFridayBrowserAbortReturnPort {
	/** Performs the exact terminal return import and acknowledgement. */
	importReturnExact(identity: DemoFridayBrowserOperationIdentity): Promise<DemoRecipientImportReceipt | null>
}

/** NIP-07-compatible signer narrowed to the exact kind-28650 abort event. */
export interface DemoFridayBrowserAbortNostrPort {
	getPublicKey(): Promise<string>
	signEvent(
		event: Omit<DemoFridayFundingAbortNostrEventV1, 'id' | 'sig'>,
	): Promise<DemoFridayFundingAbortNostrEventV1>
}

export type DemoFridayBrowserAbortResultV1 =
	| { status: 'UNAVAILABLE'; reason: 'PENDING' | 'UNKNOWN' | 'SPENT' }
	| { status: 'COMMITTED_ABORT'; imported: false }
	| { status: 'COMMITTED_ABORT'; imported: true; replay: boolean; receipt: DemoRecipientImportReceipt }

export interface DemoFridayBrowserFundingAbortClient {
	requestExact(identity: DemoFridayBrowserOperationIdentity, reason: DemoFridayBrowserAbortActorTermsV1['abortReason']): Promise<DemoFridayBrowserAbortResultV1>
	recoverExact(identity: DemoFridayBrowserOperationIdentity): Promise<DemoFridayBrowserAbortResultV1>
}

function refuse(message: string): never { throw new Error(`DEMO_FRIDAY_BROWSER_FUNDING_ABORT: ${message}`) }

function canonical(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value)) refuse('canonical value contains a non-safe integer')
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
	if (typeof value !== 'object') refuse('canonical value contains an unsupported type')
	const record = value as Record<string, unknown>
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

function digest(value: unknown): string { return bytesToHex(sha256(utf8ToBytes(canonical(value)))) }

function amountOf(value: unknown): number {
	if (typeof value === 'number') return value
	if (typeof value === 'string') return Number(value)
	if (typeof value === 'bigint') return Number(value)
	if (value !== null && typeof value === 'object' && 'value' in value) {
		return amountOf((value as { value: unknown }).value)
	}
	return Number.NaN
}

function exactIdentity(value: DemoFridayBrowserOperationIdentity): DemoFridayBrowserOperationIdentity {
	if (!HEX_32.test(value.actor) || !ID.test(value.environmentId) || !ID.test(value.fundingOperationId)) {
		refuse('operation identity is malformed')
	}
	return { ...value }
}

export function demoFridayBrowserAbortPoolDigest(value: {
	mintUrl: string
	keysetId: string
	amount: number
	proofYs: string[]
}): string {
	if (!ID.test(value.keysetId) || !Number.isSafeInteger(value.amount) || value.amount < 1
		|| !Array.isArray(value.proofYs) || value.proofYs.length < 1
		|| value.proofYs.some((proofY, index) => !COMPRESSED.test(proofY)
			|| (index > 0 && value.proofYs[index - 1]! >= proofY))) refuse('pool digest input is malformed')
	let origin: string
	try { origin = new URL(value.mintUrl).origin } catch { return refuse('pool mint is malformed') }
	if (origin !== value.mintUrl || !value.mintUrl.startsWith('https://')) refuse('pool mint is not one HTTPS origin')
	return digest([POOL_CONTEXT, origin, value.keysetId, value.amount, value.proofYs])
}

function exactSignedEvent(
	value: DemoFridayFundingAbortNostrEventV1,
	unsigned: Omit<DemoFridayFundingAbortNostrEventV1, 'id' | 'sig'>,
): DemoFridayFundingAbortNostrEventV1 {
	const eventId = bytesToHex(sha256(utf8ToBytes(JSON.stringify([
		0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content,
	]))))
	if (value.id !== eventId || value.pubkey !== unsigned.pubkey || value.kind !== ABORT_KIND
		|| value.created_at !== unsigned.created_at || canonical(value.tags) !== canonical(unsigned.tags)
		|| value.content !== unsigned.content || !HEX_64.test(value.sig)
		|| !schnorr.verify(hexToBytes(value.sig), hexToBytes(eventId), hexToBytes(value.pubkey))) {
		refuse('NIP-07 did not sign the exact cancellation event')
	}
	return structuredClone(value)
}

interface ExactPoolBinding {
	terms: Omit<DemoFridayBrowserAbortActorTermsV1, 'genesisSha256' | 'abortNotBefore' | 'abortExpiresAt' | 'abortReason'>
	proofYs: string[]
}

async function exactPoolBinding(
	operation: DemoFridayBrowserPaymentOperationV1,
	wallet: Pick<DemoFridayBrowserCocoWallet, 'recoverThresholdFunding'>,
	pins: DemoFridayFundingAbortPinsV1,
): Promise<ExactPoolBinding> {
	if (!['coco_locked', 'envelope_prepared', 'server_prepared'].includes(operation.phase)
		|| operation.abortCapsule === undefined || operation.finalizedStatusDigest !== undefined) {
		refuse('only an independently recoverable, non-finalized Coco operation may request cancellation')
	}
	if (operation.authNetworkId !== pins.authNetworkId || operation.chainId !== pins.chainId
		|| operation.canonicalMintUrl !== pins.mintUrl || operation.keysetId !== pins.activeKeysetId
		|| operation.lock.committeePubkey !== pins.committeePublicKey
		|| operation.committeeKeysetId !== pins.committeeKeysetId
		|| operation.committeeKeysetVersion !== pins.committeeKeysetVersion
		|| operation.dkgRunId !== pins.dkgRunId || operation.publicKeyPackageSha256 !== pins.publicKeyPackageSha256
		|| operation.signerRosterDigest !== pins.signerRosterDigest) refuse('operation differs from abort deployment pins')
	const locked = await wallet.recoverThresholdFunding({ amount: operation.fullPoolAmount,
		operationId: operation.fundingOperationId, keysetId: operation.keysetId, lock: operation.lock })
	if (locked.operationId !== operation.fundingOperationId || locked.state !== 'pending'
		|| locked.amount !== operation.fullPoolAmount || locked.keysetId !== operation.keysetId) {
		refuse('Coco did not return the exact pending pool')
	}
	const verifiedLock = verifyThresholdSigAllToken(locked.token, operation.keysetId, operation.lock)
	if (verifiedLock.amount !== operation.fullPoolAmount) refuse('locked pool amount differs')
	let decoded: { mint?: unknown; unit?: unknown; proofs?: unknown }
	try { decoded = getDecodedToken(locked.token, [operation.keysetId]) as typeof decoded }
	catch { return refuse('locked Coco token is not decodable') }
	if (decoded.mint !== operation.canonicalMintUrl || decoded.unit !== 'sat' || !Array.isArray(decoded.proofs)
		|| decoded.proofs.length < 1 || decoded.proofs.length > 32) refuse('locked Coco token identity is invalid')
	const proofs = decoded.proofs as CashuProof[]
	if (proofs.some((proof) => proof.id !== operation.keysetId)
		|| proofs.reduce((sum, proof) => sum + amountOf(proof.amount), 0) !== operation.fullPoolAmount) {
		refuse('locked Coco proof keyset or amount differs')
	}
	const proofYs = proofs.map((proof) => bytesToHex(proofPoint(proof).toBytes(true))).sort()
	const capsule = validateDemoFridayFundingAbortRecoveryCapsule(operation.abortCapsule)
	const refund = capsule.refund
	const packageProofYs = refund.inputs.map((proof) => bytesToHex(proofPoint(proof).toBytes(true))).sort()
	if (canonical(packageProofYs) !== canonical(proofYs) || refund.amount !== operation.fullPoolAmount
		|| refund.mintSeal.activeSatKeysetId !== operation.keysetId
		|| refund.bidderPublicKey !== operation.paymentPublicKey || refund.refundPublicKey !== operation.refundPublicKey
		|| refund.committeePublicKey !== operation.lock.committeePubkey || refund.locktime !== operation.lock.locktime
		|| refund.operationId !== operation.fundingOperationId || refund.auctionId !== operation.auctionId
		|| refund.bidderActorId !== operation.actor || refund.refundSignature === undefined
		|| capsule.actorReturnAuthorization.packageDigest !== refund.templateDigest) {
		refuse('return package differs from the exact locked Coco pool')
	}
	return { proofYs, terms: {
		schema: 'PLEBEIAN_FRIDAY_FUNDING_ABORT_V1', authNetworkId: operation.authNetworkId,
		chainId: operation.chainId, auctionId: operation.auctionId, operationId: operation.fundingOperationId,
		actor: operation.actor, mintUrl: operation.canonicalMintUrl, activeKeysetId: operation.keysetId,
		amount: operation.fullPoolAmount, proofYs,
		poolDigest: demoFridayBrowserAbortPoolDigest({ mintUrl: operation.canonicalMintUrl,
			keysetId: operation.keysetId, amount: operation.fullPoolAmount, proofYs }),
		nut11LockPublicKeys: [operation.paymentPublicKey, operation.lock.committeePubkey],
		locktime: operation.lock.locktime, paymentPublicKey: operation.paymentPublicKey,
		refundPublicKey: operation.refundPublicKey, committeePublicKey: operation.lock.committeePubkey,
		returnPackageDigest: refund.templateDigest, returnCashuSigAllDigest: refund.cashuSigAllDigest,
		bidderReturnSignature: refund.bidderMainSignature,
		// For a bid that never reached full-envelope construction this is the
		// payment-key-authorized capsule identity, not a fabricated bid event.
		fundingAuthorizationEventId: capsule.capsuleDigest,
		committeeKeysetId: operation.committeeKeysetId,
		committeeKeysetVersion: operation.committeeKeysetVersion, dkgRunId: operation.dkgRunId,
		publicKeyPackageSha256: operation.publicKeyPackageSha256,
		signerRosterDigest: operation.signerRosterDigest,
	} }
}

function exactPreparation(
	value: DemoFridayBrowserAbortPreparationV1,
	binding: ExactPoolBinding,
	pins: DemoFridayFundingAbortPinsV1,
	reason: DemoFridayBrowserAbortActorTermsV1['abortReason'],
): DemoFridayBrowserAbortPreparationV1 {
	if (value.schema !== 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_ABORT_PREPARATION_V1'
		|| !HEX_32.test(value.preparationId)) refuse('abort preparation identity is malformed')
	const terms = value.terms
	if (terms.genesisSha256 !== pins.genesisSha256 || terms.abortReason !== reason
		|| !Number.isSafeInteger(terms.abortNotBefore) || !Number.isSafeInteger(terms.abortExpiresAt)
		|| terms.abortNotBefore < 1 || terms.abortExpiresAt < terms.abortNotBefore
		|| terms.abortExpiresAt - terms.abortNotBefore > 4_200 || terms.locktime < terms.abortExpiresAt) {
		refuse('abort preparation validity or reason differs')
	}
	const { genesisSha256: _genesis, abortNotBefore: _notBefore, abortExpiresAt: _expires,
		abortReason: _reason, ...common } = terms
	if (canonical(common) !== canonical(binding.terms)) refuse('abort preparation differs from locked pool or return package')
	return structuredClone(value)
}

function exactRecord(value: DemoFridayBrowserAbortRecordV1): DemoFridayBrowserAbortRecordV1 {
	exactIdentity(value)
	const unsigned = demoFridayFundingAbortActorUnsignedEvent(value.preparation.terms, value.actorAbortEvent.created_at)
	if (value.schema !== 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_ABORT_RECORD_V1'
		|| !Number.isSafeInteger(value.revision) || value.revision < 0
		|| !['signed', 'broadcast_unknown', 'committed_abort', 'imported'].includes(value.phase)
		|| (['committed_abort', 'imported'].includes(value.phase) && !HEX_32.test(value.committedStatusDigest ?? ''))
		|| (value.phase === 'imported' && value.importReceipt?.imported !== true)) refuse('abort journal record is malformed')
	exactSignedEvent(value.actorAbortEvent, unsigned)
	return structuredClone(value)
}

function exactRecoveredRecord(
	value: DemoFridayBrowserAbortRecordV1,
	identity: DemoFridayBrowserOperationIdentity,
	binding: ExactPoolBinding,
	pins: DemoFridayFundingAbortPinsV1,
): DemoFridayBrowserAbortRecordV1 {
	const record = exactRecord(value)
	if (record.actor !== identity.actor || record.environmentId !== identity.environmentId
		|| record.fundingOperationId !== identity.fundingOperationId) {
		refuse('abort journal record belongs to another retained operation')
	}
	exactPreparation(record.preparation, binding, pins, record.preparation.terms.abortReason)
	return record
}

function advance(
	record: DemoFridayBrowserAbortRecordV1,
	patch: Partial<Pick<DemoFridayBrowserAbortRecordV1, 'phase' | 'committedStatusDigest' | 'importReceipt'>>,
): DemoFridayBrowserAbortRecordV1 {
	return { ...structuredClone(record), ...structuredClone(patch), revision: record.revision + 1 }
}

function exactStatusBase(status: DemoFridayBrowserAbortStatusV1, record: DemoFridayBrowserAbortRecordV1): void {
	if (status.schema !== 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_ABORT_STATUS_V1'
		|| status.preparationId !== record.preparation.preparationId || status.actor !== record.actor
		|| status.fundingOperationId !== record.fundingOperationId
		|| !['PENDING', 'UNKNOWN', 'SPENT', 'COMMITTED_ABORT'].includes(status.status)) {
		refuse('abort status belongs to another operation or schema')
	}
}

function exactCommittedStatus(
	status: Extract<DemoFridayBrowserAbortStatusV1, { status: 'COMMITTED_ABORT' }>,
	record: DemoFridayBrowserAbortRecordV1,
	binding: ExactPoolBinding,
	pins: DemoFridayFundingAbortPinsV1,
): string {
	exactStatusBase(status, record)
	const finality = status.finality
	if (finality.schema !== 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_ABORT_FINALITY_V1'
		|| ![finality.actorAuthorizationEventId, finality.lifecycleEventId, finality.transactionHash,
			finality.appHash, finality.blockHash].every((value) => HEX_32.test(value))
		|| !Number.isSafeInteger(finality.committedHeight) || finality.committedHeight < 1
		|| !Number.isSafeInteger(finality.committedAt) || finality.committedAt < 1
		|| ![3, 4].includes(finality.commitSignatures)) refuse('committed abort finality is malformed')
	const certificate = status.certificate
	const { participantPolicyDigest: _policy, actorAbortEvent, committeeAbortSignature: _committee, ...terms } = certificate
	if (canonical(terms) !== canonical(record.preparation.terms)
		|| canonical(actorAbortEvent) !== canonical(record.actorAbortEvent)
		|| finality.actorAuthorizationEventId !== actorAbortEvent.id) refuse('committed abort changed the prepared actor authorization')
	const lifecycle = claimDemoFridayCommittedAbort(emptyDemoFridayFundingLifecycleState(), certificate, pins,
		finality.lifecycleEventId, finality.committedHeight, finality.committedAt)
	const claimed = lifecycle.records[record.fundingOperationId]
	if (claimed?.origin !== 'committed_abort' || claimed.abortCertificateDigest !== finality.lifecycleEventId
		|| canonical(claimed.proofYs) !== canonical(binding.proofYs)) {
		refuse('committed abort does not own the exact locked proof set')
	}
	if (!Array.isArray(status.proofStates) || status.proofStates.length !== binding.proofYs.length
		|| canonical(status.proofStates.map(({ proofY }) => proofY)) !== canonical(binding.proofYs)) {
		refuse('mint proof-state evidence differs from the exact locked pool')
	}
	const states = new Set(status.proofStates.map(({ state }) => state))
	if (states.has('PENDING') || states.has('UNKNOWN') || states.size !== 1
		|| (!states.has('UNSPENT') && !states.has('SPENT'))) {
		refuse('post-finality mint proof state is mixed, PENDING, or UNKNOWN')
	}
	return digest(status)
}

export function createDemoFridayBrowserFundingAbortClient(options: {
	pins: DemoFridayFundingAbortPinsV1
	state: Pick<DemoFridayBrowserPaymentStatePort, 'loadOperation' | 'runWalletExclusive'>
	journal: DemoFridayBrowserAbortJournalPort
	discovery: DemoFridayBrowserAbortDiscoveryPort
	walletFactory: { openExact(request: { actor: string; environmentId: string; canonicalMintUrl: string }): Promise<DemoFridayBrowserCocoWallet> }
	nostrSigner: DemoFridayBrowserAbortNostrPort
	authority: DemoFridayBrowserFundingAbortPort
	returns: DemoFridayBrowserAbortReturnPort
	nowSeconds?: () => number
}): DemoFridayBrowserFundingAbortClient {
	const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1_000))
	const load = async (identityValue: DemoFridayBrowserOperationIdentity) => {
		const identity = exactIdentity(identityValue)
		await options.discovery.assertRetainedExact(identity)
		const actor = await options.nostrSigner.getPublicKey()
		if (actor !== identity.actor) refuse('NIP-07 actor differs from the retained cancellation operation')
		const operation = await options.state.loadOperation(identity)
		if (operation === null) refuse('durable locked Coco operation is absent')
		return options.state.runWalletExclusive(identity, async () => {
			const wallet = await options.walletFactory.openExact({ actor: identity.actor,
				environmentId: identity.environmentId, canonicalMintUrl: operation.canonicalMintUrl })
			return useFridayWallet(wallet, async () => {
				const binding = await exactPoolBinding(operation, wallet, options.pins)
				const capsule = validateDemoFridayFundingAbortRecoveryCapsule(operation.abortCapsule!)
				const registered = await options.authority.registerCapsuleExact(capsule)
				if (registered.capsuleDigest !== capsule.capsuleDigest) refuse('authority registered another abort capsule')
				return { identity, operation, binding }
			})
		})
	}

	const persistStatus = async (
		binding: ExactPoolBinding,
		record: DemoFridayBrowserAbortRecordV1,
		status: DemoFridayBrowserAbortStatusV1,
	): Promise<DemoFridayBrowserAbortResultV1 & { statusDigest?: string }> => {
		exactStatusBase(status, record)
		if (status.status !== 'COMMITTED_ABORT') {
			if (record.phase === 'committed_abort') refuse('committed abort regressed to a non-final status')
			// Absence, delay and HTTP uncertainty are deliberately not authority.
			return { status: 'UNAVAILABLE', reason: status.status }
		}
		const statusDigest = exactCommittedStatus(status, record, binding, options.pins)
		if (record.committedStatusDigest !== undefined && record.committedStatusDigest !== statusDigest) {
			refuse('committed abort finality changed after persistence')
		}
		if (record.phase !== 'committed_abort') {
			const committed = advance(record, { phase: 'committed_abort', committedStatusDigest: statusDigest })
			await options.journal.saveExact(committed, record.revision); record = committed
		}
		return { status: 'COMMITTED_ABORT', imported: false, statusDigest }
	}

	const finish = async (loaded: Awaited<ReturnType<typeof load>>, status: DemoFridayBrowserAbortStatusV1) => {
		const decision = await options.journal.runExclusive(loaded.identity, async () => {
			const held = await options.journal.loadExact(loaded.identity)
			if (held === null) refuse('signed cancellation disappeared before status persistence')
			const record = exactRecoveredRecord(held, loaded.identity, loaded.binding, options.pins)
			if (record.phase === 'imported') return { status: 'COMMITTED_ABORT' as const, imported: true as const,
				replay: true, receipt: structuredClone(record.importReceipt!) }
			return persistStatus(loaded.binding, record, status)
		})
		if (decision.status !== 'COMMITTED_ABORT' || decision.imported) return decision
		if (decision.statusDigest === undefined) return decision
		// Import acquires the normal wallet -> operation lock order. It must not
		// run while this client's operation lock is held (Web Locks are not reentrant).
		const receipt = await options.returns.importReturnExact(loaded.identity)
		if (receipt === null) return { status: 'COMMITTED_ABORT' as const, imported: false as const }
		if (receipt.schema !== 'COCO_DEMO_RECIPIENT_IMPORT_RECEIPT_V1'
			|| receipt.operationId !== loaded.operation.fundingOperationId || receipt.role !== 'refund'
			|| receipt.recipientPublicKey !== loaded.operation.refundPublicKey
			|| receipt.amount !== loaded.operation.fullPoolAmount || receipt.imported !== true) {
			refuse('terminal return receipt differs from the exact aborted pool')
		}
		const saved = await options.journal.runExclusive(loaded.identity, async () => {
			const held = await options.journal.loadExact(loaded.identity)
			if (held === null) refuse('committed cancellation disappeared before import acknowledgement')
			const record = exactRecoveredRecord(held, loaded.identity, loaded.binding, options.pins)
			if (record.phase === 'imported') return structuredClone(record.importReceipt!)
			if (record.phase !== 'committed_abort' || record.committedStatusDigest !== decision.statusDigest) {
				refuse('committed cancellation changed before import acknowledgement')
			}
			const imported = advance(record, { phase: 'imported', committedStatusDigest: decision.statusDigest,
				importReceipt: structuredClone(receipt) })
			await options.journal.saveExact(imported, record.revision)
			return receipt
		})
		await options.discovery.markImportedExact({ ...loaded.identity, committedStatusDigest: decision.statusDigest,
			importReceipt: structuredClone(saved) })
		return { status: 'COMMITTED_ABORT' as const, imported: true as const,
			replay: saved.alreadyImported, receipt: saved }
	}

	const submitSignedOrRead = async (
		record: DemoFridayBrowserAbortRecordV1,
	): Promise<{ kind: 'status'; status: DemoFridayBrowserAbortStatusV1 }
		| { kind: 'direct'; result: DemoFridayBrowserAbortResultV1 }> => {
		if (record.phase !== 'signed') {
			return { kind: 'status', status: await options.authority.readExact({
				preparationId: record.preparation.preparationId, actor: record.actor,
				fundingOperationId: record.fundingOperationId,
			}) }
		}
		try {
			const status = await options.authority.requestAbortExact({
				preparationId: record.preparation.preparationId,
				actorAbortEvent: structuredClone(record.actorAbortEvent),
			})
			// The exact signed request has now crossed the authority boundary.  Mark
			// it unknown before interpreting the reply so restart recovery becomes
			// read-only.  If the process dies before this write, resubmission uses
			// the identical event and the authority's durable exact-operation ID.
			const submitted = advance(record, { phase: 'broadcast_unknown' })
			await options.journal.saveExact(submitted, record.revision)
			return { kind: 'status', status }
		} catch {
			const unknown = advance(record, { phase: 'broadcast_unknown' })
			await options.journal.saveExact(unknown, record.revision)
			return { kind: 'direct', result: { status: 'UNAVAILABLE', reason: 'UNKNOWN' } }
		}
	}

	const recover = async (identityValue: DemoFridayBrowserOperationIdentity): Promise<DemoFridayBrowserAbortResultV1> => {
		const loaded = await load(identityValue)
		const outcome = await options.journal.runExclusive(loaded.identity, async () => {
			let record = await options.journal.loadExact(loaded.identity)
			if (record === null) refuse('no signed cancellation is available to recover')
			record = exactRecoveredRecord(record, loaded.identity, loaded.binding, options.pins)
			return submitSignedOrRead(record)
		})
		if (outcome.kind === 'direct') return outcome.result
		return finish(loaded, outcome.status)
	}

	const client: DemoFridayBrowserFundingAbortClient = {
		async requestExact(
			identityValue: DemoFridayBrowserOperationIdentity,
			reason: DemoFridayBrowserAbortActorTermsV1['abortReason'],
		): Promise<DemoFridayBrowserAbortResultV1> {
			const loaded = await load(identityValue)
			const outcome = await options.journal.runExclusive(loaded.identity, async () => {
				const prior = await options.journal.loadExact(loaded.identity)
				if (prior !== null) {
					const record = exactRecoveredRecord(prior, loaded.identity, loaded.binding, options.pins)
					return submitSignedOrRead(record)
				}
				if (!['prebroadcast_client_abandonment', 'prebroadcast_service_failure'].includes(reason)) {
					refuse('abort reason is invalid')
				}
				const preparation = exactPreparation(await options.authority.prepareExact({ ...loaded.identity, reason }),
					loaded.binding, options.pins, reason)
				const unsigned = demoFridayFundingAbortActorUnsignedEvent(preparation.terms, nowSeconds())
				const actorAbortEvent = exactSignedEvent(await options.nostrSigner.signEvent(unsigned), unsigned)
				let record: DemoFridayBrowserAbortRecordV1 = {
					schema: 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_ABORT_RECORD_V1', revision: 0,
					...loaded.identity, phase: 'signed', preparation: structuredClone(preparation), actorAbortEvent,
				}
				// Store the exact NIP-07 authorization before the first broadcast attempt.
				await options.journal.saveExact(record, null)
				return submitSignedOrRead(record)
			})
			if (outcome.kind === 'direct') return outcome.result
			return finish(loaded, outcome.status)
		},
		recoverExact: recover,
	}
	return Object.freeze(client)
}
