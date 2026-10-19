/**
 * Local-only whole-device-offline payment candidate for the 3-of-4 maintainer model.
 *
 * The bidder and auction actor approve both exact MAIN branches before bid admission. The bidder
 * also pre-signs the exact post-locktime REFUND branch. An executor-private durable store holds the
 * bearer inputs and those fixed capabilities after the bidder device stops; recipient openings stay
 * behind a separate delivery port. A durable outcome selection is bound before committee signing.
 *
 * This file creates no keys, performs no DKG, and is intentionally not package-exported.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	readDemoSigAllTerminal,
	reconcileDemoSigAllSwapV2,
	restoreDemoSigAllTerminalByIdentity,
	restoreDemoSigAllTerminalResponse,
	submitDemoSigAllRefundSwap,
	submitDemoSigAllSwap,
	type DemoSigAllDurableRequest,
	type DemoSigAllRecoveryMintStatePort,
	type DemoSigAllRecoveryResultV2,
	type DemoSigAllRecoveryStore,
	type DemoSigAllTerminalMetadata,
	type DemoSigAllTerminalResponsePort,
} from './demo-sigall-recovery'
import {
	buildDemoSigAllSecret,
	DEMO_SIGALL_SETTLEMENT_SAFETY_SECONDS,
	demoCashuSigAllDigest,
	demoOutputsDigest,
	demoRecipientCapabilityDigest,
	demoSigAllSettlementCutoff,
	type DemoCommitteeParticipant,
	type DemoMintCapabilitySeal,
	type DemoRecipientCapability,
	type DemoSigAllMintPort,
	type DemoSigAllSwapRequest,
} from './demo-sigall-settlement'
import {
	DemoMaintainerFederationRefusedError,
	type DemoMaintainerFederationAuthorization,
	type DemoMaintainerFederationPort,
	type DemoMaintainerFederationRequest,
} from './demo-maintainer-federation'
import { parseP2PKSecret, proofPoint, type BlindedMessage, type BlindedSignature, type CashuProof } from './nut-client'
import { deriveSellerChildPubkey } from './seller-child'

const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const COMPRESSED_KEY = /^(?:02|03)[0-9a-f]{64}$/
const PARTICIPANT_IDS = [1, 2, 3, 4] as const

export type DemoMaintainerBranchRole = 'winner_settlement' | 'refund'

export interface DemoMaintainerExactBranchTemplate {
	schema: 'COCO_DEMO_MAINTAINER_EXACT_BRANCH_V1'
	role: DemoMaintainerBranchRole
	network: string
	chainId: string
	auctionId: string
	operationId: string
	bidId: string
	bidEventId: string
	bidderActorId: string
	amount: number
	inputFee: number
	mintUrl: string
	unit: 'sat'
	locktime: number
	validUntil: number
	closeTime: number
	settlementWindowSeconds: number
	sellerP2pkXpub: string
	bidderDerivationPath: string
	recipientPublicKey: string
	bidderPublicKey: string
	refundPublicKey: string
	committeePublicKey: string
	committeeKeysetId: string
	committeeKeysetVersion: string
	threshold: 3
	participants: DemoCommitteeParticipant[]
	mintSeal: DemoMintCapabilitySeal
	inputs: CashuProof[]
	outputs: BlindedMessage[]
	recipientCapability: DemoRecipientCapability
	templateDigest: string
	cashuSigAllDigest: string
	bidderMainSignature: string
	/** Required only for the refund template; valid solely after locktime. */
	refundSignature?: string
}

export interface DemoMaintainerExactTemplateBundle {
	schema: 'COCO_DEMO_MAINTAINER_TEMPLATE_BUNDLE_V1'
	preparedAt: number
	winner: DemoMaintainerExactBranchTemplate
	refund: DemoMaintainerExactBranchTemplate
	bundleDigest: string
	actorBundleSignature: string
	bidderBundleSignature: string
}

export interface DemoMaintainerFinalOutcome {
	schema: 'COCO_DEMO_MAINTAINER_FINAL_OUTCOME_V1'
	network: string
	chainId: string
	auctionId: string
	operationId: string
	bidId: string
	bidEventId: string
	bidderActorId: string
	role: DemoMaintainerBranchRole
	amount: number
	outcomeHeight: number
	appStateHash: string
	policyPackageDigest: string
	closureEvidenceDigest: string
	signedBidEvidenceDigest: string
	committeeLockedProofsDigest: string
}

export interface DemoMaintainerOutcomeSelection {
	schema: 'COCO_DEMO_MAINTAINER_OUTCOME_SELECTION_V1'
	selectionRoot: string
	templateDigest: string
	outcome: DemoMaintainerFinalOutcome
}

export interface DemoMaintainerOfflineRecord {
	bundle: DemoMaintainerExactTemplateBundle
	admission: DemoMaintainerAdmissionReceipt
	selection?: DemoMaintainerOutcomeSelection
	authorization?: DemoMaintainerFederationAuthorization
	federationAttempts?: DemoMaintainerFederationAttempt[]
}

export interface DemoMaintainerAdmissionReceipt {
	schema: 'COCO_DEMO_MAINTAINER_ADMISSION_RECEIPT_V1'
	bundleDigest: string
	admittedAt: number
	notAfter: number
}

export interface DemoMaintainerFederationAttempt {
	schema: 'COCO_DEMO_MAINTAINER_FEDERATION_ATTEMPT_V1'
	attemptNumber: number
	sessionId: string
	excludeParticipantId?: 1 | 2 | 3 | 4
}

/** Must be executor-private, durable, atomic across processes/restarts, and encrypted/0600 at rest. */
export interface DemoMaintainerOfflineStore {
	/** Atomically persist only when the store's authoritative clock is at or before notAfter. */
	persistPrepared(
		scope: string,
		bundle: DemoMaintainerExactTemplateBundle,
		options: { notAfter: number },
	): Promise<DemoMaintainerOfflineRecord>
	loadExact(scope: string, bundleDigest: string): Promise<DemoMaintainerOfflineRecord | null>
	bindOutcome(scope: string, bundleDigest: string, selection: DemoMaintainerOutcomeSelection): Promise<DemoMaintainerOfflineRecord>
	/** Atomically reserve a never-before-issued monotonically numbered session. */
	reserveFederationAttempt(
		scope: string,
		bundleDigest: string,
		selectionRoot: string,
		excludeParticipantId?: 1 | 2 | 3 | 4,
	): Promise<DemoMaintainerFederationAttempt>
	saveAuthorization(
		scope: string,
		bundleDigest: string,
		selectionRoot: string,
		authorization: DemoMaintainerFederationAuthorization,
	): Promise<DemoMaintainerOfflineRecord>
}

export interface DemoMaintainerFinalOutcomePort {
	readExact(request: { scope: string; bundleDigest: string }): Promise<DemoMaintainerFinalOutcome | null>
}

/** Recipient-private implementation owns openings/unblinding/import journals. */
export interface DemoMaintainerRecipientDeliveryPort {
	deliverExact(request: {
		selectionRoot: string
		templateDigest: string
		role: DemoMaintainerBranchRole
		operationId: string
		recipientCapabilityDigest: string
		signatures: BlindedSignature[]
	}): Promise<{ imported: true; alreadyImported: boolean }>
}

export interface DemoMaintainerOfflineIdentity {
	scope: string
	bundleDigest: string
}

