/**
 * A deliberately narrow bridge between Coco's demo auction outcome and a Cashu NUT-11
 * bidder-plus-committee `SIG_ALL` swap.
 *
 * This module is a bidder-wallet-local spend executor: its contract contains Cashu input proofs and
 * therefore must never run in the public coordinator, browser UI, seller process, or committee
 * process. For this fake-Testnut demo only, the bidder approved disclosure of exact locked proof
 * tuples to the four authenticated validator processes so each can derive the SIG_ALL digest;
 * bidder witnesses/private keys and recipient output openings must not cross that boundary.
 * Recipient outputs remain blinded. The bidder separately approves the complete settlement package
 * and the Cashu `SIG_ALL` digest. A committee port must then return one aggregate signature
 * accompanied by evidence that all four configured participants took part. Only after all checks
 * pass can the injected mint port receive the bearer inputs. Concrete process isolation remains a
 * required integration boundary.
 *
 * Important limits:
 * - a recipient signature authenticates who selected the blinded outputs, but is not a
 *   zero-knowledge proof that the signer knows every output opening;
 * - the four-party coordinator below enforces message flow and all-four availability, but the
 *   injected participant/aggregate implementations are where real FROST and DKG must live;
 * - this module cannot upgrade an existing `SIG_INPUTS` proof to `SIG_ALL` at spend time.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	type BlindedMessage,
	type BlindedSignature,
	type CashuProof,
	CashuMintClient,
	parseP2PKSecret,
} from './nut-client'
import { createOriginBoundMintFetch } from './coco-rail'
import { deriveSellerChildPubkey } from './seller-child'

export type DemoDispositionRole = 'winner_settlement' | 'refund'
export type DemoParticipantId = 1 | 2 | 3 | 4

export interface DemoCommitteeParticipant {
	identifier: DemoParticipantId
	verifyingShare: string
}

export interface DemoRecipientCapability {
	schema: 'COCO_DEMO_RECIPIENT_CAPABILITY_V1'
	network: string
	chainId: string
	auctionId: string
	operationId: string
	role: DemoDispositionRole
	mintUrl: string
	unit: string
	recipientPublicKey: string
	outputsDigest: string
	signature: string
}

export interface DemoBidderApproval {
	schema: 'COCO_DEMO_SIGALL_BIDDER_APPROVAL_V1'
	packageDigest: string
	cashuSigAllDigest: string
	/** Nostr auction actor's BIP340 signature over packageDigest. */
	actorPackageSignature: string
	/** Wallet spend/refund key's BIP340 signature over packageDigest. */
	packageSignature: string
	cashuSignature: string
}

export interface DemoMintCapabilitySeal {
	mintUrl: string
	mintPublicKey: string
	serverVersion: string
	activeSatKeysetId: string
	denominationKeyDigest: string
	denominationAmounts: number[]
	inputFeePpk: number
	nuts: number[]
}

export interface DemoSigAllContract {
	schema: 'COCO_DEMO_SIGALL_CONTRACT_V1'
	network: string
	chainId: string
	auctionId: string
	operationId: string
	bidId: string
	bidEventId: string
	/** X-only Nostr identity that signed the accepted bid. Distinct from bidderPublicKey. */
	bidderActorId: string
	role: DemoDispositionRole
	outcomeHeight: number
	appStateHash: string
	/** Exact winner payout or loser refund amount approved by the auction outcome. */
	amount: number
	/** Exact mint input fee; inputs must equal amount + inputFee and outputs must equal amount. */
	inputFee: number
	mintUrl: string
	unit: string
	/** Seller's auction xpub and the bidder-chosen exact path committed by the signed bid. */
	sellerP2pkXpub: string
	bidderDerivationPath: string
	/** Outcome-selected seller child for a winner, or the bidder key for a refund. */
	recipientPublicKey: string
	mintSeal: DemoMintCapabilitySeal
	inputs: CashuProof[]
	outputs: BlindedMessage[]
	bidderPublicKey: string
	committeePublicKey: string
	committeeKeysetId: string
	committeeKeysetVersion: string
	threshold: 4
	participants: [DemoCommitteeParticipant, DemoCommitteeParticipant, DemoCommitteeParticipant, DemoCommitteeParticipant]
	recipientCapability: DemoRecipientCapability
	approval: DemoBidderApproval
}

export interface DemoCommitteeAuthorizationRequest {
	schema: 'COCO_DEMO_FROST_REQUEST_V1'
	sessionId: string
	packageDigest: string
	cashuSigAllDigest: string
	committeePublicKey: string
	committeeKeysetId: string
	committeeKeysetVersion: string
	participants: DemoCommitteeParticipant[]
}

export interface DemoCommitteeAuthorization {
	schema: 'COCO_DEMO_FROST_AUTHORIZATION_V1'
	sessionId: string
	packageDigest: string
	cashuSigAllDigest: string
	committeeKeysetId: string
	committeeKeysetVersion: string
	participantIds: [1, 2, 3, 4]
	transcriptHash: string
	signature: string
}

export interface DemoCommitteePort {
	authorize(request: DemoCommitteeAuthorizationRequest): Promise<DemoCommitteeAuthorization>
}

const FOUR_OF_FOUR_PORT = Symbol('COCO_DEMO_FOUR_OF_FOUR_PORT')

/** Nominal port produced only by createFourOfFourCommitteePort. */
export interface DemoFourOfFourCommitteePort extends DemoCommitteePort {
	readonly [FOUR_OF_FOUR_PORT]: true
}

export interface DemoSigAllSwapRequest {
	schema: 'COCO_DEMO_SIGALL_SWAP_V1'
	mintUrl: string
	operationId: string
	/** Exact bidder-refund locktime; the main-path spend must not be emitted at or after it. */
	locktime: number
	packageDigest: string
	cashuSigAllDigest: string
	recipientCapabilityDigest: string
	mintSeal: DemoMintCapabilitySeal
	inputs: CashuProof[]
	outputs: BlindedMessage[]
}

export interface DemoSigAllMintPort {
	swapExact(request: DemoSigAllSwapRequest): Promise<{ signatures: BlindedSignature[] }>
}

