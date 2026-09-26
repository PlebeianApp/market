import { sha256 } from '@noble/hashes/sha2.js'
import { allocateMultipartySats } from './multipartyAllocator'
import {
	AUCTION_MULTIPARTY_MAX_MINT_BYTES,
	AUCTION_MULTIPARTY_MAX_MINTS,
	type MultipartyAuthorizationSnapshotBinding,
	type MultipartyAuthorizationSnapshotRelations,
} from './multipartyAuthorization'
import { assertValidatedMultipartyBidLegContext, type ValidatedMultipartyBidLegContext } from './multipartyBidLegContext'
import {
	AUCTION_MULTIPARTY_SETTLEMENT_POLICY,
	parseCanonicalSchedule,
	type AuctionMultipartyCanonicalSchedule,
	type AuctionMultipartyScheduleRole,
	validateScheduleCommitment,
} from './multipartySchedule'

const LOWER_HEX_64 = /^[0-9a-f]{64}$/
const COMPRESSED_PUBKEY = /^(02|03)[0-9a-f]{64}$/
const utf8 = new TextEncoder()
const ZERO_SATS = BigInt(0)

export class AuctionMultipartyManifestError extends Error {
	readonly code: string

	constructor(code: string) {
		super(code)
		this.name = 'AuctionMultipartyManifestError'
		this.code = code
	}
}

const fail = (code: string): never => {
	throw new AuctionMultipartyManifestError(code)
}

export interface MultipartyManifestLegConstructionInput {
	readonly child_pubkey: string | null
	readonly lock_secrets: readonly string[]
	readonly proof_ys: readonly string[]
	/**
	 * Exact serialized Cashu token retained by the bidder for later release.
	 * D1 stores only SHA256(UTF8(token)), never the bearer token itself.
	 */
	readonly cashu_token: string | null
}

export interface MultipartyManifestAuxiliaryConstructionInput extends MultipartyManifestLegConstructionInput {
	readonly schedule_index: number
}

export interface MultipartyManifestPreviousBid {
	readonly event_id: string
	readonly gross_sats: bigint
}

export interface BuildMultipartyManifestProjectionInput {
	readonly schedule: AuctionMultipartyCanonicalSchedule
	readonly relations: MultipartyAuthorizationSnapshotRelations
	readonly bid_leg_context: ValidatedMultipartyBidLegContext
	readonly selected_mint: string
	/** Compatibility-only mirror. The validated bid-leg context is authoritative. */
	readonly gross_sats: bigint
	/** Compatibility-only mirror. The validated bid-leg context is authoritative. */
	readonly previous_bid: MultipartyManifestPreviousBid | null
	readonly locktime: number
	readonly refund_pubkey: string
	readonly seller: MultipartyManifestLegConstructionInput
	readonly auxiliary: readonly MultipartyManifestAuxiliaryConstructionInput[]
}

export interface MultipartyManifestProjectedPayout {
	readonly schedule_index: number | null
	readonly role: 'seller' | AuctionMultipartyScheduleRole
	readonly recipient_pubkey: string | null
	readonly payout_capability_event_id: string | null
	readonly validator_offer_event_id: string | null
	readonly validator_acceptance_event_id: string | null
	readonly amount_sats: bigint
	readonly child_pubkey: string | null
	readonly lock_secrets: readonly string[]
	readonly proof_ys: readonly string[]
	readonly cashu_token_sha256: string | null
}

const MULTIPARTY_MANIFEST_PROJECTION: unique symbol = Symbol('auction-multiparty-manifest-projection')

const manifestProjections = new WeakSet<object>()

export interface MultipartyManifestProjection {
	readonly [MULTIPARTY_MANIFEST_PROJECTION]: true
	readonly status: 'manifest_projected'
	readonly root_event_id: string
	readonly activation_event_id: string
	readonly payout_schedule_commitment: string
	readonly selected_mint: string
	readonly gross_sats: bigint
	readonly principal_sats: bigint
	readonly previous_bid_event_id: string | null
	readonly locktime: number
	readonly refund_pubkey: string
	readonly payouts: readonly MultipartyManifestProjectedPayout[]
}