export interface DemoMaintainerOfflineSuccess {
	status: 'settled' | 'refunded'
	deliverySource: 'mint_response' | 'exact_recovery' | 'terminal_restore'
	selectionRoot: string
	terminal: DemoSigAllTerminalMetadata
	recipient: { imported: true; alreadyImported: boolean }
}

/** Exact canonical disposition facts the caller requires before any signer, mint, or recipient effect. */
export interface DemoMaintainerExpectedDisposition {
	schema: 'COCO_DEMO_MAINTAINER_EXPECTED_DISPOSITION_V1'
	network: string
	chainId: string
	auctionId: string
	operationId: string
	bidId: string
	bidEventId: string
	bidderActorId: string
	role: DemoMaintainerBranchRole
	amount: number
	outcomeHeight: number
	appStateHash: string
	closureEvidenceDigest: string
}

export interface DemoMaintainerOfflineDeferred {
	status: 'deferred'
	reason: 'refund_not_yet_eligible'
	selectionRoot: string
	eligibleAt: number
}

export type DemoMaintainerOfflineExecutionResult = DemoMaintainerOfflineSuccess | DemoMaintainerOfflineDeferred

export type DemoMaintainerOfflineRecoveryResult = DemoMaintainerOfflineSuccess | Exclude<
	DemoSigAllRecoveryResultV2,
	{ status: 'recovered' | 'terminal_replay' }
>

export class DemoMaintainerOfflineRefusedError extends Error {
	constructor(readonly code: string, message: string) {
		super(`${code}: ${message}`)
		this.name = 'DemoMaintainerOfflineRefusedError'
	}
}

function refuse(code: string, message: string): never {
	throw new DemoMaintainerOfflineRefusedError(code, message)
}

function hash(value: unknown): string {
	return bytesToHex(sha256(utf8ToBytes(JSON.stringify(value))))
}

function exactKeys(value: object, expected: string[], code = 'DEMO_MAINTAINER_TEMPLATE'): void {
	const actual = Object.keys(value).sort()
	const wanted = [...expected].sort()
	if (JSON.stringify(actual) !== JSON.stringify(wanted)) refuse(code, 'object contains missing or unexpected fields')
}

function verify(signature: string, digest: string, publicKey: string): boolean {
	if (!HEX_64.test(signature) || !HEX_32.test(digest)) return false
	const xOnly = COMPRESSED_KEY.test(publicKey) ? publicKey.slice(2) : publicKey
	if (!HEX_32.test(xOnly)) return false
	try { return schnorr.verify(hexToBytes(signature), hexToBytes(digest), hexToBytes(xOnly)) }
	catch { return false }
}

function requireText(value: string, field: string): void {
	if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
		refuse('DEMO_MAINTAINER_TEMPLATE', `${field} must be non-empty, trimmed, and free of control characters`)
	}
}

function exactOrigin(value: string, field: string): string {
	let url: URL
	try { url = new URL(value) }
	catch { return refuse('DEMO_MAINTAINER_TEMPLATE', `${field} must be an HTTPS origin`) }
	if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '' || (url.pathname !== '' && url.pathname !== '/')) {
		refuse('DEMO_MAINTAINER_TEMPLATE', `${field} must be an exact credential-free HTTPS origin`)
	}
	return url.origin
}

function canonicalRoster(value: DemoCommitteeParticipant[]): DemoCommitteeParticipant[] {
	if (!Array.isArray(value) || value.length !== 4) refuse('DEMO_MAINTAINER_TEMPLATE_ROSTER', 'roster must contain four participants')
	const roster = value.map((participant, index) => {
		exactKeys(participant, ['identifier', 'verifyingShare'], 'DEMO_MAINTAINER_TEMPLATE_ROSTER')
		if (participant.identifier !== PARTICIPANT_IDS[index] || !COMPRESSED_KEY.test(participant.verifyingShare)) {
			refuse('DEMO_MAINTAINER_TEMPLATE_ROSTER', 'roster must be exact ordered participants [1,2,3,4]')
		}
		return { identifier: participant.identifier, verifyingShare: participant.verifyingShare }
	})
	if (new Set(roster.map(({ verifyingShare }) => verifyingShare.slice(2))).size !== 4) {
		refuse('DEMO_MAINTAINER_TEMPLATE_ROSTER', 'verifying shares must be distinct')
	}
	return roster
}

function firstLock(template: DemoMaintainerExactBranchTemplate): {
	bidderPublicKey: string
	committeePublicKey: string
	refundPublicKey: string
	locktime: number
} {
	if (!Array.isArray(template.inputs) || template.inputs.length === 0) refuse('DEMO_MAINTAINER_TEMPLATE_INPUT', 'template needs bearer inputs')
	let facts: ReturnType<typeof parseP2PKSecret> | null = null
	const secrets = new Set<string>()
	for (const [index, input] of template.inputs.entries()) {
		exactKeys(input, input.dleq === undefined
			? ['amount', 'id', 'secret', 'C']
			: ['amount', 'id', 'secret', 'C', 'dleq'], 'DEMO_MAINTAINER_TEMPLATE_INPUT')
		if (input.witness !== undefined) refuse('DEMO_MAINTAINER_TEMPLATE_INPUT', 'prepared inputs must not contain a witness')
		if (!Number.isSafeInteger(input.amount) || input.amount < 1 || typeof input.id !== 'string' || input.id.length === 0
			|| !COMPRESSED_KEY.test(input.C)) refuse('DEMO_MAINTAINER_TEMPLATE_INPUT', `input ${index} has invalid amount, keyset, or point`)
		if (input.dleq !== undefined) {
			exactKeys(input.dleq, input.dleq.r === undefined ? ['e', 's'] : ['e', 's', 'r'], 'DEMO_MAINTAINER_TEMPLATE_INPUT')
			if (!HEX_32.test(input.dleq.e) || !HEX_32.test(input.dleq.s)
				|| (input.dleq.r !== undefined && !HEX_32.test(input.dleq.r))) {
				refuse('DEMO_MAINTAINER_TEMPLATE_INPUT', `input ${index} has malformed DLEQ scalars`)
			}
		}
		const parsed = parseP2PKSecret(input.secret)
		if (parsed === null) refuse('DEMO_MAINTAINER_TEMPLATE_INPUT', `input ${index} is not P2PK`)
		const committee = parsed.tags.filter(([name]) => name === 'pubkeys')
		const refunds = parsed.tags.filter(([name]) => name === 'refund')
		const flags = parsed.tags.filter(([name]) => name === 'sigflag')
		const locktimes = parsed.tags.filter(([name]) => name === 'locktime')
		const nSigs = parsed.tags.filter(([name]) => name === 'n_sigs')
		if (committee.length !== 1 || refunds.length !== 1 || flags.length !== 1 || locktimes.length !== 1 || nSigs.length !== 1
			|| flags[0]?.[1] !== 'SIG_ALL' || nSigs[0]?.[1] !== '2') refuse('DEMO_MAINTAINER_TEMPLATE_INPUT', 'input lock is not exact bidder-plus-committee SIG_ALL')
		const locktime = Number(locktimes[0]?.[1])
		const committeePublicKey = committee[0]?.[1] ?? ''
		const refundPublicKey = refunds[0]?.[1] ?? ''
		if (!COMPRESSED_KEY.test(parsed.data) || !COMPRESSED_KEY.test(committeePublicKey) || !COMPRESSED_KEY.test(refundPublicKey)
			|| !Number.isSafeInteger(locktime) || locktime <= 0) refuse('DEMO_MAINTAINER_TEMPLATE_INPUT', 'input lock contains invalid keys or locktime')
		const rebuilt = buildDemoSigAllSecret({ nonce: parsed.nonce, bidderPublicKey: parsed.data, committeePublicKey, refundPublicKey, locktime })
		if (rebuilt !== input.secret || secrets.has(input.secret)) refuse('DEMO_MAINTAINER_TEMPLATE_INPUT', 'input lock is noncanonical or reused')
		secrets.add(input.secret)
		if (facts === null) facts = parsed
		else if (parsed.data !== facts.data || JSON.stringify(parsed.tags) !== JSON.stringify(facts.tags)) {
			refuse('DEMO_MAINTAINER_TEMPLATE_INPUT', 'inputs change the shared lock facts')
		}
	}
	const committeePublicKey = facts!.tags.find(([name]) => name === 'pubkeys')![1]!
	const refundPublicKey = facts!.tags.find(([name]) => name === 'refund')![1]!
	const locktime = Number(facts!.tags.find(([name]) => name === 'locktime')![1])
	return { bidderPublicKey: facts!.data, committeePublicKey, refundPublicKey, locktime }
}