/**
 * The implementation of this port is part of the safety boundary. It must serialize the complete
 * callback across processes and restarts, reject a different root for the same scope, and replay an
 * already stored successful result for the same root rather than invoking the callback twice. A
 * failed callback must remain resumable for that same root without admitting a conflicting root.
 */
export interface DemoOperationRootGate {
	runExclusive<T>(scope: string, operationRoot: string, run: () => Promise<T>): Promise<T>
}

export interface DemoRoundOneRequest {
	sessionId: string
	digest: string
	packageDigest: string
	committeeKeysetId: string
	committeeKeysetVersion: string
}

export interface DemoRoundOneCommitment {
	participantId: DemoParticipantId
	sessionId: string
	digest: string
	hiding: string
	binding: string
}

export interface DemoRoundTwoRequest extends DemoRoundOneRequest {
	commitments: DemoRoundOneCommitment[]
	transcriptHash: string
}

export interface DemoSignatureShare {
	participantId: DemoParticipantId
	sessionId: string
	digest: string
	transcriptHash: string
	share: string
}

export interface DemoFrostParticipantPort {
	readonly participantId: DemoParticipantId
	readonly verifyingShare: string
	roundOne(request: DemoRoundOneRequest): Promise<DemoRoundOneCommitment>
	roundTwo(request: DemoRoundTwoRequest): Promise<DemoSignatureShare>
}

export interface DemoFrostAggregatePort {
	aggregate(request: {
		sessionId: string
		digest: string
		packageDigest: string
		transcriptHash: string
		commitments: DemoRoundOneCommitment[]
		shares: DemoSignatureShare[]
		committeePublicKey: string
	}): Promise<{ signature: string; transcriptHash: string }>
}

export class DemoSigAllRefusedError extends Error {
	readonly code: string

	constructor(code: string, message: string) {
		super(`${code}: ${message}`)
		this.name = 'DemoSigAllRefusedError'
		this.code = code
	}
}

const COMPRESSED_KEY = /^(?:02|03)[0-9a-f]{64}$/
const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const PARTICIPANT_IDS = [1, 2, 3, 4] as const

/**
 * Fixed minimum interval reserved for bidder-local recovery before the refund path activates.
 *
 * This is deliberately enforced again at every asynchronous boundary and by the concrete mint
 * adapter. It does not remove the mint's first-spend-wins MAIN/refund race; it only ensures this
 * implementation stops originating MAIN-path requests before the bidder's refund window opens.
 */
export const DEMO_SIGALL_SETTLEMENT_SAFETY_SECONDS = 60

export function demoSigAllSettlementCutoff(locktime: number): number {
	if (!Number.isSafeInteger(locktime) || locktime <= DEMO_SIGALL_SETTLEMENT_SAFETY_SECONDS) {
		refuse('DEMO_SIGALL_INVALID_LOCKTIME', `locktime must leave more than ${DEMO_SIGALL_SETTLEMENT_SAFETY_SECONDS} seconds for the settlement safety interval`)
	}
	return locktime - DEMO_SIGALL_SETTLEMENT_SAFETY_SECONDS
}

function refuse(code: string, message: string): never {
	throw new DemoSigAllRefusedError(code, message)
}

function requireText(value: string, field: string): void {
	if (value.length === 0 || value.trim() !== value) refuse('DEMO_SIGALL_INVALID_TEXT', `${field} must be non-empty and trimmed`)
}

function requireCompressedKey(value: string, field: string): void {
	if (!COMPRESSED_KEY.test(value)) refuse('DEMO_SIGALL_INVALID_PUBLIC_KEY', `${field} must be lowercase compressed secp256k1 hex`)
}

function requireXOnlyKey(value: string, field: string): void {
	if (!HEX_32.test(value)) refuse('DEMO_SIGALL_INVALID_PUBLIC_KEY', `${field} must be lowercase x-only secp256k1 hex`)
}

function requireHex32(value: string, field: string): void {
	if (!HEX_32.test(value)) refuse('DEMO_SIGALL_INVALID_DIGEST', `${field} must be 32 lowercase hex bytes`)
}

function requireSignature(value: string, field: string): void {
	if (!HEX_64.test(value)) refuse('DEMO_SIGALL_INVALID_SIGNATURE', `${field} must be 64 lowercase hex bytes`)
}

function requireAmount(value: number, field: string): void {
	if (!Number.isSafeInteger(value) || value <= 0) refuse('DEMO_SIGALL_INVALID_AMOUNT', `${field} must be a positive safe integer`)
}

function requireNonnegativeAmount(value: number, field: string): void {
	if (!Number.isSafeInteger(value) || value < 0) refuse('DEMO_SIGALL_INVALID_AMOUNT', `${field} must be a non-negative safe integer`)
}

function requireExactHttpsOrigin(value: string, field: string): void {
	let url: URL
	try {
		url = new URL(value)
	} catch {
		return refuse('DEMO_SIGALL_MINT_ORIGIN', `${field} must be an exact HTTPS origin`)
	}
	if (url.protocol !== 'https:' || value !== url.origin || url.username !== '' || url.password !== '' || url.port !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
		refuse('DEMO_SIGALL_MINT_ORIGIN', `${field} must be an exact HTTPS origin`)
	}
}

function hashText(value: string): string {
	return bytesToHex(sha256(utf8ToBytes(value)))
}

function verifyDigest(signature: string, digest: string, publicKey: string): boolean {
	try {
		return schnorr.verify(hexToBytes(signature), hexToBytes(digest), hexToBytes(publicKey.slice(2)))
	} catch {
		return false
	}
}

function verifyXOnlyDigest(signature: string, digest: string, publicKey: string): boolean {
	try {
		return schnorr.verify(hexToBytes(signature), hexToBytes(digest), hexToBytes(publicKey))
	} catch {
		return false
	}
}