export const isMultipartyManifestProjection = (value: unknown): value is MultipartyManifestProjection =>
	typeof value === 'object' && value !== null && manifestProjections.has(value)

const hex = (bytes: Uint8Array): string =>
	Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')

const assertCanonicalId = (value: unknown, code: string): string =>
	typeof value === 'string' && LOWER_HEX_64.test(value) ? value : fail(code)

const isRecord = (value: unknown): value is Record<string, unknown> => {
	try {
		return typeof value === 'object' && value !== null && !Array.isArray(value)
	} catch {
		return false
	}
}

const readProperty = (record: Record<string, unknown>, property: string, code: string): unknown => {
	try {
		return record[property]
	} catch {
		return fail(code)
	}
}

const snapshotArray = (
	value: unknown,
	invalidCode: string,
	options: {
		readonly exactLength?: number
		readonly exactLengthCode?: string
		readonly maximumLength?: number
		readonly maximumLengthCode?: string
	} = {},
): unknown[] => {
	let array: unknown[]
	let length: unknown

	try {
		array = Array.isArray(value) ? value : fail(invalidCode)
		length = array.length
	} catch {
		return fail(invalidCode)
	}

	if (!Number.isSafeInteger(length) || (length as number) < 0) {
		fail(invalidCode)
	}

	const ownedLength = length as number

	if (options.exactLength !== undefined && ownedLength !== options.exactLength) {
		fail(options.exactLengthCode ?? invalidCode)
	}

	if (options.maximumLength !== undefined && ownedLength > options.maximumLength) {
		fail(options.maximumLengthCode ?? invalidCode)
	}

	try {
		const owned = new Array<unknown>(ownedLength)
		for (let index = 0; index < ownedLength; index++) {
			owned[index] = array[index]
		}
		return owned
	} catch {
		return fail(invalidCode)
	}
}

const snapshotCanonicalBytes = (value: unknown): Uint8Array => {
	try {
		return value instanceof Uint8Array ? Uint8Array.prototype.slice.call(value) : fail('manifest_schedule_canonical_bytes_invalid')
	} catch {
		return fail('manifest_schedule_canonical_bytes_invalid')
	}
}

interface OwnedMultipartyAuthorizationSnapshotBinding {
	readonly schedule_index: unknown
	readonly role: unknown
	readonly recipient_pubkey: unknown
	readonly payout_capability_event_id: unknown
	readonly validator_offer_event_id: unknown
	readonly validator_acceptance_event_id: unknown
	readonly allocation_bps: unknown
}

const snapshotBinding = (value: unknown): OwnedMultipartyAuthorizationSnapshotBinding => {
	const record = isRecord(value) ? value : fail('manifest_authorization_binding_invalid')

	return Object.freeze({
		schedule_index: readProperty(record, 'schedule_index', 'manifest_authorization_binding_invalid'),
		role: readProperty(record, 'role', 'manifest_authorization_binding_invalid'),
		recipient_pubkey: readProperty(record, 'recipient_pubkey', 'manifest_authorization_binding_invalid'),
		payout_capability_event_id: readProperty(record, 'payout_capability_event_id', 'manifest_authorization_binding_invalid'),
		validator_offer_event_id: readProperty(record, 'validator_offer_event_id', 'manifest_authorization_binding_invalid'),
		validator_acceptance_event_id: readProperty(record, 'validator_acceptance_event_id', 'manifest_authorization_binding_invalid'),
		allocation_bps: readProperty(record, 'allocation_bps', 'manifest_authorization_binding_invalid'),
	})
}