function canonicalTemplateUnsigned(value: DemoMaintainerExactBranchTemplate): Record<string, unknown> {
	return {
		schema: value.schema,
		role: value.role,
		network: value.network,
		chainId: value.chainId,
		auctionId: value.auctionId,
		operationId: value.operationId,
		bidId: value.bidId,
		bidEventId: value.bidEventId,
		bidderActorId: value.bidderActorId,
		amount: value.amount,
		inputFee: value.inputFee,
		mintUrl: value.mintUrl,
		unit: value.unit,
		locktime: value.locktime,
		validUntil: value.validUntil,
		closeTime: value.closeTime,
		settlementWindowSeconds: value.settlementWindowSeconds,
		sellerP2pkXpub: value.sellerP2pkXpub,
		bidderDerivationPath: value.bidderDerivationPath,
		recipientPublicKey: value.recipientPublicKey,
		bidderPublicKey: value.bidderPublicKey,
		refundPublicKey: value.refundPublicKey,
		committeePublicKey: value.committeePublicKey,
		committeeKeysetId: value.committeeKeysetId,
		committeeKeysetVersion: value.committeeKeysetVersion,
		threshold: value.threshold,
		participants: value.participants.map(({ identifier, verifyingShare }) => ({ identifier, verifyingShare })),
		mintSeal: structuredClone(value.mintSeal),
		inputs: value.inputs.map(({ amount, id, secret, C, dleq }) => ({ amount, id, secret, C, dleq: dleq ?? null })),
		outputs: value.outputs.map(({ amount, id, B_ }) => ({ amount, id, B_ })),
		recipientCapabilityDigest: demoRecipientCapabilityDigest(value.recipientCapability),
		cashuSigAllDigest: demoCashuSigAllDigest(value.inputs, value.outputs),
	}
}

export function demoMaintainerExactTemplateDigest(value: DemoMaintainerExactBranchTemplate): string {
	return hash(canonicalTemplateUnsigned(value))
}