function canonicalOutputs(outputs: BlindedMessage[]): Array<{ amount: number; id: string; B_: string }> {
	return outputs.map((output, index) => {
		requireAmount(output.amount, `outputs[${index}].amount`)
		requireText(output.id, `outputs[${index}].id`)
		if (!COMPRESSED_KEY.test(output.B_)) refuse('DEMO_SIGALL_INVALID_POINT', `outputs[${index}].B_ must be compressed point hex`)
		return { amount: output.amount, id: output.id, B_: output.B_ }
	})
}

function canonicalInputs(inputs: CashuProof[]): Array<{ amount: number; id: string; secret: string; C: string }> {
	return inputs.map((input, index) => {
		requireAmount(input.amount, `inputs[${index}].amount`)
		requireText(input.id, `inputs[${index}].id`)
		requireText(input.secret, `inputs[${index}].secret`)
		if (!COMPRESSED_KEY.test(input.C)) refuse('DEMO_SIGALL_INVALID_POINT', `inputs[${index}].C must be compressed point hex`)
		return { amount: input.amount, id: input.id, secret: input.secret, C: input.C }
	})
}

/** Exact signed-field concatenation used by cdk/cashu-ts for a NUT-11 `SIG_ALL` swap. */
export function demoCashuSigAllSource(inputs: CashuProof[], outputs: BlindedMessage[]): string {
	canonicalInputs(inputs)
	canonicalOutputs(outputs)
	return [
		...inputs.flatMap((input) => [input.secret, input.C]),
		...outputs.flatMap((output) => [String(output.amount), output.B_]),
	].join('')
}

export function demoCashuSigAllDigest(inputs: CashuProof[], outputs: BlindedMessage[]): string {
	return hashText(demoCashuSigAllSource(inputs, outputs))
}

export function demoOutputsDigest(outputs: BlindedMessage[]): string {
	return hashText(JSON.stringify(canonicalOutputs(outputs)))
}

export function demoDenominationKeyDigest(keys: Record<string, string>): string {
	const denominations = Object.entries(keys).sort(([left], [right]) => Number(left) - Number(right))
	return hashText(JSON.stringify(denominations))
}

export function buildDemoSigAllSecret(options: {
	nonce: string
	bidderPublicKey: string
	committeePublicKey: string
	locktime: number
	refundPublicKey: string
}): string {
	requireHex32(options.nonce, 'nonce')
	requireCompressedKey(options.bidderPublicKey, 'bidderPublicKey')
	requireCompressedKey(options.committeePublicKey, 'committeePublicKey')
	if (options.bidderPublicKey.slice(2) === options.committeePublicKey.slice(2)) {
		refuse('DEMO_SIGALL_SIGNER_KEY_REUSE', 'bidder and committee keys must have distinct x-coordinates')
	}
	const refundPublicKey = options.refundPublicKey
	requireCompressedKey(refundPublicKey, 'refundPublicKey')
	if (
		refundPublicKey.slice(2) === options.bidderPublicKey.slice(2)
		|| refundPublicKey.slice(2) === options.committeePublicKey.slice(2)
	) {
		refuse('DEMO_SIGALL_REFUND_KEY_REUSE', 'refund, bidder, and committee keys must have distinct x-coordinates')
	}
	if (!Number.isSafeInteger(options.locktime) || options.locktime <= 0) {
		refuse('DEMO_SIGALL_INVALID_LOCKTIME', 'locktime must be a positive Unix-seconds integer')
	}
	return JSON.stringify([
		'P2PK',
		{
			nonce: options.nonce,
			data: options.bidderPublicKey,
			tags: [
				['pubkeys', options.committeePublicKey],
				['n_sigs', '2'],
				['sigflag', 'SIG_ALL'],
				['locktime', String(options.locktime)],
				['refund', refundPublicKey],
			],
		},
	])
}

function exactSigAllSecret(contract: DemoSigAllContract): { secret: string; locktime: number; refundPublicKey: string } {
	if (contract.inputs.length === 0) refuse('DEMO_SIGALL_NO_INPUTS', 'at least one input is required')
	const firstSecret = contract.inputs[0].secret
	const parsed = parseP2PKSecret(firstSecret)
	if (!parsed) refuse('DEMO_SIGALL_NOT_P2PK', 'input secret is not a P2PK condition')
	const sigflag = parsed.tags.find(([name]) => name === 'sigflag')?.[1]
	if (sigflag !== 'SIG_ALL') {
		refuse('DEMO_SIGALL_EXISTING_LOCK_INCOMPATIBLE', `input is ${sigflag ?? 'missing-sigflag'}, not SIG_ALL; a spend adapter cannot upgrade the lock`)
	}
	const locktimeText = parsed.tags.find(([name]) => name === 'locktime')?.[1]
	const locktime = Number(locktimeText)
	const refundTags = parsed.tags.filter(([name]) => name === 'refund')
	if (refundTags.length !== 1) refuse('DEMO_SIGALL_REFUND_KEY', 'input lock must contain exactly one refund key')
	const refundPublicKey = refundTags[0]?.[1] ?? ''
	requireCompressedKey(refundPublicKey, 'refundPublicKey')
	if (refundPublicKey.slice(2) === contract.bidderPublicKey.slice(2)
		|| refundPublicKey.slice(2) === contract.committeePublicKey.slice(2)) {
		refuse('DEMO_SIGALL_REFUND_KEY_REUSE', 'refund, bidder, and committee keys must have distinct x-coordinates')
	}
	const seenSecrets = new Set<string>()
	for (const [index, input] of contract.inputs.entries()) {
		const inputLock = parseP2PKSecret(input.secret)
		if (!inputLock) refuse('DEMO_SIGALL_NOT_P2PK', `inputs[${index}] is not a P2PK condition`)
		const rebuilt = buildDemoSigAllSecret({
			nonce: inputLock.nonce,
			bidderPublicKey: contract.bidderPublicKey,
			committeePublicKey: contract.committeePublicKey,
			locktime,
			refundPublicKey,
		})
		if (rebuilt !== input.secret) refuse('DEMO_SIGALL_NONCANONICAL_LOCK', `inputs[${index}] is not the exact bidder-plus-committee canonical form`)
		if (seenSecrets.has(input.secret)) {
			refuse('DEMO_SIGALL_DUPLICATE_PROOF_SECRET', 'every proof needs a unique nonce/secret even though SIG_ALL data and tags are shared')
		}
		seenSecrets.add(input.secret)
	}
	return { secret: firstSecret, locktime, refundPublicKey }
}