const assertBindingMatchesSchedule = (
	binding: OwnedMultipartyAuthorizationSnapshotBinding,
	entry: AuctionMultipartyCanonicalSchedule['entries'][number],
): MultipartyAuthorizationSnapshotBinding => {
	if (
		binding.schedule_index !== entry.schedule_index ||
		binding.role !== entry.role ||
		binding.recipient_pubkey !== entry.recipient_pubkey ||
		binding.payout_capability_event_id !== entry.payout_capability_event_id ||
		binding.allocation_bps !== entry.allocation_bps ||
		binding.validator_offer_event_id !== entry.validator_offer_event_id
	) {
		fail('manifest_authorization_binding_mismatch')
	}

	if (entry.role === 'validator') {
		assertCanonicalId(binding.validator_acceptance_event_id, 'manifest_validator_acceptance_missing')
	} else if (binding.validator_acceptance_event_id !== undefined) {
		fail('manifest_v4v_acceptance_forbidden')
	}

	return binding as unknown as MultipartyAuthorizationSnapshotBinding
}

const snapshotConstructionRecord = (record: Record<string, unknown>): MultipartyManifestLegConstructionInput => {
	const childPubkey = readProperty(record, 'child_pubkey', 'manifest_construction_observation_invalid')
	const lockSecrets = readProperty(record, 'lock_secrets', 'manifest_construction_observation_invalid')
	const proofYs = readProperty(record, 'proof_ys', 'manifest_construction_observation_invalid')
	const cashuToken = readProperty(record, 'cashu_token', 'manifest_construction_observation_invalid')

	return Object.freeze({
		child_pubkey: childPubkey as string | null,
		lock_secrets: Object.freeze(snapshotArray(lockSecrets, 'manifest_proof_arrays_invalid') as string[]),
		proof_ys: Object.freeze(snapshotArray(proofYs, 'manifest_proof_arrays_invalid') as string[]),
		cashu_token: cashuToken as string | null,
	})
}

const snapshotSellerConstruction = (value: unknown): MultipartyManifestLegConstructionInput => {
	const record = isRecord(value) ? value : fail('manifest_seller_construction_invalid')
	return snapshotConstructionRecord(record)
}

const snapshotAuxiliaryConstruction = (value: unknown): MultipartyManifestAuxiliaryConstructionInput => {
	const record = isRecord(value) ? value : fail('manifest_auxiliary_construction_invalid')
	const scheduleIndex = readProperty(record, 'schedule_index', 'manifest_auxiliary_construction_invalid')

	return Object.freeze({
		schedule_index: scheduleIndex as number,
		...snapshotConstructionRecord(record),
	})
}

const normalizeConstruction = (
	amountSats: bigint,
	input: MultipartyManifestLegConstructionInput,
	globalProofYs: Set<string>,
	globalSecrets: Set<string>,
	globalChildren: Set<string>,
	globalTokenHashes: Set<string>,
): Pick<MultipartyManifestProjectedPayout, 'child_pubkey' | 'lock_secrets' | 'proof_ys' | 'cashu_token_sha256'> => {
	if (amountSats === ZERO_SATS) {
		if (input.child_pubkey !== null || input.cashu_token !== null || input.lock_secrets.length !== 0 || input.proof_ys.length !== 0) {
			fail('manifest_zero_payout_has_cashu_artifact')
		}

		return Object.freeze({
			child_pubkey: null,
			lock_secrets: Object.freeze([]),
			proof_ys: Object.freeze([]),
			cashu_token_sha256: null,
		})
	}

	const childPubkey =
		typeof input.child_pubkey === 'string' && COMPRESSED_PUBKEY.test(input.child_pubkey)
			? input.child_pubkey
			: fail('manifest_child_pubkey_invalid')

	if (globalChildren.has(childPubkey)) {
		fail('manifest_child_pubkey_reused')
	}
	globalChildren.add(childPubkey)

	if (input.lock_secrets.length === 0 || input.lock_secrets.length !== input.proof_ys.length) {
		fail('manifest_proof_count_invalid')
	}

	const secrets: string[] = []
	const proofYs: string[] = []

	for (let index = 0; index < input.lock_secrets.length; index++) {
		const secret = input.lock_secrets[index]
		const proofY = input.proof_ys[index]

		if (typeof secret !== 'string' || secret.length === 0) {
			fail('manifest_lock_secret_invalid')
		}

		if (typeof proofY !== 'string' || !COMPRESSED_PUBKEY.test(proofY)) {
			fail('manifest_proof_y_invalid')
		}

		if (globalSecrets.has(secret)) {
			fail('manifest_lock_secret_reused')
		}
		if (globalProofYs.has(proofY)) {
			fail('manifest_proof_y_reused')
		}

		globalSecrets.add(secret)
		globalProofYs.add(proofY)
		secrets.push(secret)
		proofYs.push(proofY)
	}

	const cashuToken =
		typeof input.cashu_token === 'string' && input.cashu_token.length > 0 ? input.cashu_token : fail('manifest_cashu_token_invalid')

	const tokenHash = hex(sha256(utf8.encode(cashuToken)))

	if (globalTokenHashes.has(tokenHash)) {
		fail('manifest_cashu_token_reused')
	}
	globalTokenHashes.add(tokenHash)

	return Object.freeze({
		child_pubkey: childPubkey,
		lock_secrets: Object.freeze(secrets),
		proof_ys: Object.freeze(proofYs),
		cashu_token_sha256: tokenHash,
	})
}