function validateTemplate(value: DemoMaintainerExactBranchTemplate, expectedRole: DemoMaintainerBranchRole): DemoMaintainerExactBranchTemplate {
	let template: DemoMaintainerExactBranchTemplate
	try { template = structuredClone(value) }
	catch { return refuse('DEMO_MAINTAINER_TEMPLATE', 'template must be cloneable') }
	exactKeys(template, [
		'schema', 'role', 'network', 'chainId', 'auctionId', 'operationId', 'bidId', 'bidEventId',
		'bidderActorId', 'amount', 'inputFee', 'mintUrl', 'unit', 'locktime', 'validUntil', 'closeTime',
		'settlementWindowSeconds', 'sellerP2pkXpub', 'bidderDerivationPath', 'recipientPublicKey',
		'bidderPublicKey', 'refundPublicKey', 'committeePublicKey', 'committeeKeysetId',
		'committeeKeysetVersion', 'threshold', 'participants', 'mintSeal', 'inputs', 'outputs',
		'recipientCapability', 'templateDigest', 'cashuSigAllDigest', 'bidderMainSignature',
		...(expectedRole === 'refund' ? ['refundSignature'] : []),
	])
	if (template.schema !== 'COCO_DEMO_MAINTAINER_EXACT_BRANCH_V1' || template.role !== expectedRole || template.threshold !== 3 || template.unit !== 'sat') {
		refuse('DEMO_MAINTAINER_TEMPLATE', 'template schema, role, threshold, or unit is invalid')
	}
	for (const [field, text] of Object.entries({
		network: template.network, chainId: template.chainId, auctionId: template.auctionId,
		operationId: template.operationId, bidId: template.bidId, sellerP2pkXpub: template.sellerP2pkXpub,
		bidderDerivationPath: template.bidderDerivationPath, committeeKeysetId: template.committeeKeysetId,
		committeeKeysetVersion: template.committeeKeysetVersion,
	})) requireText(text, field)
	if (!HEX_32.test(template.bidEventId) || !HEX_32.test(template.bidderActorId)
		|| !COMPRESSED_KEY.test(template.recipientPublicKey) || !COMPRESSED_KEY.test(template.bidderPublicKey)
		|| !COMPRESSED_KEY.test(template.refundPublicKey) || !COMPRESSED_KEY.test(template.committeePublicKey)
		|| !Number.isSafeInteger(template.amount) || template.amount < 1
		|| !Number.isSafeInteger(template.inputFee) || template.inputFee < 0
		|| !Number.isSafeInteger(template.locktime) || template.locktime < 1
		|| !Number.isSafeInteger(template.validUntil) || template.validUntil < 1
		|| !Number.isSafeInteger(template.closeTime) || template.closeTime < 1
		|| !Number.isSafeInteger(template.settlementWindowSeconds)
		|| template.settlementWindowSeconds < DEMO_SIGALL_SETTLEMENT_SAFETY_SECONDS
		|| template.closeTime > template.validUntil
		|| template.closeTime + template.settlementWindowSeconds > demoSigAllSettlementCutoff(template.locktime)) {
		refuse('DEMO_MAINTAINER_TEMPLATE', 'template identity, keys, amount, or timing is invalid')
	}
	if ([template.bidderPublicKey, template.refundPublicKey, template.committeePublicKey]
		.some((key) => key.slice(2) === template.bidderActorId)) {
		refuse('DEMO_MAINTAINER_TEMPLATE_IDENTITY', 'auction actor and payment authorization keys must be distinct')
	}
	template.mintUrl = exactOrigin(template.mintUrl, 'mintUrl')
	const roster = canonicalRoster(template.participants)
	const lock = firstLock(template)
	if (lock.bidderPublicKey !== template.bidderPublicKey || lock.committeePublicKey !== template.committeePublicKey
		|| lock.refundPublicKey !== template.refundPublicKey || lock.locktime !== template.locktime) {
		refuse('DEMO_MAINTAINER_TEMPLATE_INPUT', 'template public keys or locktime differ from bearer inputs')
	}
	let sellerRecipient: string
	try { sellerRecipient = deriveSellerChildPubkey(template.sellerP2pkXpub, template.bidderDerivationPath) }
	catch { return refuse('DEMO_MAINTAINER_TEMPLATE_RECIPIENT', 'seller recipient derivation failed') }
	const expectedRecipient = expectedRole === 'winner_settlement' ? sellerRecipient : template.refundPublicKey
	if (template.recipientPublicKey !== expectedRecipient) refuse('DEMO_MAINTAINER_TEMPLATE_RECIPIENT', 'template redirects the exact role recipient')
	if (expectedRecipient.slice(2) === template.bidderActorId) {
		refuse('DEMO_MAINTAINER_TEMPLATE_IDENTITY', 'auction actor and role-selected recipient key must be distinct')
	}
	if (!Array.isArray(template.outputs) || template.outputs.length === 0
		|| template.outputs.some((output) => {
			exactKeys(output, ['amount', 'id', 'B_'], 'DEMO_MAINTAINER_TEMPLATE_OUTPUT')
			return !Number.isSafeInteger(output.amount) || output.amount < 1 || output.id.length === 0 || !COMPRESSED_KEY.test(output.B_)
		})
		|| new Set(template.outputs.map(({ B_ }) => B_.slice(2))).size !== template.outputs.length) {
		refuse('DEMO_MAINTAINER_TEMPLATE_OUTPUT', 'template outputs are malformed or reused')
	}
	const inputTotal = template.inputs.reduce((sum, input) => sum + input.amount, 0)
	const outputTotal = template.outputs.reduce((sum, output) => sum + output.amount, 0)
	if (inputTotal !== template.amount + template.inputFee || outputTotal !== template.amount) refuse('DEMO_MAINTAINER_TEMPLATE_BALANCE', 'template does not consume the exact amount and fee')
	const seal = template.mintSeal
	exactKeys(seal, [
		'mintUrl', 'mintPublicKey', 'serverVersion', 'activeSatKeysetId', 'denominationKeyDigest',
		'denominationAmounts', 'inputFeePpk', 'nuts',
	], 'DEMO_MAINTAINER_TEMPLATE_MINT')
	if (exactOrigin(seal.mintUrl, 'mintSeal.mintUrl') !== template.mintUrl
		|| !COMPRESSED_KEY.test(seal.mintPublicKey) || typeof seal.serverVersion !== 'string' || seal.serverVersion.length === 0
		|| seal.activeSatKeysetId.length === 0 || !HEX_32.test(seal.denominationKeyDigest)
		|| !Array.isArray(seal.denominationAmounts) || seal.denominationAmounts.length === 0
		|| seal.denominationAmounts.some((amount) => !Number.isSafeInteger(amount) || amount < 1)
		|| new Set(seal.denominationAmounts).size !== seal.denominationAmounts.length
		|| seal.denominationAmounts.some((amount, index) => index > 0 && amount <= seal.denominationAmounts[index - 1]!)
		|| !Number.isSafeInteger(seal.inputFeePpk) || seal.inputFeePpk < 0 || seal.inputFeePpk > 100
		|| template.inputFee !== Math.ceil((seal.inputFeePpk * template.inputs.length) / 1000)
		|| !Array.isArray(seal.nuts) || ![7, 10, 11].every((nut) => seal.nuts.includes(nut))
		|| seal.nuts.some((nut) => !Number.isSafeInteger(nut) || nut < 0)
		|| new Set(seal.nuts).size !== seal.nuts.length
		|| template.inputs.some((input) => !seal.denominationAmounts.includes(input.amount))
		|| template.outputs.some((output) => !seal.denominationAmounts.includes(output.amount))
		|| template.inputs.some((input) => input.id !== seal.activeSatKeysetId)
		|| template.outputs.some((output) => output.id !== seal.activeSatKeysetId)) refuse('DEMO_MAINTAINER_TEMPLATE_MINT', 'template differs from the exact sealed mint/keyset')
	const capability = template.recipientCapability
	exactKeys(capability, [
		'schema', 'network', 'chainId', 'auctionId', 'operationId', 'role', 'mintUrl', 'unit',
		'recipientPublicKey', 'outputsDigest', 'signature',
	], 'DEMO_MAINTAINER_TEMPLATE_RECIPIENT')
	if (capability.schema !== 'COCO_DEMO_RECIPIENT_CAPABILITY_V1'
		|| capability.network !== template.network || capability.chainId !== template.chainId
		|| capability.auctionId !== template.auctionId || capability.operationId !== template.operationId
		|| capability.role !== template.role || exactOrigin(capability.mintUrl, 'recipientCapability.mintUrl') !== template.mintUrl
		|| capability.unit !== 'sat' || capability.recipientPublicKey !== template.recipientPublicKey
		|| capability.outputsDigest !== demoOutputsDigest(template.outputs)
		|| !verify(capability.signature, demoRecipientCapabilityDigest(capability), capability.recipientPublicKey)) {
		refuse('DEMO_MAINTAINER_TEMPLATE_RECIPIENT', 'recipient did not authorize the exact role outputs')
	}
	const cashuDigest = demoCashuSigAllDigest(template.inputs, template.outputs)
	if (template.cashuSigAllDigest !== cashuDigest || !verify(template.bidderMainSignature, cashuDigest, template.bidderPublicKey)) {
		refuse('DEMO_MAINTAINER_TEMPLATE_SIGNATURE', 'bidder MAIN signature does not bind the exact template')
	}
	if (expectedRole === 'refund') {
		if (template.refundSignature === undefined || !verify(template.refundSignature, cashuDigest, template.refundPublicKey)) {
			refuse('DEMO_MAINTAINER_TEMPLATE_SIGNATURE', 'refund template lacks the exact pre-signed REFUND capability')
		}
	} else if (template.refundSignature !== undefined) refuse('DEMO_MAINTAINER_TEMPLATE_SIGNATURE', 'winner template must not carry a REFUND signature')
	const templateDigest = demoMaintainerExactTemplateDigest(template)
	if (template.templateDigest !== templateDigest) refuse('DEMO_MAINTAINER_TEMPLATE_DIGEST', 'template digest is not canonical')
	return { ...template, participants: roster }
}

function sharedTemplateFacts(template: DemoMaintainerExactBranchTemplate): Record<string, unknown> {
	return {
		network: template.network, chainId: template.chainId, auctionId: template.auctionId,
		operationId: template.operationId, bidId: template.bidId, bidEventId: template.bidEventId,
		bidderActorId: template.bidderActorId, amount: template.amount, inputFee: template.inputFee,
		mintUrl: template.mintUrl, unit: template.unit, locktime: template.locktime, validUntil: template.validUntil,
		closeTime: template.closeTime, settlementWindowSeconds: template.settlementWindowSeconds,
		sellerP2pkXpub: template.sellerP2pkXpub, bidderDerivationPath: template.bidderDerivationPath,
		bidderPublicKey: template.bidderPublicKey, refundPublicKey: template.refundPublicKey,
		committeePublicKey: template.committeePublicKey, committeeKeysetId: template.committeeKeysetId,
		committeeKeysetVersion: template.committeeKeysetVersion, threshold: template.threshold,
		participants: template.participants, mintSeal: template.mintSeal,
		inputs: template.inputs.map(({ amount, id, secret, C, dleq }) => ({ amount, id, secret, C, dleq: dleq ?? null })),
	}
}

export function demoMaintainerTemplateBundleDigest(value: Pick<DemoMaintainerExactTemplateBundle, 'preparedAt' | 'winner' | 'refund'>): string {
	return hash({
		schema: 'COCO_DEMO_MAINTAINER_TEMPLATE_BUNDLE_V1',
		preparedAt: value.preparedAt,
		shared: sharedTemplateFacts(value.winner),
		winnerTemplateDigest: value.winner.templateDigest,
		refundTemplateDigest: value.refund.templateDigest,
	})
}