/** Public lock fact only; the distinct refund private key and signatures remain bidder-local. */
export function demoSigAllRefundPublicKey(contract: DemoSigAllContract): string {
	return exactSigAllSecret(contract).refundPublicKey
}

function recipientCapabilityUnsigned(capability: DemoRecipientCapability): Record<string, unknown> {
	return {
		schema: capability.schema,
		network: capability.network,
		chainId: capability.chainId,
		auctionId: capability.auctionId,
		operationId: capability.operationId,
		role: capability.role,
		mintUrl: capability.mintUrl,
		unit: capability.unit,
		recipientPublicKey: capability.recipientPublicKey,
		outputsDigest: capability.outputsDigest,
	}
}

export function demoRecipientCapabilityDigest(capability: DemoRecipientCapability): string {
	return hashText(JSON.stringify(recipientCapabilityUnsigned(capability)))
}

function canonicalParticipantRoster(participants: DemoCommitteeParticipant[]): DemoCommitteeParticipant[] {
	if (participants.length !== 4) refuse('DEMO_SIGALL_NOT_FOUR_OF_FOUR', 'committee roster must contain exactly four participants')
	const roster = participants.map((participant, index) => {
		if (participant.identifier !== PARTICIPANT_IDS[index]) {
			refuse('DEMO_SIGALL_NOT_FOUR_OF_FOUR', 'committee participant identifiers must be exactly [1,2,3,4] in order')
		}
		requireCompressedKey(participant.verifyingShare, `participants[${index}].verifyingShare`)
		return { identifier: participant.identifier, verifyingShare: participant.verifyingShare }
	})
	if (new Set(roster.map((participant) => participant.verifyingShare.slice(2))).size !== 4) {
		refuse('DEMO_SIGALL_NOT_FOUR_OF_FOUR', 'committee verifying shares must have four distinct x-coordinates')
	}
	return roster
}

function packageUnsigned(contract: DemoSigAllContract): Record<string, unknown> {
	return {
		schema: contract.schema,
		network: contract.network,
		chainId: contract.chainId,
		auctionId: contract.auctionId,
		operationId: contract.operationId,
		bidId: contract.bidId,
		bidEventId: contract.bidEventId,
		bidderActorId: contract.bidderActorId,
		role: contract.role,
		outcomeHeight: contract.outcomeHeight,
		appStateHash: contract.appStateHash,
		amount: contract.amount,
		inputFee: contract.inputFee,
		mintUrl: contract.mintUrl,
		unit: contract.unit,
		sellerP2pkXpub: contract.sellerP2pkXpub,
		bidderDerivationPath: contract.bidderDerivationPath,
		recipientPublicKey: contract.recipientPublicKey,
		mintSeal: {
			mintUrl: contract.mintSeal.mintUrl,
			mintPublicKey: contract.mintSeal.mintPublicKey,
			serverVersion: contract.mintSeal.serverVersion,
			activeSatKeysetId: contract.mintSeal.activeSatKeysetId,
			denominationKeyDigest: contract.mintSeal.denominationKeyDigest,
			denominationAmounts: [...contract.mintSeal.denominationAmounts],
			inputFeePpk: contract.mintSeal.inputFeePpk,
			nuts: [...contract.mintSeal.nuts],
		},
		inputs: canonicalInputs(contract.inputs),
		outputs: canonicalOutputs(contract.outputs),
		bidderPublicKey: contract.bidderPublicKey,
		committeePublicKey: contract.committeePublicKey,
		committeeKeysetId: contract.committeeKeysetId,
		committeeKeysetVersion: contract.committeeKeysetVersion,
		threshold: contract.threshold,
		participants: canonicalParticipantRoster(contract.participants),
		recipientCapabilityDigest: demoRecipientCapabilityDigest(contract.recipientCapability),
		cashuSigAllDigest: demoCashuSigAllDigest(contract.inputs, contract.outputs),
	}
}

export function demoSigAllPackageDigest(contract: DemoSigAllContract): string {
	return hashText(JSON.stringify(packageUnsigned(contract)))
}