export function buildMultipartyManifestProjection(input: BuildMultipartyManifestProjectionInput): MultipartyManifestProjection
export function buildMultipartyManifestProjection(input: unknown): MultipartyManifestProjection {
	// D1 is a pure canonical projection. This provenance is deliberately not
	// authorization, activation clearance, funding readiness, or settlement.
	const data = isRecord(input) ? input : fail('manifest_input_invalid')

	const bidLegContext = readProperty(data, 'bid_leg_context', 'manifest_input_invalid')
	assertValidatedMultipartyBidLegContext(bidLegContext)
	const contextProfile = bidLegContext.profile
	const contextRootEventId = bidLegContext.auctionRootEventId
	const contextCurrentGrossSats = bidLegContext.currentGrossSats
	const contextPredecessorEventId = bidLegContext.predecessorEventId
	const contextPredecessorGrossSats = bidLegContext.predecessorGrossSats
	const contextPrincipalSats = bidLegContext.principalSats

	const scheduleValue = readProperty(data, 'schedule', 'manifest_schedule_container_invalid')
	const scheduleInput = isRecord(scheduleValue) ? scheduleValue : fail('manifest_schedule_container_invalid')
	const callerCanonicalBytes = readProperty(scheduleInput, 'canonical_bytes', 'manifest_schedule_canonical_bytes_invalid')
	const ownedCanonicalBytes = snapshotCanonicalBytes(callerCanonicalBytes)
	const schedule = parseCanonicalSchedule(ownedCanonicalBytes)
	const claimedScheduleCommitment = readProperty(scheduleInput, 'schedule_commitment', 'manifest_schedule_container_invalid')
	const commitment = validateScheduleCommitment(schedule.canonical_bytes, claimedScheduleCommitment as string)

	const relationsValue = readProperty(data, 'relations', 'manifest_relations_container_invalid')
	const relations = isRecord(relationsValue) ? relationsValue : fail('manifest_relations_container_invalid')
	const relationRootEventId = readProperty(relations, 'root_event_id', 'manifest_relations_container_invalid')
	const relationActivationEventId = readProperty(relations, 'activation_event_id', 'manifest_relations_container_invalid')
	const relationScheduleCommitment = readProperty(relations, 'payout_schedule_commitment', 'manifest_relations_container_invalid')
	const relationMintsValue = readProperty(relations, 'mints', 'manifest_mints_container_invalid')
	const relationBindingsValue = readProperty(relations, 'bindings', 'manifest_bindings_container_invalid')
	const rootEventId = assertCanonicalId(relationRootEventId, 'manifest_root_event_id_invalid')
	const activationEventId = assertCanonicalId(relationActivationEventId, 'manifest_activation_event_id_invalid')
	const relationCommitment = assertCanonicalId(relationScheduleCommitment, 'manifest_schedule_commitment_invalid')

	if (relationCommitment !== commitment) {
		fail('manifest_schedule_commitment_mismatch')
	}

	const relationMintValues = snapshotArray(relationMintsValue, 'manifest_mints_container_invalid', {
		maximumLength: AUCTION_MULTIPARTY_MAX_MINTS,
		maximumLengthCode: 'manifest_mint_count_exceeds_limit',
	})
	const relationMints: string[] = []

	for (const mint of relationMintValues) {
		const ownedMint = typeof mint === 'string' ? mint : fail('manifest_mint_invalid')
		if (ownedMint.length > AUCTION_MULTIPARTY_MAX_MINT_BYTES || utf8.encode(ownedMint).length > AUCTION_MULTIPARTY_MAX_MINT_BYTES) {
			fail('manifest_mint_bytes_exceeds_limit')
		}
		relationMints.push(ownedMint)
	}

	const relationBindingValues = snapshotArray(relationBindingsValue, 'manifest_bindings_container_invalid', {
		exactLength: schedule.entries.length,
		exactLengthCode: 'manifest_binding_count_mismatch',
	})
	const bindings: MultipartyAuthorizationSnapshotBinding[] = []
	for (let index = 0; index < schedule.entries.length; index++) {
		bindings.push(assertBindingMatchesSchedule(snapshotBinding(relationBindingValues[index]), schedule.entries[index]))
	}

	if (contextProfile !== AUCTION_MULTIPARTY_SETTLEMENT_POLICY) {
		fail('manifest_bid_leg_profile_mismatch')
	}

	if (contextRootEventId !== rootEventId) {
		fail('manifest_bid_leg_root_mismatch')
	}

	const grossMirror = readProperty(data, 'gross_sats', 'manifest_input_invalid')
	const previousBidMirror = readProperty(data, 'previous_bid', 'manifest_bid_leg_predecessor_mismatch')

	if (grossMirror !== contextCurrentGrossSats) {
		fail('manifest_bid_leg_gross_mismatch')
	}

	if (contextPredecessorEventId === null) {
		if (previousBidMirror !== null || contextPredecessorGrossSats !== null) {
			fail('manifest_bid_leg_predecessor_mismatch')
		}
	} else {
		const previousBidRecord = isRecord(previousBidMirror) ? previousBidMirror : fail('manifest_bid_leg_predecessor_mismatch')
		const previousBidEventId = readProperty(previousBidRecord, 'event_id', 'manifest_bid_leg_predecessor_mismatch')
		const previousBidGrossSats = readProperty(previousBidRecord, 'gross_sats', 'manifest_bid_leg_predecessor_mismatch')

		if (previousBidEventId !== contextPredecessorEventId || previousBidGrossSats !== contextPredecessorGrossSats) {
			fail('manifest_bid_leg_predecessor_mismatch')
		}
	}

	const grossSats = contextCurrentGrossSats
	const principalSats = contextPrincipalSats
	const previousBidEventId = contextPredecessorEventId

	if (principalSats <= ZERO_SATS || principalSats > grossSats) {
		fail('manifest_principal_sats_invalid')
	}

	const sellerValue = readProperty(data, 'seller', 'manifest_seller_construction_invalid')
	const auxiliaryValue = readProperty(data, 'auxiliary', 'manifest_auxiliary_container_invalid')
	const selectedMintValue = readProperty(data, 'selected_mint', 'manifest_selected_mint_not_authorized')
	const locktimeValue = readProperty(data, 'locktime', 'manifest_locktime_invalid')
	const refundPubkeyValue = readProperty(data, 'refund_pubkey', 'manifest_refund_pubkey_invalid')
	const auxiliaryValues = snapshotArray(auxiliaryValue, 'manifest_auxiliary_container_invalid', {
		exactLength: schedule.entries.length,
		exactLengthCode: 'manifest_auxiliary_construction_count_mismatch',
	})
	const seller = snapshotSellerConstruction(sellerValue)
	const auxiliary = auxiliaryValues.map(snapshotAuxiliaryConstruction)

	const selectedMint = typeof selectedMintValue === 'string' ? selectedMintValue : fail('manifest_selected_mint_not_authorized')
	if (!relationMints.includes(selectedMint)) {
		fail('manifest_selected_mint_not_authorized')
	}

	const locktime =
		typeof locktimeValue === 'number' && Number.isSafeInteger(locktimeValue) && locktimeValue > 0
			? locktimeValue
			: fail('manifest_locktime_invalid')

	const refundPubkey =
		typeof refundPubkeyValue === 'string' && COMPRESSED_PUBKEY.test(refundPubkeyValue)
			? refundPubkeyValue
			: fail('manifest_refund_pubkey_invalid')

	const constructionByIndex = new Map<number, MultipartyManifestAuxiliaryConstructionInput>()

	for (const construction of auxiliary) {
		if (
			!Number.isInteger(construction.schedule_index) ||
			construction.schedule_index < 0 ||
			construction.schedule_index >= schedule.entries.length ||
			constructionByIndex.has(construction.schedule_index)
		) {
			fail('manifest_auxiliary_schedule_index_invalid')
		}

		constructionByIndex.set(construction.schedule_index, construction)
	}

	const allocation = allocateMultipartySats(principalSats, schedule)

	const globalProofYs = new Set<string>()
	const globalSecrets = new Set<string>()
	const globalChildren = new Set<string>()
	const globalTokenHashes = new Set<string>()

	const sellerConstruction = normalizeConstruction(
		allocation.seller_sats,
		seller,
		globalProofYs,
		globalSecrets,
		globalChildren,
		globalTokenHashes,
	)

	const payouts: MultipartyManifestProjectedPayout[] = [
		Object.freeze({
			schedule_index: null,
			role: 'seller',
			recipient_pubkey: null,
			payout_capability_event_id: null,
			validator_offer_event_id: null,
			validator_acceptance_event_id: null,
			amount_sats: allocation.seller_sats,
			...sellerConstruction,
		}),
	]

	for (let index = 0; index < schedule.entries.length; index++) {
		const entry = schedule.entries[index]
		const binding = bindings[index]
		const allocationEntry = allocation.auxiliary[index]
		const construction = constructionByIndex.get(index) ?? fail('manifest_internal_schedule_alignment_failure')

		if (allocationEntry.schedule_index !== entry.schedule_index) {
			fail('manifest_internal_schedule_alignment_failure')
		}

		const normalized = normalizeConstruction(
			allocationEntry.sats,
			construction,
			globalProofYs,
			globalSecrets,
			globalChildren,
			globalTokenHashes,
		)

		payouts.push(
			Object.freeze({
				schedule_index: entry.schedule_index,
				role: entry.role,
				recipient_pubkey: entry.recipient_pubkey,
				payout_capability_event_id: entry.payout_capability_event_id,
				validator_offer_event_id: entry.validator_offer_event_id ?? null,
				validator_acceptance_event_id: binding.validator_acceptance_event_id ?? null,
				amount_sats: allocationEntry.sats,
				...normalized,
			}),
		)
	}

	const conserved = payouts.reduce((sum, payout) => sum + payout.amount_sats, ZERO_SATS)

	if (conserved !== principalSats) {
		fail('manifest_principal_conservation_failure')
	}

	const projection: MultipartyManifestProjection = {
		[MULTIPARTY_MANIFEST_PROJECTION]: true,
		status: 'manifest_projected',
		root_event_id: rootEventId,
		activation_event_id: activationEventId,
		payout_schedule_commitment: commitment,
		selected_mint: selectedMint,
		gross_sats: grossSats,
		principal_sats: principalSats,
		previous_bid_event_id: previousBidEventId,
		locktime,
		refund_pubkey: refundPubkey,
		payouts: Object.freeze(payouts),
	}

	manifestProjections.add(projection)

	return Object.freeze(projection)
}