function validateBundle(
	value: DemoMaintainerExactTemplateBundle,
	nowSeconds: number,
	requireUnexpiredAdmission = false,
): DemoMaintainerExactTemplateBundle {
	let bundle: DemoMaintainerExactTemplateBundle
	try { bundle = structuredClone(value) }
	catch { return refuse('DEMO_MAINTAINER_BUNDLE', 'bundle must be cloneable') }
	exactKeys(bundle, ['schema', 'preparedAt', 'winner', 'refund', 'bundleDigest', 'actorBundleSignature', 'bidderBundleSignature'], 'DEMO_MAINTAINER_BUNDLE')
	if (bundle.schema !== 'COCO_DEMO_MAINTAINER_TEMPLATE_BUNDLE_V1'
		|| !Number.isSafeInteger(bundle.preparedAt) || bundle.preparedAt < 1 || bundle.preparedAt > nowSeconds) {
		refuse('DEMO_MAINTAINER_BUNDLE', 'bundle schema or preparation time is invalid')
	}
	const winner = validateTemplate(bundle.winner, 'winner_settlement')
	const refund = validateTemplate(bundle.refund, 'refund')
	if (JSON.stringify(sharedTemplateFacts(winner)) !== JSON.stringify(sharedTemplateFacts(refund))) {
		refuse('DEMO_MAINTAINER_BUNDLE_CONFLICT', 'winner and refund templates do not share the exact bid inputs and policy')
	}
	if (demoOutputsDigest(winner.outputs) === demoOutputsDigest(refund.outputs) || winner.templateDigest === refund.templateDigest) {
		refuse('DEMO_MAINTAINER_BUNDLE_CONFLICT', 'winner and refund branches must be distinct exact templates')
	}
	if (bundle.preparedAt > winner.validUntil) refuse('DEMO_MAINTAINER_BUNDLE_EXPIRED', 'templates were not prepared before bid validity ended')
	if (requireUnexpiredAdmission && nowSeconds > winner.validUntil) {
		refuse('DEMO_MAINTAINER_BUNDLE_EXPIRED', 'bid validity ended before durable template admission')
	}
	const bundleDigest = demoMaintainerTemplateBundleDigest({ preparedAt: bundle.preparedAt, winner, refund })
	if (bundle.bundleDigest !== bundleDigest
		|| !verify(bundle.actorBundleSignature, bundleDigest, winner.bidderActorId)
		|| !verify(bundle.bidderBundleSignature, bundleDigest, winner.bidderPublicKey)) {
		refuse('DEMO_MAINTAINER_BUNDLE_SIGNATURE', 'actor and bidder did not approve both exact branches before admission')
	}
	return { ...bundle, winner, refund }
}

function scopeFor(template: DemoMaintainerExactBranchTemplate): string {
	return hash({
		schema: 'COCO_DEMO_MAINTAINER_SCOPE_V1',
		network: template.network,
		chainId: template.chainId,
		auctionId: template.auctionId,
		operationId: template.operationId,
	})
}

function validateAdmission(bundle: DemoMaintainerExactTemplateBundle, admission: DemoMaintainerAdmissionReceipt): void {
	if (typeof admission !== 'object' || admission === null) refuse('DEMO_MAINTAINER_ADMISSION', 'durable admission receipt is missing')
	exactKeys(admission, ['schema', 'bundleDigest', 'admittedAt', 'notAfter'], 'DEMO_MAINTAINER_ADMISSION')
	const notAfter = Math.min(bundle.winner.validUntil, bundle.winner.closeTime)
	if (admission.schema !== 'COCO_DEMO_MAINTAINER_ADMISSION_RECEIPT_V1'
		|| admission.bundleDigest !== bundle.bundleDigest || admission.notAfter !== notAfter
		|| !Number.isSafeInteger(admission.admittedAt) || admission.admittedAt < bundle.preparedAt
		|| admission.admittedAt > notAfter) {
		refuse('DEMO_MAINTAINER_ADMISSION', 'bundle was not atomically admitted before its signed deadline')
	}
}

export async function persistDemoMaintainerTemplatesBeforeAdmission(options: {
	bundle: DemoMaintainerExactTemplateBundle
	store: DemoMaintainerOfflineStore
	nowSeconds?: () => number
}): Promise<DemoMaintainerOfflineIdentity> {
	const bundle = validateBundle(
		options.bundle,
		(options.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))(),
		true,
	)
	const scope = scopeFor(bundle.winner)
	const notAfter = Math.min(bundle.winner.validUntil, bundle.winner.closeTime)
	const record = await options.store.persistPrepared(scope, structuredClone(bundle), { notAfter })
	validateAdmission(bundle, record.admission)
	if (JSON.stringify(record.bundle) !== JSON.stringify(bundle)) refuse('DEMO_MAINTAINER_ADMISSION', 'store persisted different template bytes')
	return { scope, bundleDigest: bundle.bundleDigest }
}

function validateOutcome(bundle: DemoMaintainerExactTemplateBundle, value: DemoMaintainerFinalOutcome): DemoMaintainerOutcomeSelection {
	let outcome: DemoMaintainerFinalOutcome
	try { outcome = structuredClone(value) }
	catch { return refuse('DEMO_MAINTAINER_OUTCOME', 'outcome must be cloneable') }
	exactKeys(outcome, [
		'schema', 'network', 'chainId', 'auctionId', 'operationId', 'bidId', 'bidEventId',
		'bidderActorId', 'role', 'amount', 'outcomeHeight', 'appStateHash', 'policyPackageDigest',
		'closureEvidenceDigest', 'signedBidEvidenceDigest', 'committeeLockedProofsDigest',
	], 'DEMO_MAINTAINER_OUTCOME')
	const template = outcome.role === 'winner_settlement' ? bundle.winner : outcome.role === 'refund' ? bundle.refund : undefined
	if (template === undefined || outcome.schema !== 'COCO_DEMO_MAINTAINER_FINAL_OUTCOME_V1'
		|| outcome.network !== template.network || outcome.chainId !== template.chainId
		|| outcome.auctionId !== template.auctionId || outcome.operationId !== template.operationId
		|| outcome.bidId !== template.bidId || outcome.bidEventId !== template.bidEventId
		|| outcome.bidderActorId !== template.bidderActorId || outcome.amount !== template.amount
		|| !Number.isSafeInteger(outcome.outcomeHeight) || outcome.outcomeHeight < 1 || !HEX_32.test(outcome.appStateHash)
		|| [outcome.policyPackageDigest, outcome.closureEvidenceDigest, outcome.signedBidEvidenceDigest, outcome.committeeLockedProofsDigest].some((digest) => !HEX_32.test(digest))) {
		refuse('DEMO_MAINTAINER_OUTCOME', 'final outcome differs from the exact admitted bid/template')
	}
	const selectionRoot = hash({
		schema: outcome.schema,
		bundleDigest: bundle.bundleDigest,
		templateDigest: template.templateDigest,
		outcome,
	})
	return { schema: 'COCO_DEMO_MAINTAINER_OUTCOME_SELECTION_V1', selectionRoot, templateDigest: template.templateDigest, outcome }
}