function validateContract(contract: DemoSigAllContract): { packageDigest: string; cashuSigAllDigest: string; recipientCapabilityDigest: string; locktime: number; refundPublicKey: string } {
	if (contract.schema !== 'COCO_DEMO_SIGALL_CONTRACT_V1') refuse('DEMO_SIGALL_SCHEMA', 'unsupported contract schema')
	for (const [field, value] of Object.entries({
		network: contract.network,
		chainId: contract.chainId,
		auctionId: contract.auctionId,
		operationId: contract.operationId,
		bidId: contract.bidId,
		mintUrl: contract.mintUrl,
		unit: contract.unit,
		sellerP2pkXpub: contract.sellerP2pkXpub,
		bidderDerivationPath: contract.bidderDerivationPath,
		committeeKeysetId: contract.committeeKeysetId,
		committeeKeysetVersion: contract.committeeKeysetVersion,
	})) requireText(value, field)
	requireHex32(contract.bidEventId, 'bidEventId')
	requireXOnlyKey(contract.bidderActorId, 'bidderActorId')
	if (!['winner_settlement', 'refund'].includes(contract.role)) refuse('DEMO_SIGALL_ROLE', 'unsupported disposition role')
	if (!Number.isSafeInteger(contract.outcomeHeight) || contract.outcomeHeight <= 0) refuse('DEMO_SIGALL_OUTCOME', 'outcomeHeight must be positive')
	requireHex32(contract.appStateHash, 'appStateHash')
	requireAmount(contract.amount, 'amount')
	requireNonnegativeAmount(contract.inputFee, 'inputFee')
	requireExactHttpsOrigin(contract.mintUrl, 'mintUrl')
	if (contract.unit !== 'sat') refuse('DEMO_SIGALL_UNIT', 'the demo payment rail supports only the sealed sat keyset')
	requireCompressedKey(contract.bidderPublicKey, 'bidderPublicKey')
	requireCompressedKey(contract.committeePublicKey, 'committeePublicKey')
	requireCompressedKey(contract.recipientPublicKey, 'recipientPublicKey')
	const bidderX = contract.bidderPublicKey.slice(2)
	// NUT-11 ignores compressed parity when matching keys, so 02X and 03X are the same signer.
	if (bidderX === contract.committeePublicKey.slice(2)) {
		refuse('DEMO_SIGALL_SIGNER_KEY_REUSE', 'bidder and committee keys must have distinct x-coordinates')
	}
	let sellerRecipient: string
	try {
		sellerRecipient = deriveSellerChildPubkey(contract.sellerP2pkXpub, contract.bidderDerivationPath)
	} catch (error) {
		refuse('DEMO_SIGALL_SELLER_RECIPIENT', error instanceof Error ? error.message : 'seller child derivation failed')
	}
	if (contract.role === 'winner_settlement' && contract.recipientPublicKey !== sellerRecipient) {
		refuse('DEMO_SIGALL_SELLER_RECIPIENT', 'winner output recipient is not derive(seller_p2pk_xpub, bidder_path)')
	}
	const { locktime, refundPublicKey } = exactSigAllSecret(contract)
	if ([contract.bidderPublicKey, contract.committeePublicKey, refundPublicKey, contract.recipientPublicKey]
		.some((key) => key.slice(2) === contract.bidderActorId)) {
		refuse('DEMO_SIGALL_ACTOR_WALLET_KEY_REUSE', 'accepted-bid actor and every payment authorization/recipient key must be distinct')
	}
	if (contract.role === 'refund' && contract.recipientPublicKey !== refundPublicKey) {
		refuse('DEMO_SIGALL_REFUND_RECIPIENT', 'refund output recipient is not the distinct bidder-controlled refund key')
	}
	if (contract.threshold !== 4) refuse('DEMO_SIGALL_NOT_FOUR_OF_FOUR', 'threshold must be exactly four')
	canonicalParticipantRoster(contract.participants)
	const seal = contract.mintSeal
	requireExactHttpsOrigin(seal.mintUrl, 'mintSeal.mintUrl')
	if (seal.mintUrl !== contract.mintUrl) refuse('DEMO_SIGALL_MINT_SEAL', 'mint seal origin differs from contract mint origin')
	for (const [field, value] of Object.entries({ mintPublicKey: seal.mintPublicKey, serverVersion: seal.serverVersion, activeSatKeysetId: seal.activeSatKeysetId })) requireText(value, `mintSeal.${field}`)
	requireHex32(seal.denominationKeyDigest, 'mintSeal.denominationKeyDigest')
	if (!Number.isSafeInteger(seal.inputFeePpk) || seal.inputFeePpk < 0 || seal.inputFeePpk > 100) refuse('DEMO_SIGALL_MINT_SEAL', 'sealed input fee must be between 0 and 100 ppk')
	if (seal.nuts.length === 0 || seal.nuts.some((nut, index) => !Number.isSafeInteger(nut) || nut < 0 || (index > 0 && seal.nuts[index - 1] >= nut)) || !seal.nuts.includes(10) || !seal.nuts.includes(11)) {
		refuse('DEMO_SIGALL_MINT_SEAL', 'sealed NUT list must be canonical and include NUT-10 and NUT-11')
	}
	if (seal.denominationAmounts.length === 0 || seal.denominationAmounts.some((amount, index) => !Number.isSafeInteger(amount) || amount <= 0 || (index > 0 && seal.denominationAmounts[index - 1] >= amount))) {
		refuse('DEMO_SIGALL_MINT_SEAL', 'sealed denominations must be positive, unique, and sorted')
	}
	if (contract.inputs.some((input) => input.id !== seal.activeSatKeysetId) || contract.outputs.some((output) => output.id !== seal.activeSatKeysetId)) {
		refuse('DEMO_SIGALL_MINT_SEAL', 'demo inputs and outputs must use the sealed active sat keyset')
	}
	const inputTotal = contract.inputs.reduce((total, input) => total + input.amount, 0)
	const outputTotal = contract.outputs.reduce((total, output) => total + output.amount, 0)
	if (!Number.isSafeInteger(inputTotal) || !Number.isSafeInteger(outputTotal)) refuse('DEMO_SIGALL_INVALID_AMOUNT', 'input/output total is not a safe integer')
	if (outputTotal !== contract.amount || inputTotal !== contract.amount + contract.inputFee) {
		refuse('DEMO_SIGALL_BALANCE', 'inputs, exact payout/refund amount, outputs, and input fee do not balance')
	}
	const sealedFee = Math.ceil((seal.inputFeePpk * contract.inputs.length) / 1000)
	if (contract.inputFee !== sealedFee) refuse('DEMO_SIGALL_BALANCE', 'input fee differs from the bidder-approved mint capability seal')

	const capability = contract.recipientCapability
	if (capability.schema !== 'COCO_DEMO_RECIPIENT_CAPABILITY_V1') refuse('DEMO_SIGALL_RECIPIENT_SCHEMA', 'unsupported recipient capability')
	for (const field of ['network', 'chainId', 'auctionId', 'operationId', 'role', 'mintUrl', 'unit'] as const) {
		if (capability[field] !== contract[field]) refuse('DEMO_SIGALL_RECIPIENT_SCOPE', `recipient capability ${field} mismatch`)
	}
	requireCompressedKey(capability.recipientPublicKey, 'recipientCapability.recipientPublicKey')
	if (capability.recipientPublicKey !== contract.recipientPublicKey) refuse('DEMO_SIGALL_RECIPIENT_SCOPE', 'recipient capability key differs from outcome-selected recipient')
	requireHex32(capability.outputsDigest, 'recipientCapability.outputsDigest')
	requireSignature(capability.signature, 'recipientCapability.signature')
	if (capability.outputsDigest !== demoOutputsDigest(contract.outputs)) refuse('DEMO_SIGALL_RECIPIENT_OUTPUTS', 'recipient did not authorize the exact outputs')
	const recipientCapabilityDigest = demoRecipientCapabilityDigest(capability)
	if (!verifyDigest(capability.signature, recipientCapabilityDigest, capability.recipientPublicKey)) {
		refuse('DEMO_SIGALL_RECIPIENT_SIGNATURE', 'recipient capability signature is invalid')
	}

	const packageDigest = demoSigAllPackageDigest(contract)
	const cashuSigAllDigest = demoCashuSigAllDigest(contract.inputs, contract.outputs)
	const approval = contract.approval
	if (approval.schema !== 'COCO_DEMO_SIGALL_BIDDER_APPROVAL_V1') refuse('DEMO_SIGALL_APPROVAL_SCHEMA', 'unsupported bidder approval')
	if (approval.packageDigest !== packageDigest || approval.cashuSigAllDigest !== cashuSigAllDigest) {
		refuse('DEMO_SIGALL_APPROVAL_SCOPE', 'bidder approval does not bind the exact package and Cashu digest')
	}
	requireSignature(approval.packageSignature, 'approval.packageSignature')
	requireSignature(approval.actorPackageSignature, 'approval.actorPackageSignature')
	requireSignature(approval.cashuSignature, 'approval.cashuSignature')
	if (!verifyXOnlyDigest(approval.actorPackageSignature, packageDigest, contract.bidderActorId)) {
		refuse('DEMO_SIGALL_ACTOR_APPROVAL_SIGNATURE', 'accepted-bid actor did not authorize the exact package and bidder spend/refund key')
	}
	if (!verifyDigest(approval.packageSignature, packageDigest, contract.bidderPublicKey)) {
		refuse('DEMO_SIGALL_APPROVAL_SIGNATURE', 'bidder package signature is invalid')
	}
	if (!verifyDigest(approval.cashuSignature, cashuSigAllDigest, contract.bidderPublicKey)) {
		refuse('DEMO_SIGALL_BIDDER_WITNESS', 'bidder Cashu witness signature is invalid')
	}
	return { packageDigest, cashuSigAllDigest, recipientCapabilityDigest, locktime, refundPublicKey }
}

function validateCommitteeAuthorization(
	contract: DemoSigAllContract,
	request: DemoCommitteeAuthorizationRequest,
	authorization: DemoCommitteeAuthorization,
): void {
	if (authorization.schema !== 'COCO_DEMO_FROST_AUTHORIZATION_V1') refuse('DEMO_SIGALL_COMMITTEE_SCHEMA', 'unsupported committee authorization')
	for (const field of ['sessionId', 'packageDigest', 'cashuSigAllDigest', 'committeeKeysetId', 'committeeKeysetVersion'] as const) {
		if (authorization[field] !== request[field]) refuse('DEMO_SIGALL_COMMITTEE_SCOPE', `committee authorization ${field} mismatch`)
	}
	if (JSON.stringify(authorization.participantIds) !== JSON.stringify(PARTICIPANT_IDS)) {
		refuse('DEMO_SIGALL_FOUR_OF_FOUR_UNAVAILABLE', 'committee authorization is not from all four participants')
	}
	requireHex32(authorization.transcriptHash, 'authorization.transcriptHash')
	requireSignature(authorization.signature, 'authorization.signature')
	if (!verifyDigest(authorization.signature, request.cashuSigAllDigest, contract.committeePublicKey)) {
		refuse('DEMO_SIGALL_COMMITTEE_SIGNATURE', 'committee aggregate signature is invalid')
	}
}

function supportedNutNumbers(value: unknown): number[] {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return []
	const supported: number[] = []
	for (const [rawNut, rawSettings] of Object.entries(value as Record<string, unknown>)) {
		if (!/^(?:0|[1-9][0-9]*)$/.test(rawNut) || rawSettings === null || typeof rawSettings !== 'object' || Array.isArray(rawSettings)) continue
		const nut = Number(rawNut)
		if (!Number.isSafeInteger(nut)) continue
		const settings = rawSettings as Record<string, unknown>
		if (nut === 4) {
			if (settings.disabled === true || !Array.isArray(settings.methods)) continue
			const hasRequiredMethod = settings.methods.some((method) => (
				method !== null && typeof method === 'object' && !Array.isArray(method)
				&& (method as Record<string, unknown>).method === 'bolt11'
				&& (method as Record<string, unknown>).unit === 'sat'
			))
			if (hasRequiredMethod) supported.push(nut)
			continue
		}
		if (settings.supported === true) supported.push(nut)
	}
	return supported.sort((left, right) => left - right)
}