function canonicalExpectedDisposition(value: DemoMaintainerExpectedDisposition): DemoMaintainerExpectedDisposition {
	let expected: DemoMaintainerExpectedDisposition
	try { expected = structuredClone(value) }
	catch { return refuse('DEMO_MAINTAINER_EXPECTED_DISPOSITION', 'expected disposition must be cloneable') }
	exactKeys(expected, [
		'schema', 'network', 'chainId', 'auctionId', 'operationId', 'bidId', 'bidEventId',
		'bidderActorId', 'role', 'amount', 'outcomeHeight', 'appStateHash', 'closureEvidenceDigest',
	], 'DEMO_MAINTAINER_EXPECTED_DISPOSITION')
	if (expected.schema !== 'COCO_DEMO_MAINTAINER_EXPECTED_DISPOSITION_V1'
		|| (expected.role !== 'winner_settlement' && expected.role !== 'refund')
		|| !Number.isSafeInteger(expected.amount) || expected.amount < 1
		|| !Number.isSafeInteger(expected.outcomeHeight) || expected.outcomeHeight < 1
		|| !HEX_32.test(expected.bidEventId) || !HEX_32.test(expected.bidderActorId)
		|| !HEX_32.test(expected.appStateHash) || !HEX_32.test(expected.closureEvidenceDigest)
		|| [expected.network, expected.chainId, expected.auctionId, expected.operationId, expected.bidId]
			.some((field) => typeof field !== 'string' || field.length === 0 || field.trim() !== field)) {
		refuse('DEMO_MAINTAINER_EXPECTED_DISPOSITION', 'expected canonical disposition is invalid')
	}
	return expected
}

function assertExpectedSelection(record: DemoMaintainerOfflineRecord, expected: DemoMaintainerExpectedDisposition): void {
	const selected = record.selection?.outcome
	if (selected === undefined
		|| selected.network !== expected.network || selected.chainId !== expected.chainId
		|| selected.auctionId !== expected.auctionId || selected.operationId !== expected.operationId
		|| selected.bidId !== expected.bidId || selected.bidEventId !== expected.bidEventId
		|| selected.bidderActorId !== expected.bidderActorId || selected.role !== expected.role
		|| selected.amount !== expected.amount || selected.outcomeHeight !== expected.outcomeHeight
		|| selected.appStateHash !== expected.appStateHash
		|| selected.closureEvidenceDigest !== expected.closureEvidenceDigest) {
		refuse('DEMO_MAINTAINER_EXPECTED_DISPOSITION_MISMATCH', 'durable outcome selection differs from the canonical coordinator handoff')
	}
}

function branchFor(record: DemoMaintainerOfflineRecord): DemoMaintainerExactBranchTemplate {
	const selection = record.selection
	if (selection === undefined) refuse('DEMO_MAINTAINER_OUTCOME', 'durable outcome selection is missing')
	const branch = selection.outcome.role === 'winner_settlement' ? record.bundle.winner : record.bundle.refund
	if (selection.templateDigest !== branch.templateDigest) refuse('DEMO_MAINTAINER_OUTCOME_CONFLICT', 'durable selection changed the exact branch')
	return branch
}

export function demoMaintainerFederationSessionId(selectionRoot: string, attemptNumber: number): string {
	if (!HEX_32.test(selectionRoot) || !Number.isSafeInteger(attemptNumber) || attemptNumber < 1) {
		refuse('DEMO_MAINTAINER_FEDERATION_ATTEMPT', 'session derivation requires a selection root and positive attempt number')
	}
	return hash({ schema: 'COCO_DEMO_MAINTAINER_SESSION_V2', selectionRoot, attemptNumber })
}

function validateFederationAttempts(record: DemoMaintainerOfflineRecord): void {
	const attempts = record.federationAttempts ?? []
	if (!Array.isArray(attempts)) refuse('DEMO_MAINTAINER_FEDERATION_ATTEMPT', 'durable attempt journal is malformed')
	for (const [index, attempt] of attempts.entries()) {
		exactKeys(attempt, attempt.excludeParticipantId === undefined
			? ['schema', 'attemptNumber', 'sessionId']
			: ['schema', 'attemptNumber', 'sessionId', 'excludeParticipantId'], 'DEMO_MAINTAINER_FEDERATION_ATTEMPT')
		if (attempt.schema !== 'COCO_DEMO_MAINTAINER_FEDERATION_ATTEMPT_V1'
			|| attempt.attemptNumber !== index + 1
			|| attempt.sessionId !== demoMaintainerFederationSessionId(record.selection!.selectionRoot, attempt.attemptNumber)
			|| (attempt.excludeParticipantId !== undefined && !PARTICIPANT_IDS.includes(attempt.excludeParticipantId))) {
			refuse('DEMO_MAINTAINER_FEDERATION_ATTEMPT', 'durable attempt journal reused or changed a signing session')
		}
	}
	if (new Set(attempts.map(({ sessionId }) => sessionId)).size !== attempts.length) {
		refuse('DEMO_MAINTAINER_FEDERATION_ATTEMPT', 'durable attempt journal reused a session')
	}
}

function validateAuthorization(
	branch: DemoMaintainerExactBranchTemplate,
	request: DemoMaintainerFederationRequest,
	authorization: DemoMaintainerFederationAuthorization,
): void {
	if (authorization.schema !== 'COCO_DEMO_MAINTAINER_FEDERATION_AUTHORIZATION_V1' || authorization.threshold !== 3
		|| authorization.sessionId !== request.sessionId || authorization.packageDigest !== request.packageDigest
		|| authorization.cashuSigAllDigest !== request.cashuSigAllDigest
		|| authorization.committeeKeysetId !== request.committeeKeysetId
		|| authorization.committeeKeysetVersion !== request.committeeKeysetVersion
		|| authorization.participantIds.length !== 3 || new Set(authorization.participantIds).size !== 3
		|| authorization.participantIds.some((id) => !PARTICIPANT_IDS.includes(id))
		|| !HEX_32.test(authorization.transcriptHash)
		|| !verify(authorization.signature, request.cashuSigAllDigest, branch.committeePublicKey)) {
		refuse('DEMO_MAINTAINER_AUTHORIZATION', 'federation authorization differs from the exact selected template')
	}
}

function federationRequest(record: DemoMaintainerOfflineRecord, sessionId: string): DemoMaintainerFederationRequest {
	const selection = record.selection!
	const branch = branchFor(record)
	return {
		schema: 'COCO_DEMO_FROST_REQUEST_V1',
		threshold: 3,
		sessionId,
		packageDigest: branch.templateDigest,
		cashuSigAllDigest: branch.cashuSigAllDigest,
		committeePublicKey: branch.committeePublicKey,
		committeeKeysetId: branch.committeeKeysetId,
		committeeKeysetVersion: branch.committeeKeysetVersion,
		participants: branch.participants.map(({ identifier, verifyingShare }) => ({ identifier, verifyingShare })),
		policyPackageDigest: selection.outcome.policyPackageDigest,
		closureEvidenceDigest: selection.outcome.closureEvidenceDigest,
		signedBidEvidenceDigest: selection.outcome.signedBidEvidenceDigest,
		committeeLockedProofsDigest: selection.outcome.committeeLockedProofsDigest,
	}
}

function proofStateRefs(branch: DemoMaintainerExactBranchTemplate): string[] {
	try { return branch.inputs.map((input) => bytesToHex(proofPoint(input).toBytes(true))) }
	catch { return refuse('DEMO_MAINTAINER_TEMPLATE_INPUT', 'input cannot produce its exact proof state reference') }
}