/** Build a live-capable mint port with the same exact-origin, no-redirect transport fence as R4. */
export function createCashuMintSigAllPort(options: { mintUrl: string; fetchImpl?: typeof fetch; nowSeconds?: () => number }): DemoSigAllMintPort {
	const strictFetch = createOriginBoundMintFetch(options.mintUrl, options.fetchImpl ?? fetch)
	const client = new CashuMintClient({ mintUrl: options.mintUrl, fetchImpl: strictFetch })
	const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000))
	return {
		async swapExact(request) {
			if (request.mintUrl.replace(/\/+$/, '') !== client.mintUrl) {
				refuse('DEMO_SIGALL_MINT_ORIGIN', 'request mint URL differs from the pinned client origin')
			}
			const settlementCutoff = demoSigAllSettlementCutoff(request.locktime)
			if (nowSeconds() >= settlementCutoff) {
				refuse('DEMO_SIGALL_SETTLEMENT_CUTOFF', 'mint preflight began at or after the settlement safety cutoff')
			}
			const [info, keysets] = await Promise.all([client.info(), client.keysets()])
			const active = keysets.keysets.filter((keyset) => keyset.active && keyset.unit === 'sat')
			if (active.length !== 1) refuse('DEMO_SIGALL_MINT_DRIFT', 'mint must advertise exactly one active sat keyset')
			const keysResponse = await client.keys(active[0].id)
			const keyset = keysResponse.keysets.find((entry) => entry.id === active[0].id && entry.unit === 'sat')
			if (!keyset) refuse('DEMO_SIGALL_MINT_DRIFT', 'active sat keyset keys are missing')
			const amounts = Object.keys(keyset.keys).map(Number).sort((left, right) => left - right)
			const nuts = supportedNutNumbers(info.nuts)
			const actualSeal: DemoMintCapabilitySeal = {
				mintUrl: client.mintUrl,
				mintPublicKey: typeof info.pubkey === 'string' ? info.pubkey : '',
				serverVersion: typeof info.version === 'string' ? info.version : '',
				activeSatKeysetId: active[0].id,
				denominationKeyDigest: demoDenominationKeyDigest(keyset.keys),
				denominationAmounts: amounts,
				inputFeePpk: active[0].input_fee_ppk ?? 0,
				nuts,
			}
			if (JSON.stringify(actualSeal) !== JSON.stringify(request.mintSeal)) refuse('DEMO_SIGALL_MINT_DRIFT', 'live mint facts differ from the bidder-approved capability seal')
			if (nowSeconds() >= settlementCutoff) {
				refuse('DEMO_SIGALL_SETTLEMENT_CUTOFF', 'mint preflight completed at or after the settlement safety cutoff')
			}
			const result = await client.swap(request.inputs, request.outputs)
			if (result.signatures.length !== request.outputs.length) {
				refuse('DEMO_SIGALL_MINT_RESPONSE', 'mint returned the wrong number of blinded signatures')
			}
			for (const [index, signature] of result.signatures.entries()) {
				const output = request.outputs[index]
				if (signature.amount !== output.amount || signature.id !== output.id || !COMPRESSED_KEY.test(signature.C_)) {
					refuse('DEMO_SIGALL_MINT_RESPONSE', `mint signature ${index} does not bind the requested amount and keyset`)
				}
			}
			return result
		},
	}
}

export async function executeDemoSigAllSwap(options: {
	contract: DemoSigAllContract
	committee: DemoFourOfFourCommitteePort
	mint: DemoSigAllMintPort
	operationGate: DemoOperationRootGate
	nowSeconds?: () => number
}): Promise<{ signatures: BlindedSignature[] }> {
	let contract: DemoSigAllContract
	try {
		contract = structuredClone(options.contract)
	} catch {
		return refuse('DEMO_SIGALL_CONTRACT_NOT_CLONEABLE', 'wallet-local contract must be an immutable cloneable value')
	}
	const committee = options.committee
	const mint = options.mint
	const operationGate = options.operationGate
	const committeeIsFourOfFour = committee[FOUR_OF_FOUR_PORT] === true
	const authorize = committee.authorize.bind(committee)
	const swapExact = mint.swapExact.bind(mint)
	const runExclusive = operationGate.runExclusive.bind(operationGate)
	const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000))
	const validated = validateContract(contract)
	const settlementCutoff = demoSigAllSettlementCutoff(validated.locktime)
	if (!committeeIsFourOfFour) {
		refuse('DEMO_SIGALL_NOT_FOUR_OF_FOUR', 'committee port was not created by the exact four-party coordinator')
	}
	if (nowSeconds() >= settlementCutoff) {
		refuse('DEMO_SIGALL_SETTLEMENT_CUTOFF', 'committee settlement is unavailable at or after the settlement safety cutoff')
	}
	// One deposited-bid operation may resolve to exactly one role/root, while the auction still needs
	// distinct roots for its winner and every loser. The operation id is therefore part of the gate
	// scope; changing only the role or outputs retains the scope and conflicts on the root.
	const scope = `${contract.network}\u0000${contract.chainId}\u0000${contract.auctionId}\u0000${contract.operationId}`
	return runExclusive(scope, validated.packageDigest, async () => {
		if (nowSeconds() >= settlementCutoff) {
			refuse('DEMO_SIGALL_SETTLEMENT_CUTOFF', 'operation gate completed at or after the settlement safety cutoff')
		}
		const request: DemoCommitteeAuthorizationRequest = {
			schema: 'COCO_DEMO_FROST_REQUEST_V1',
			sessionId: hashText(`COCO_DEMO_FROST_SESSION_V1\u0000${validated.packageDigest}\u0000${validated.cashuSigAllDigest}`),
			packageDigest: validated.packageDigest,
			cashuSigAllDigest: validated.cashuSigAllDigest,
			committeePublicKey: contract.committeePublicKey,
			committeeKeysetId: contract.committeeKeysetId,
			committeeKeysetVersion: contract.committeeKeysetVersion,
			participants: canonicalParticipantRoster(contract.participants),
		}
		const authorization = await authorize(structuredClone(request)).catch((error: unknown) => {
			if (error instanceof DemoSigAllRefusedError) throw error
			return refuse('DEMO_SIGALL_FOUR_OF_FOUR_UNAVAILABLE', error instanceof Error ? error.message : 'committee did not complete')
		})
		validateCommitteeAuthorization(contract, request, authorization)
		if (nowSeconds() >= settlementCutoff) {
			refuse('DEMO_SIGALL_SETTLEMENT_CUTOFF', 'committee authorization completed at or after the settlement safety cutoff')
		}
		const witness = JSON.stringify({ signatures: [contract.approval.cashuSignature, authorization.signature] })
		const swapRequest: DemoSigAllSwapRequest = {
			schema: 'COCO_DEMO_SIGALL_SWAP_V1',
			mintUrl: contract.mintUrl.replace(/\/+$/, ''),
			operationId: contract.operationId,
			locktime: validated.locktime,
			packageDigest: validated.packageDigest,
			cashuSigAllDigest: validated.cashuSigAllDigest,
			recipientCapabilityDigest: validated.recipientCapabilityDigest,
			mintSeal: structuredClone(contract.mintSeal),
			// cashu-ts SigAll.mergeSwapPackage places the transaction witness on the first input only.
			// Mints evaluate it against the source message containing every input and output.
			inputs: contract.inputs.map((input, index) => index === 0 ? ({ ...input, witness }) : ({ ...input, witness: undefined })),
			outputs: contract.outputs.map((output) => ({ ...output })),
		}
		return swapExact(swapRequest)
	})
}