function durableRequest(record: DemoMaintainerOfflineRecord): DemoSigAllDurableRequest {
	const branch = branchFor(record)
	let witness: string
	if (record.authorization !== undefined) {
		witness = JSON.stringify({ signatures: [branch.bidderMainSignature, record.authorization.signature] })
	} else if (branch.role === 'refund' && branch.refundSignature !== undefined) {
		witness = JSON.stringify({ signatures: [branch.refundSignature] })
	} else refuse('DEMO_MAINTAINER_AUTHORIZATION', 'selected MAIN branch lacks a durable federation authorization')
	const request: DemoSigAllSwapRequest = {
		schema: 'COCO_DEMO_SIGALL_SWAP_V1',
		mintUrl: branch.mintUrl,
		operationId: branch.operationId,
		locktime: branch.locktime,
		packageDigest: branch.templateDigest,
		cashuSigAllDigest: branch.cashuSigAllDigest,
		recipientCapabilityDigest: demoRecipientCapabilityDigest(branch.recipientCapability),
		mintSeal: structuredClone(branch.mintSeal),
		inputs: branch.inputs.map((input, index) => ({ ...input, dleq: input.dleq === undefined ? undefined : { ...input.dleq }, witness: index === 0 ? witness : undefined })),
		outputs: branch.outputs.map((output) => ({ ...output })),
	}
	return { scope: scopeFor(branch), operationRoot: branch.templateDigest, request, proofStateRefs: proofStateRefs(branch) }
}

function recipientResponse(branch: DemoMaintainerExactBranchTemplate, signatures: BlindedSignature[]) {
	return {
		selectionRoot: '',
		templateDigest: branch.templateDigest,
		role: branch.role,
		operationId: branch.operationId,
		recipientCapabilityDigest: demoRecipientCapabilityDigest(branch.recipientCapability),
		signatures: signatures.map((signature) => ({ ...signature, dleq: signature.dleq === undefined ? undefined : { ...signature.dleq } })),
	}
}

export function createDemoMaintainerOfflineExecutor(options: {
	store: DemoMaintainerOfflineStore
	outcomes: DemoMaintainerFinalOutcomePort
	federation: DemoMaintainerFederationPort
	recoveryStore: DemoSigAllRecoveryStore
	mint: DemoSigAllMintPort
	recovery: DemoSigAllRecoveryMintStatePort
	terminalResponse: DemoSigAllTerminalResponsePort
	recipient: DemoMaintainerRecipientDeliveryPort
	now?: () => number
	nowSeconds?: () => number
}) {
	const store: DemoMaintainerOfflineStore = Object.freeze({
		persistPrepared: options.store.persistPrepared.bind(options.store),
		loadExact: options.store.loadExact.bind(options.store),
		bindOutcome: options.store.bindOutcome.bind(options.store),
		reserveFederationAttempt: options.store.reserveFederationAttempt.bind(options.store),
		saveAuthorization: options.store.saveAuthorization.bind(options.store),
	})
	const readOutcome = options.outcomes.readExact.bind(options.outcomes)
	const authorize = options.federation.authorize.bind(options.federation)
	const recoveryStore: DemoSigAllRecoveryStore = Object.freeze({
		createOrGet: options.recoveryStore.createOrGet.bind(options.recoveryStore),
		read: options.recoveryStore.read.bind(options.recoveryStore),
		compareAndSwap: options.recoveryStore.compareAndSwap.bind(options.recoveryStore),
	})
	const mint: DemoSigAllMintPort = Object.freeze({ swapExact: options.mint.swapExact.bind(options.mint) })
	const recovery: DemoSigAllRecoveryMintStatePort = Object.freeze({ reconcileExact: options.recovery.reconcileExact.bind(options.recovery) })
	const terminalResponse: DemoSigAllTerminalResponsePort = Object.freeze({ restoreCompleted: options.terminalResponse.restoreCompleted.bind(options.terminalResponse) })
	const deliverExact = options.recipient.deliverExact.bind(options.recipient)
	const now = options.now ?? Date.now
	const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000))

	async function load(identity: DemoMaintainerOfflineIdentity): Promise<DemoMaintainerOfflineRecord> {
		if (typeof identity.scope !== 'string' || identity.scope.length === 0 || !HEX_32.test(identity.bundleDigest)) {
			refuse('DEMO_MAINTAINER_IDENTITY', 'offline executor identity is invalid')
		}
		const record = await store.loadExact(identity.scope, identity.bundleDigest)
		if (record === null) refuse('DEMO_MAINTAINER_OFFLINE_MISSING', 'executor-private exact templates are unavailable')
		const bundle = validateBundle(record.bundle, Number.MAX_SAFE_INTEGER)
		if (scopeFor(bundle.winner) !== identity.scope || bundle.bundleDigest !== identity.bundleDigest) refuse('DEMO_MAINTAINER_IDENTITY', 'stored bundle differs from requested identity')
		validateAdmission(bundle, record.admission)
		const exact: DemoMaintainerOfflineRecord = {
			bundle,
			admission: structuredClone(record.admission),
			selection: record.selection === undefined ? undefined : structuredClone(record.selection),
			authorization: record.authorization === undefined ? undefined : structuredClone(record.authorization),
			federationAttempts: record.federationAttempts === undefined ? undefined : structuredClone(record.federationAttempts),
		}
		if (exact.selection !== undefined) {
			const derived = validateOutcome(bundle, exact.selection.outcome)
			if (JSON.stringify(derived) !== JSON.stringify(exact.selection)) refuse('DEMO_MAINTAINER_OUTCOME_CONFLICT', 'stored outcome selection is not canonical')
			validateFederationAttempts(exact)
		} else if ((exact.federationAttempts?.length ?? 0) > 0) refuse('DEMO_MAINTAINER_FEDERATION_ATTEMPT', 'attempt journal exists without a durable selection')
		if (exact.authorization !== undefined) {
			if (exact.selection === undefined) refuse('DEMO_MAINTAINER_AUTHORIZATION', 'authorization exists without a durable outcome selection')
			const attempt = exact.federationAttempts?.find(({ sessionId }) => sessionId === exact.authorization!.sessionId)
			if (attempt === undefined) refuse('DEMO_MAINTAINER_AUTHORIZATION', 'authorization does not belong to a durably reserved fresh session')
			const request = federationRequest(exact, attempt.sessionId)
			validateAuthorization(branchFor(exact), request, exact.authorization)
		}
		return exact
	}

	async function selected(identity: DemoMaintainerOfflineIdentity, expected: DemoMaintainerExpectedDisposition): Promise<DemoMaintainerOfflineRecord> {
		let record = await load(identity)
		if (record.selection !== undefined) {
			assertExpectedSelection(record, expected)
			return record
		}
		const outcome = await readOutcome(structuredClone(identity))
		if (outcome === null) refuse('DEMO_MAINTAINER_OUTCOME', 'canonical finalized outcome is unavailable')
		const selection = validateOutcome(record.bundle, outcome)
		assertExpectedSelection({ ...record, selection }, expected)
		record = await store.bindOutcome(identity.scope, identity.bundleDigest, selection)
		if (record.selection?.selectionRoot !== selection.selectionRoot) refuse('DEMO_MAINTAINER_OUTCOME_CONFLICT', 'another process selected a different outcome')
		assertExpectedSelection(record, expected)
		return record
	}

	async function ensureMainAuthorization(identity: DemoMaintainerOfflineIdentity, record: DemoMaintainerOfflineRecord): Promise<DemoMaintainerOfflineRecord> {
		if (record.authorization !== undefined) return record
		async function reserve(excludeParticipantId?: 1 | 2 | 3 | 4) {
			const attempt = await store.reserveFederationAttempt(
				identity.scope,
				identity.bundleDigest,
				record.selection!.selectionRoot,
				excludeParticipantId,
			)
			exactKeys(attempt, excludeParticipantId === undefined
				? ['schema', 'attemptNumber', 'sessionId']
				: ['schema', 'attemptNumber', 'sessionId', 'excludeParticipantId'], 'DEMO_MAINTAINER_FEDERATION_ATTEMPT')
			if (attempt.schema !== 'COCO_DEMO_MAINTAINER_FEDERATION_ATTEMPT_V1'
				|| attempt.excludeParticipantId !== excludeParticipantId
				|| attempt.sessionId !== demoMaintainerFederationSessionId(record.selection!.selectionRoot, attempt.attemptNumber)) {
				refuse('DEMO_MAINTAINER_FEDERATION_ATTEMPT', 'store did not reserve the requested fresh session')
			}
			const refreshed = await load(identity)
			if (!refreshed.federationAttempts?.some((held) => JSON.stringify(held) === JSON.stringify(attempt))) {
				refuse('DEMO_MAINTAINER_FEDERATION_ATTEMPT', 'fresh session reservation was not durable')
			}
			record = refreshed
			return attempt
		}
		const priorExcluded = [...(record.federationAttempts ?? [])].reverse()
			.find(({ excludeParticipantId }) => excludeParticipantId !== undefined)?.excludeParticipantId
		let attempt = await reserve(priorExcluded)
		let request = federationRequest(record, attempt.sessionId)
		let authorization: DemoMaintainerFederationAuthorization
		try {
			authorization = await authorize(structuredClone(request), { excludeParticipantId: priorExcluded })
		} catch (error) {
			if (!(error instanceof DemoMaintainerFederationRefusedError)
				|| error.code !== 'DEMO_MAINTAINER_FRESH_SESSION_REQUIRED'
				|| error.failedParticipantIds.length === 0) throw error
			let lastError: unknown = error
			let completed: DemoMaintainerFederationAuthorization | undefined
			for (const failed of [...new Set(error.failedParticipantIds)]) {
				if (failed === priorExcluded) continue
				attempt = await reserve(failed)
				request = federationRequest(record, attempt.sessionId)
				try {
					completed = await authorize(structuredClone(request), { excludeParticipantId: failed })
					break
				} catch (retryError) {
					lastError = retryError
					if (!(retryError instanceof DemoMaintainerFederationRefusedError)
						|| retryError.code !== 'DEMO_MAINTAINER_FRESH_SESSION_REQUIRED') throw retryError
				}
			}
			if (completed === undefined) throw lastError
			authorization = completed
		}
		validateAuthorization(branchFor(record), request, authorization)
		await store.saveAuthorization(identity.scope, identity.bundleDigest, record.selection!.selectionRoot, structuredClone(authorization))
		const saved = await load(identity)
		if (saved.authorization === undefined) refuse('DEMO_MAINTAINER_AUTHORIZATION', 'durable federation authorization was not saved')
		validateAuthorization(branchFor(saved), request, saved.authorization)
		return saved
	}

	async function deliver(record: DemoMaintainerOfflineRecord, signatures: BlindedSignature[], source: DemoMaintainerOfflineSuccess['deliverySource'], terminal: DemoSigAllTerminalMetadata): Promise<DemoMaintainerOfflineSuccess> {
		const branch = branchFor(record)
		const request = recipientResponse(branch, signatures)
		request.selectionRoot = record.selection!.selectionRoot
		const recipient = await deliverExact(request)
		return { status: branch.role === 'winner_settlement' ? 'settled' : 'refunded', deliverySource: source, selectionRoot: record.selection!.selectionRoot, terminal, recipient }
	}

	return Object.freeze({
		async executeExact(identityValue: DemoMaintainerOfflineIdentity, expectedValue: DemoMaintainerExpectedDisposition): Promise<DemoMaintainerOfflineExecutionResult> {
			const identity = structuredClone(identityValue)
			const expected = canonicalExpectedDisposition(expectedValue)
			let record = await selected(identity, expected)
			const branch = branchFor(record)
			const terminal = await readDemoSigAllTerminal({ store: recoveryStore, scope: scopeFor(branch), operationRoot: branch.templateDigest })
			if (terminal !== null) {
				const restored = await restoreDemoSigAllTerminalByIdentity({
					store: recoveryStore,
					recovery: terminalResponse,
					scope: scopeFor(branch),
					operationRoot: branch.templateDigest,
				})
				return deliver(record, restored.signatures, 'terminal_restore', restored.terminal)
			}
			const seconds = nowSeconds()
			let refundPath = false
			if (branch.role === 'winner_settlement') {
				// A retained exact MAIN authorization remains a valid competing spend after locktime. FROST
				// does not revoke it; the mint's atomic first-spend still decides MAIN versus REFUND.
				if (record.authorization === undefined) {
					if (seconds >= demoSigAllSettlementCutoff(branch.locktime)) refuse('DEMO_MAINTAINER_CUTOFF', 'new MAIN authorization is closed')
					record = await ensureMainAuthorization(identity, record)
				}
			} else {
				// R16's unresolved early-return option is deliberately omitted. A loser REFUND is the
				// bidder-key post-locktime branch only and never reuses committee MAIN authorization.
				if (seconds < branch.locktime) return {
					status: 'deferred',
					reason: 'refund_not_yet_eligible',
					selectionRoot: record.selection!.selectionRoot,
					eligibleAt: branch.locktime,
				}
				refundPath = true
			}
			const value = durableRequest(refundPath ? { ...record, authorization: undefined } : record)
			const result = refundPath
				? await submitDemoSigAllRefundSwap({ store: recoveryStore, mint, value, now, nowSeconds })
				: await submitDemoSigAllSwap({ store: recoveryStore, mint, value, now, nowSeconds })
			if (result.status === 'submitted') return deliver(record, result.signatures, 'mint_response', result.terminal)
			const signatures = await restoreDemoSigAllTerminalResponse({ store: recoveryStore, recovery: terminalResponse, value, now })
			return deliver(record, signatures, 'terminal_restore', result.terminal)
		},

		async recoverExact(identityValue: DemoMaintainerOfflineIdentity, expectedValue: DemoMaintainerExpectedDisposition): Promise<DemoMaintainerOfflineRecoveryResult> {
			const identity = structuredClone(identityValue)
			const expected = canonicalExpectedDisposition(expectedValue)
			const record = await selected(identity, expected)
			const branch = branchFor(record)
			const refundPath = record.authorization === undefined && branch.role === 'refund' && nowSeconds() >= branch.locktime
			if (!refundPath && record.authorization === undefined) refuse('DEMO_MAINTAINER_AUTHORIZATION', 'no pre-cutoff durable MAIN authorization exists to recover')
			const value = durableRequest(refundPath ? { ...record, authorization: undefined } : record)
			const result = await reconcileDemoSigAllSwapV2({ store: recoveryStore, recovery, value, now })
			if (result.status === 'recovered') return deliver(record, result.signatures, 'exact_recovery', result.terminal)
			if (result.status === 'terminal_replay') {
				const signatures = await restoreDemoSigAllTerminalResponse({ store: recoveryStore, recovery: terminalResponse, value, now })
				return deliver(record, signatures, 'terminal_restore', result.terminal)
			}
			return result
		},
	})
}