export function demoFrostTranscriptHash(request: DemoRoundOneRequest, commitments: DemoRoundOneCommitment[]): string {
	return hashText(JSON.stringify({
		schema: 'COCO_DEMO_FROST_TRANSCRIPT_V1',
		sessionId: request.sessionId,
		digest: request.digest,
		packageDigest: request.packageDigest,
		committeeKeysetId: request.committeeKeysetId,
		committeeKeysetVersion: request.committeeKeysetVersion,
		commitments: commitments.map(({ participantId, hiding, binding }) => ({ participantId, hiding, binding })),
	}))
}

/**
 * Coordinate two FROST rounds without ever importing participant secret shares. This is a protocol
 * boundary, not a DKG or FROST implementation. A live run still needs four independently isolated
 * participant ports and a reviewed aggregate implementation.
 */
export function createFourOfFourCommitteePort(
	participants: DemoFrostParticipantPort[],
	aggregator: DemoFrostAggregatePort,
): DemoFourOfFourCommitteePort {
	if (participants.length !== 4 || participants.some((participant, index) => participant.participantId !== PARTICIPANT_IDS[index])) {
		refuse('DEMO_SIGALL_NOT_FOUR_OF_FOUR', 'participant ports must be exactly [1,2,3,4] in order')
	}
	for (const [index, participant] of participants.entries()) requireCompressedKey(participant.verifyingShare, `participantPorts[${index}].verifyingShare`)
	if (new Set(participants.map((participant) => participant.verifyingShare.slice(2))).size !== 4) {
		refuse('DEMO_SIGALL_NOT_FOUR_OF_FOUR', 'participant ports must expose four distinct verifying-share x-coordinates')
	}
	return {
		[FOUR_OF_FOUR_PORT]: true,
		async authorize(request) {
			for (const [index, participant] of participants.entries()) {
				if (participant.verifyingShare !== request.participants[index]?.verifyingShare) {
					refuse('DEMO_SIGALL_FROST_ROSTER', `participant ${index + 1} verifying share differs from the bidder-approved roster`)
				}
			}
			const roundOneRequest: DemoRoundOneRequest = {
				sessionId: request.sessionId,
				digest: request.cashuSigAllDigest,
				packageDigest: request.packageDigest,
				committeeKeysetId: request.committeeKeysetId,
				committeeKeysetVersion: request.committeeKeysetVersion,
			}
			let commitments: DemoRoundOneCommitment[]
			try {
				commitments = await Promise.all(participants.map((participant) => participant.roundOne(roundOneRequest)))
			} catch (error) {
				return refuse('DEMO_SIGALL_FOUR_OF_FOUR_UNAVAILABLE', error instanceof Error ? error.message : 'round one incomplete')
			}
			for (const [index, commitment] of commitments.entries()) {
				if (commitment.participantId !== PARTICIPANT_IDS[index] || commitment.sessionId !== request.sessionId || commitment.digest !== request.cashuSigAllDigest) {
					refuse('DEMO_SIGALL_FROST_TRANSCRIPT', `participant ${index + 1} returned a mismatched round-one commitment`)
				}
				requireCompressedKey(commitment.hiding, `commitments[${index}].hiding`)
				requireCompressedKey(commitment.binding, `commitments[${index}].binding`)
			}
			const commitmentXCoordinates = commitments.flatMap((commitment) => [commitment.hiding.slice(2), commitment.binding.slice(2)])
			if (new Set(commitmentXCoordinates).size !== commitmentXCoordinates.length) {
				refuse('DEMO_SIGALL_FROST_TRANSCRIPT', 'all hiding and binding commitments must have distinct x-coordinates')
			}
			const exactTranscriptHash = demoFrostTranscriptHash(roundOneRequest, commitments)
			const roundTwoRequest: DemoRoundTwoRequest = { ...roundOneRequest, commitments, transcriptHash: exactTranscriptHash }
			let shares: DemoSignatureShare[]
			try {
				shares = await Promise.all(participants.map((participant) => participant.roundTwo(roundTwoRequest)))
			} catch (error) {
				return refuse('DEMO_SIGALL_FOUR_OF_FOUR_UNAVAILABLE', error instanceof Error ? error.message : 'round two incomplete')
			}
			for (const [index, share] of shares.entries()) {
				if (share.participantId !== PARTICIPANT_IDS[index] || share.sessionId !== request.sessionId || share.digest !== request.cashuSigAllDigest || share.transcriptHash !== exactTranscriptHash) {
					refuse('DEMO_SIGALL_FROST_TRANSCRIPT', `participant ${index + 1} returned a mismatched signature share`)
				}
				if (!HEX_32.test(share.share)) refuse('DEMO_SIGALL_FROST_SHARE', `participant ${index + 1} returned a malformed share`)
			}
			if (new Set(shares.map((share) => share.share)).size !== shares.length) {
				refuse('DEMO_SIGALL_FROST_SHARE', 'all four participants returned duplicate scalar shares')
			}
			const aggregate = await aggregator.aggregate({
				sessionId: request.sessionId,
				digest: request.cashuSigAllDigest,
				packageDigest: request.packageDigest,
				transcriptHash: exactTranscriptHash,
				commitments,
				shares,
				committeePublicKey: request.committeePublicKey,
			})
			if (aggregate.transcriptHash !== exactTranscriptHash) refuse('DEMO_SIGALL_FROST_TRANSCRIPT', 'aggregate transcript mismatch')
			if (!verifyDigest(aggregate.signature, request.cashuSigAllDigest, request.committeePublicKey)) {
				refuse('DEMO_SIGALL_COMMITTEE_SIGNATURE', 'aggregate signature does not verify under the configured committee key')
			}
			return {
				schema: 'COCO_DEMO_FROST_AUTHORIZATION_V1',
				sessionId: request.sessionId,
				packageDigest: request.packageDigest,
				cashuSigAllDigest: request.cashuSigAllDigest,
				committeeKeysetId: request.committeeKeysetId,
				committeeKeysetVersion: request.committeeKeysetVersion,
				participantIds: [1, 2, 3, 4],
				transcriptHash: exactTranscriptHash,
				signature: aggregate.signature,
			}
		},
	}
}
