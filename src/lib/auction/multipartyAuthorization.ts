import { base64urlnopad } from '@scure/base'
import { HDKey } from '@scure/bip32'
import type { NostrEventLike } from '../nostr/eventLike'
import {
	AUCTION_MULTIPARTY_SCHEDULE_MAX_BYTES,
	AUCTION_MULTIPARTY_SCHEDULE_MAX_ENTRIES,
	AUCTION_MULTIPARTY_SETTLEMENT_POLICY,
	parseCanonicalSchedule,
	type AuctionMultipartyCanonicalScheduleEntry,
} from './multipartySchedule'

export const AUCTION_MULTIPARTY_ROOT_KIND = 30408
export const AUCTION_MULTIPARTY_PAYOUT_CAPABILITY_KIND = 1027
export const AUCTION_MULTIPARTY_VALIDATOR_OFFER_KIND = 1028
export const AUCTION_MULTIPARTY_VALIDATOR_ACCEPTANCE_KIND = 1029
export const AUCTION_MULTIPARTY_ACTIVATION_KIND = 1030

export const AUCTION_MULTIPARTY_ENTITLEMENT_BASIS = 'cashu_face_value'
export const AUCTION_MULTIPARTY_VALIDATOR_SERVICE_CONTRACT = 'auction_validator_v1'

export const AUCTION_MULTIPARTY_ROOT_MAX_TAGS = 256
export const AUCTION_MULTIPARTY_AUTH_MAX_TAGS = 64
export const AUCTION_MULTIPARTY_MAX_TAG_ELEMENTS = 16
export const AUCTION_MULTIPARTY_MAX_AGGREGATE_TAG_BYTES = 32_768
export const AUCTION_MULTIPARTY_AUTH_MAX_TAG_ELEMENT_BYTES = 4096
export const AUCTION_MULTIPARTY_MAX_MINTS = 16
export const AUCTION_MULTIPARTY_MAX_MINT_BYTES = 2048

const MAX_SCHEDULE_B64U_CHARS = Math.ceil((AUCTION_MULTIPARTY_SCHEDULE_MAX_BYTES * 4) / 3)

const HEX64 = /^[0-9a-f]{64}$/
const HEX128 = /^[0-9a-f]{128}$/
const UINT = /^(0|[1-9][0-9]*)$/
const ROOT_COORDINATE = /^30408:[0-9a-f]{64}:[A-Za-z0-9_-]+$/
const D_TAG = /^[A-Za-z0-9_-]+$/
const B64U_NOPAD = /^[A-Za-z0-9_-]+$/
const ASCII_CONTROL_OR_SPACE = /[\x00-\x20\x7f]/

const utf8Encoder = new TextEncoder()

export class AuctionMultipartyAuthorizationError extends Error {
	readonly code: string

	constructor(code: string) {
		super(code)
		this.name = 'AuctionMultipartyAuthorizationError'
		this.code = code
	}
}

const fail = (code: string): never => {
	throw new AuctionMultipartyAuthorizationError(code)
}

interface EnvelopePolicy {
	prefix: string
	maxTags: number
	maxElementBytes?: number
	contentMustBeEmpty: boolean
}

const assertTagEnvelope = (event: NostrEventLike, policy: EnvelopePolicy): void => {
	const runtimeEvent = event as unknown as {
		tags?: unknown
		content?: unknown
	}

	const runtimeTagsCandidate = runtimeEvent.tags

	if (!Array.isArray(runtimeTagsCandidate)) {
		fail(`${policy.prefix}_tags_malformed`)
	}

	// Array.isArray is the runtime trust boundary. The explicit local
	// type prevents hostile `unknown` input from leaking past this point
	// while preserving the exact fail-closed runtime behavior above.
	const runtimeTags = runtimeTagsCandidate as unknown[]

	if (runtimeTags.length > policy.maxTags) {
		fail(`${policy.prefix}_tag_count_exceeds_limit`)
	}

	let aggregateBytes = 0

	for (const unknownTag of runtimeTags) {
		if (!Array.isArray(unknownTag)) {
			fail(`${policy.prefix}_tags_malformed`)
		}

		const tagElements = unknownTag as unknown[]

		if (tagElements.length === 0) {
			fail(`${policy.prefix}_tags_malformed`)
		}

		if (tagElements.length > AUCTION_MULTIPARTY_MAX_TAG_ELEMENTS) {
			fail(`${policy.prefix}_tag_element_count_exceeds_limit`)
		}

		for (const unknownElement of tagElements) {
			const element = typeof unknownElement === 'string' ? unknownElement : fail(`${policy.prefix}_tags_malformed`)

			const cheapMaximum = policy.maxElementBytes ?? AUCTION_MULTIPARTY_MAX_AGGREGATE_TAG_BYTES

			if (element.length > cheapMaximum) {
				if (policy.maxElementBytes !== undefined) {
					fail(`${policy.prefix}_tag_element_bytes_exceeds_limit`)
				}
				fail(`${policy.prefix}_tag_bytes_exceeds_limit`)
			}

			const elementBytes = utf8Encoder.encode(element).length

			if (policy.maxElementBytes !== undefined && elementBytes > policy.maxElementBytes) {
				fail(`${policy.prefix}_tag_element_bytes_exceeds_limit`)
			}

			aggregateBytes += elementBytes

			if (aggregateBytes > AUCTION_MULTIPARTY_MAX_AGGREGATE_TAG_BYTES) {
				fail(`${policy.prefix}_tag_bytes_exceeds_limit`)
			}
		}
	}

	if (typeof runtimeEvent.content !== 'string') {
		fail(`${policy.prefix}_content_malformed`)
	}

	if (policy.contentMustBeEmpty && runtimeEvent.content !== '') {
		fail(`${policy.prefix}_content_nonempty`)
	}
}

const assertEventIdentityShape = (event: NostrEventLike, prefix: string): void => {
	if (!HEX64.test(event.id)) {
		fail(`${prefix}_event_id_noncanonical`)
	}

	if (!HEX64.test(event.pubkey)) {
		fail(`${prefix}_author_noncanonical`)
	}

	if (!HEX128.test(event.sig ?? '')) {
		fail(`${prefix}_signature_noncanonical`)
	}

	if (!Number.isSafeInteger(event.created_at) || (event.created_at as number) < 0) {
		fail(`${prefix}_created_at_noncanonical`)
	}
}

const readSingleton = (tags: readonly string[][], name: string, prefix: string): string => {
	const matches = tags.filter((tag) => tag[0] === name)

	if (matches.length === 0) {
		fail(`${prefix}_${name}_missing`)
	}

	if (matches.length > 1) {
		fail(`${prefix}_${name}_duplicate`)
	}

	const tag = matches[0]

	if (tag.length !== 2) {
		fail(`${prefix}_${name}_malformed`)
	}

	return tag[1]
}

const readRepeated = (tags: readonly string[][], name: string, prefix: string, exactLength: number): string[][] => {
	const matches = tags.filter((tag) => tag[0] === name)

	for (const tag of matches) {
		if (tag.length !== exactLength) {
			fail(`${prefix}_${name}_malformed`)
		}
	}

	return matches
}

const assertAllowedTagNames = (tags: readonly string[][], allowed: ReadonlySet<string>, prefix: string): void => {
	for (const tag of tags) {
		if (!allowed.has(tag[0])) {
			fail(`${prefix}_unknown_tag`)
		}
	}
}

const parseCanonicalUint = (raw: string, code: string, maximum = Number.MAX_SAFE_INTEGER): number => {
	if (!UINT.test(raw)) {
		fail(code)
	}

	const value = BigInt(raw)

	if (value > BigInt(maximum)) {
		fail(code)
	}

	return Number(value)
}

const parsePositiveCanonicalUint = (raw: string, code: string, maximum = Number.MAX_SAFE_INTEGER): number => {
	const value = parseCanonicalUint(raw, code, maximum)
	if (value === 0) fail(code)
	return value
}

const assertCanonicalHex64 = (value: string, code: string): string => {
	if (!HEX64.test(value)) fail(code)
	return value
}

const compareUtf8 = (left: string, right: string): number => {
	const leftBytes = utf8Encoder.encode(left)
	const rightBytes = utf8Encoder.encode(right)
	const length = Math.min(leftBytes.length, rightBytes.length)

	for (let index = 0; index < length; index++) {
		if (leftBytes[index] !== rightBytes[index]) {
			return leftBytes[index] - rightBytes[index]
		}
	}

	return leftBytes.length - rightBytes.length
}

const parseMintIdentifier = (value: string, code: string): string => {
	if (value.length === 0 || value.length > AUCTION_MULTIPARTY_MAX_MINT_BYTES) {
		fail(code)
	}

	const byteLength = utf8Encoder.encode(value).length

	if (byteLength === 0 || byteLength > AUCTION_MULTIPARTY_MAX_MINT_BYTES || ASCII_CONTROL_OR_SPACE.test(value)) {
		fail(code)
	}

	const parsed = (() => {
		try {
			return new URL(value)
		} catch {
			return fail(code)
		}
	})()

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		fail(code)
	}

	return value
}

const parseMintSet = (tags: readonly string[][], prefix: string, requireCanonicalOrder: boolean): readonly string[] => {
	const mintTags = readRepeated(tags, 'mint', prefix, 2)

	if (mintTags.length === 0 || mintTags.length > AUCTION_MULTIPARTY_MAX_MINTS) {
		fail(`${prefix}_mint_set_invalid`)
	}

	const mints = mintTags.map((tag) => parseMintIdentifier(tag[1], `${prefix}_mint_set_invalid`))

	const unique = new Set(mints)

	if (unique.size !== mints.length) {
		fail(`${prefix}_mint_set_invalid`)
	}

	if (requireCanonicalOrder) {
		for (let index = 1; index < mints.length; index++) {
			if (compareUtf8(mints[index - 1], mints[index]) >= 0) {
				fail(`${prefix}_mint_set_noncanonical`)
			}
		}
	}

	return Object.freeze([...mints])
}

const assertCanonicalXpub = (value: string, code: string): string => {
	if (value.length === 0 || value !== value.trim() || ASCII_CONTROL_OR_SPACE.test(value)) {
		fail(code)
	}

	try {
		const parsed = HDKey.fromExtendedKey(value)

		if (parsed.privateKey !== null) {
			fail(code)
		}

		if (parsed.publicExtendedKey !== value) {
			fail(code)
		}

		const publicKey = parsed.publicKey

		if (!publicKey || publicKey.length !== 33 || (publicKey[0] !== 0x02 && publicKey[0] !== 0x03)) {
			fail(code)
		}
	} catch (error) {
		if (error instanceof AuctionMultipartyAuthorizationError) {
			throw error
		}
		fail(code)
	}

	return value
}

const requireProfile = (tags: readonly string[][], prefix: string): void => {
	const profile = readSingleton(tags, 'settlement_policy', prefix)

	if (profile !== AUCTION_MULTIPARTY_SETTLEMENT_POLICY) {
		fail(`${prefix}_profile_unsupported`)
	}
}

const assertSubset = (subset: readonly string[], superset: readonly string[], code: string): void => {
	const allowed = new Set(superset)

	for (const value of subset) {
		if (!allowed.has(value)) {
			fail(code)
		}
	}
}

const requireDefined = <T>(value: T | undefined, code: string): T => (value === undefined ? fail(code) : value)

export interface ParsedMultipartyRoot {
	readonly id: string
	readonly seller_pubkey: string
	readonly d: string
	readonly coordinate: string
	readonly settlement_policy: typeof AUCTION_MULTIPARTY_SETTLEMENT_POLICY
	readonly payout_schedule_commitment: string
	readonly payout_schedule_b64u: string
	readonly schedule_entries: readonly Readonly<AuctionMultipartyCanonicalScheduleEntry>[]
	readonly auxiliary_allocation_bps: number
	readonly seller_remainder_bps: number
	readonly start_at: number
	readonly max_end_at: number
	readonly p2pk_xpub: string
	readonly mints: readonly string[]
	readonly auditors: readonly string[]
	readonly auditor_quorum: number
}

export interface ParsedMultipartyPayoutCapability {
	readonly id: string
	readonly recipient_pubkey: string
	readonly payout_xpub: string
	readonly payout_xpub_pop: string
	readonly mints: readonly string[]
	readonly valid_from: number
	readonly expires_at: number
}

export interface ParsedMultipartyValidatorOffer {
	readonly id: string
	readonly validator_pubkey: string
	readonly payout_capability_event_id: string
	readonly allocation_bps: number
	readonly mints: readonly string[]
	readonly valid_from: number
	readonly expires_at: number
}

export interface ParsedMultipartyValidatorAcceptance {
	readonly id: string
	readonly validator_pubkey: string
	readonly auction_root_event_id: string
	readonly auction_coordinate: string
	readonly payout_schedule_commitment: string
	readonly schedule_index: number
	readonly payout_capability_event_id: string
	readonly validator_offer_event_id: string
	readonly allocation_bps: number
	readonly expires_at: number
}

export interface ParsedMultipartyActivationAcceptance {
	readonly schedule_index: number
	readonly acceptance_event_id: string
}

export interface ParsedMultipartySellerActivation {
	readonly id: string
	readonly seller_pubkey: string
	readonly auction_root_event_id: string
	readonly auction_coordinate: string
	readonly payout_schedule_commitment: string
	readonly mints: readonly string[]
	readonly validator_acceptances: readonly ParsedMultipartyActivationAcceptance[]
}

const ROOT_CRITICAL_TAGS = new Set([
	'd',
	'settlement_policy',
	'payout_schedule_commitment',
	'payout_schedule',
	'start_at',
	'max_end_at',
	'p2pk_xpub',
	'auditor_quorum',
])

export const parseMultipartyRoot = (event: NostrEventLike): ParsedMultipartyRoot => {
	assertTagEnvelope(event, {
		prefix: 'root',
		maxTags: AUCTION_MULTIPARTY_ROOT_MAX_TAGS,
		contentMustBeEmpty: false,
	})

	if (event.kind !== AUCTION_MULTIPARTY_ROOT_KIND) {
		fail('root_wrong_kind')
	}

	assertEventIdentityShape(event, 'root')

	for (const tag of event.tags) {
		if (tag[0] === 'zapSplit' || tag[0] === 'v4v') {
			fail('root_competing_payout_metadata_forbidden')
		}
	}

	const d = readSingleton(event.tags, 'd', 'root')

	if (!D_TAG.test(d)) {
		fail('root_d_malformed')
	}

	requireProfile(event.tags, 'root')

	const commitment = readSingleton(event.tags, 'payout_schedule_commitment', 'root')

	if (!HEX64.test(commitment)) {
		fail('root_payout_schedule_commitment_noncanonical')
	}

	const payoutScheduleValue = readSingleton(event.tags, 'payout_schedule', 'root')

	if (!payoutScheduleValue.startsWith('b64u:')) {
		fail('root_payout_schedule_noncanonical')
	}

	const encodedSchedule = payoutScheduleValue.slice('b64u:'.length)

	if (encodedSchedule.length === 0 || encodedSchedule.length > MAX_SCHEDULE_B64U_CHARS || !B64U_NOPAD.test(encodedSchedule)) {
		fail('root_payout_schedule_noncanonical')
	}

	const scheduleBytes = (() => {
		try {
			return base64urlnopad.decode(encodedSchedule)
		} catch {
			return fail('root_payout_schedule_noncanonical')
		}
	})()

	if (base64urlnopad.encode(scheduleBytes) !== encodedSchedule) {
		fail('root_payout_schedule_noncanonical')
	}

	const schedule = parseCanonicalSchedule(scheduleBytes)

	if (schedule.schedule_commitment !== commitment) {
		fail('root_schedule_commitment_mismatch')
	}

	const startAt = parseCanonicalUint(readSingleton(event.tags, 'start_at', 'root'), 'root_start_at_noncanonical')

	const maxEndAt = parseCanonicalUint(readSingleton(event.tags, 'max_end_at', 'root'), 'root_max_end_at_noncanonical')

	if (maxEndAt < startAt) {
		fail('root_funding_window_invalid')
	}

	const p2pkXpub = assertCanonicalXpub(readSingleton(event.tags, 'p2pk_xpub', 'root'), 'root_p2pk_xpub_noncanonical')

	const mints = parseMintSet(event.tags, 'root', false)

	const auditorTags = readRepeated(event.tags, 'auditors', 'root', 2)

	if (auditorTags.length === 0) {
		fail('root_auditor_set_invalid')
	}

	const auditors = auditorTags.map((tag) => assertCanonicalHex64(tag[1], 'root_auditor_set_invalid'))

	if (new Set(auditors).size !== auditors.length) {
		fail('root_auditor_set_invalid')
	}

	const auditorQuorum = parsePositiveCanonicalUint(readSingleton(event.tags, 'auditor_quorum', 'root'), 'root_auditor_quorum_invalid')

	if (auditorQuorum > auditors.length) {
		fail('root_auditor_quorum_invalid')
	}

	const auditorSet = new Set(auditors)
	const validatorEntries = schedule.entries.filter((entry) => entry.role === 'validator')

	for (const entry of validatorEntries) {
		if (!auditorSet.has(entry.recipient_pubkey)) {
			fail('root_schedule_validator_not_auditor')
		}
	}

	if (validatorEntries.length < auditorQuorum) {
		fail('root_validator_schedule_quorum_insufficient')
	}

	for (const tag of event.tags) {
		if (ROOT_CRITICAL_TAGS.has(tag[0]) || tag[0] === 'mint' || tag[0] === 'auditors') {
			continue
		}
		// Unknown non-economic root/display tags deliberately remain allowed.
	}

	const coordinate = `${AUCTION_MULTIPARTY_ROOT_KIND}:${event.pubkey}:${d}`

	const scheduleEntries = schedule.entries.map((entry) => Object.freeze({ ...entry }))

	return Object.freeze({
		id: event.id,
		seller_pubkey: event.pubkey,
		d,
		coordinate,
		settlement_policy: AUCTION_MULTIPARTY_SETTLEMENT_POLICY,
		payout_schedule_commitment: commitment,
		payout_schedule_b64u: encodedSchedule,
		schedule_entries: Object.freeze(scheduleEntries),
		auxiliary_allocation_bps: schedule.auxiliary_allocation_bps,
		seller_remainder_bps: schedule.seller_remainder_bps,
		start_at: startAt,
		max_end_at: maxEndAt,
		p2pk_xpub: p2pkXpub,
		mints,
		auditors: Object.freeze([...auditors]),
		auditor_quorum: auditorQuorum,
	})
}

const CAPABILITY_TAGS = new Set(['settlement_policy', 'payout_xpub', 'payout_xpub_pop', 'mint', 'valid_from', 'expires_at'])

export const parseMultipartyPayoutCapability = (event: NostrEventLike): ParsedMultipartyPayoutCapability => {
	assertTagEnvelope(event, {
		prefix: 'capability',
		maxTags: AUCTION_MULTIPARTY_AUTH_MAX_TAGS,
		maxElementBytes: AUCTION_MULTIPARTY_AUTH_MAX_TAG_ELEMENT_BYTES,
		contentMustBeEmpty: true,
	})

	if (event.kind !== AUCTION_MULTIPARTY_PAYOUT_CAPABILITY_KIND) {
		fail('capability_wrong_kind')
	}

	assertEventIdentityShape(event, 'capability')
	assertAllowedTagNames(event.tags, CAPABILITY_TAGS, 'capability')
	requireProfile(event.tags, 'capability')

	const payoutXpub = assertCanonicalXpub(readSingleton(event.tags, 'payout_xpub', 'capability'), 'capability_payout_xpub_noncanonical')

	const payoutXpubPop = readSingleton(event.tags, 'payout_xpub_pop', 'capability')

	if (!HEX128.test(payoutXpubPop)) {
		fail('capability_payout_xpub_pop_noncanonical')
	}

	const mints = parseMintSet(event.tags, 'capability', true)

	const validFrom = parseCanonicalUint(readSingleton(event.tags, 'valid_from', 'capability'), 'capability_valid_from_noncanonical')

	const expiresAt = parseCanonicalUint(readSingleton(event.tags, 'expires_at', 'capability'), 'capability_expires_at_noncanonical')

	if (expiresAt < validFrom) {
		fail('capability_validity_window_invalid')
	}

	return Object.freeze({
		id: event.id,
		recipient_pubkey: event.pubkey,
		payout_xpub: payoutXpub,
		payout_xpub_pop: payoutXpubPop,
		mints,
		valid_from: validFrom,
		expires_at: expiresAt,
	})
}

const OFFER_TAGS = new Set([
	'settlement_policy',
	'payout_capability',
	'allocation_bps',
	'entitlement_basis',
	'service_contract',
	'mint',
	'valid_from',
	'expires_at',
])

export const parseMultipartyValidatorOffer = (event: NostrEventLike): ParsedMultipartyValidatorOffer => {
	assertTagEnvelope(event, {
		prefix: 'offer',
		maxTags: AUCTION_MULTIPARTY_AUTH_MAX_TAGS,
		maxElementBytes: AUCTION_MULTIPARTY_AUTH_MAX_TAG_ELEMENT_BYTES,
		contentMustBeEmpty: true,
	})

	if (event.kind !== AUCTION_MULTIPARTY_VALIDATOR_OFFER_KIND) {
		fail('offer_wrong_kind')
	}

	assertEventIdentityShape(event, 'offer')
	assertAllowedTagNames(event.tags, OFFER_TAGS, 'offer')
	requireProfile(event.tags, 'offer')

	const capabilityId = assertCanonicalHex64(readSingleton(event.tags, 'payout_capability', 'offer'), 'offer_payout_capability_noncanonical')

	const allocationBps = parseCanonicalUint(
		readSingleton(event.tags, 'allocation_bps', 'offer'),
		'offer_allocation_bps_noncanonical',
		10_000,
	)

	if (readSingleton(event.tags, 'entitlement_basis', 'offer') !== AUCTION_MULTIPARTY_ENTITLEMENT_BASIS) {
		fail('offer_entitlement_basis_invalid')
	}

	if (readSingleton(event.tags, 'service_contract', 'offer') !== AUCTION_MULTIPARTY_VALIDATOR_SERVICE_CONTRACT) {
		fail('offer_service_contract_invalid')
	}

	const mints = parseMintSet(event.tags, 'offer', true)

	const validFrom = parseCanonicalUint(readSingleton(event.tags, 'valid_from', 'offer'), 'offer_valid_from_noncanonical')

	const expiresAt = parseCanonicalUint(readSingleton(event.tags, 'expires_at', 'offer'), 'offer_expires_at_noncanonical')

	if (expiresAt < validFrom) {
		fail('offer_validity_window_invalid')
	}

	return Object.freeze({
		id: event.id,
		validator_pubkey: event.pubkey,
		payout_capability_event_id: capabilityId,
		allocation_bps: allocationBps,
		mints,
		valid_from: validFrom,
		expires_at: expiresAt,
	})
}

const ACCEPTANCE_TAGS = new Set([
	'e',
	'a',
	'settlement_policy',
	'payout_schedule_commitment',
	'schedule_index',
	'payout_capability',
	'validator_offer',
	'allocation_bps',
	'entitlement_basis',
	'expires_at',
])

export const parseMultipartyValidatorAcceptance = (event: NostrEventLike): ParsedMultipartyValidatorAcceptance => {
	assertTagEnvelope(event, {
		prefix: 'acceptance',
		maxTags: AUCTION_MULTIPARTY_AUTH_MAX_TAGS,
		maxElementBytes: AUCTION_MULTIPARTY_AUTH_MAX_TAG_ELEMENT_BYTES,
		contentMustBeEmpty: true,
	})

	if (event.kind !== AUCTION_MULTIPARTY_VALIDATOR_ACCEPTANCE_KIND) {
		fail('acceptance_wrong_kind')
	}

	assertEventIdentityShape(event, 'acceptance')
	assertAllowedTagNames(event.tags, ACCEPTANCE_TAGS, 'acceptance')
	requireProfile(event.tags, 'acceptance')

	const rootId = assertCanonicalHex64(readSingleton(event.tags, 'e', 'acceptance'), 'acceptance_root_event_id_noncanonical')

	const coordinate = readSingleton(event.tags, 'a', 'acceptance')
	if (!ROOT_COORDINATE.test(coordinate)) {
		fail('acceptance_auction_coordinate_noncanonical')
	}

	const scheduleCommitment = assertCanonicalHex64(
		readSingleton(event.tags, 'payout_schedule_commitment', 'acceptance'),
		'acceptance_schedule_commitment_noncanonical',
	)

	const scheduleIndex = parseCanonicalUint(
		readSingleton(event.tags, 'schedule_index', 'acceptance'),
		'acceptance_schedule_index_noncanonical',
		AUCTION_MULTIPARTY_SCHEDULE_MAX_ENTRIES - 1,
	)

	const capabilityId = assertCanonicalHex64(
		readSingleton(event.tags, 'payout_capability', 'acceptance'),
		'acceptance_payout_capability_noncanonical',
	)

	const offerId = assertCanonicalHex64(
		readSingleton(event.tags, 'validator_offer', 'acceptance'),
		'acceptance_validator_offer_noncanonical',
	)

	const allocationBps = parseCanonicalUint(
		readSingleton(event.tags, 'allocation_bps', 'acceptance'),
		'acceptance_allocation_bps_noncanonical',
		10_000,
	)

	if (readSingleton(event.tags, 'entitlement_basis', 'acceptance') !== AUCTION_MULTIPARTY_ENTITLEMENT_BASIS) {
		fail('acceptance_entitlement_basis_invalid')
	}

	const expiresAt = parseCanonicalUint(readSingleton(event.tags, 'expires_at', 'acceptance'), 'acceptance_expires_at_noncanonical')

	return Object.freeze({
		id: event.id,
		validator_pubkey: event.pubkey,
		auction_root_event_id: rootId,
		auction_coordinate: coordinate,
		payout_schedule_commitment: scheduleCommitment,
		schedule_index: scheduleIndex,
		payout_capability_event_id: capabilityId,
		validator_offer_event_id: offerId,
		allocation_bps: allocationBps,
		expires_at: expiresAt,
	})
}

const ACTIVATION_TAGS = new Set(['e', 'a', 'settlement_policy', 'payout_schedule_commitment', 'mint', 'acceptance'])

export const parseMultipartySellerActivation = (event: NostrEventLike): ParsedMultipartySellerActivation => {
	assertTagEnvelope(event, {
		prefix: 'activation',
		maxTags: AUCTION_MULTIPARTY_AUTH_MAX_TAGS,
		maxElementBytes: AUCTION_MULTIPARTY_AUTH_MAX_TAG_ELEMENT_BYTES,
		contentMustBeEmpty: true,
	})

	if (event.kind !== AUCTION_MULTIPARTY_ACTIVATION_KIND) {
		fail('activation_wrong_kind')
	}

	assertEventIdentityShape(event, 'activation')
	assertAllowedTagNames(event.tags, ACTIVATION_TAGS, 'activation')
	requireProfile(event.tags, 'activation')

	const rootId = assertCanonicalHex64(readSingleton(event.tags, 'e', 'activation'), 'activation_root_event_id_noncanonical')

	const coordinate = readSingleton(event.tags, 'a', 'activation')
	if (!ROOT_COORDINATE.test(coordinate)) {
		fail('activation_auction_coordinate_noncanonical')
	}

	const commitment = assertCanonicalHex64(
		readSingleton(event.tags, 'payout_schedule_commitment', 'activation'),
		'activation_schedule_commitment_noncanonical',
	)

	const mints = parseMintSet(event.tags, 'activation', true)

	const acceptanceTags = readRepeated(event.tags, 'acceptance', 'activation', 3)

	const acceptances = acceptanceTags.map((tag) => {
		const scheduleIndex = parseCanonicalUint(
			tag[1],
			'activation_acceptance_schedule_index_noncanonical',
			AUCTION_MULTIPARTY_SCHEDULE_MAX_ENTRIES - 1,
		)

		const acceptanceEventId = assertCanonicalHex64(tag[2], 'activation_acceptance_event_id_noncanonical')

		return Object.freeze({
			schedule_index: scheduleIndex,
			acceptance_event_id: acceptanceEventId,
		})
	})

	for (let index = 1; index < acceptances.length; index++) {
		if (acceptances[index - 1].schedule_index >= acceptances[index].schedule_index) {
			fail('activation_acceptance_order_noncanonical')
		}
	}

	return Object.freeze({
		id: event.id,
		seller_pubkey: event.pubkey,
		auction_root_event_id: rootId,
		auction_coordinate: coordinate,
		payout_schedule_commitment: commitment,
		mints,
		validator_acceptances: Object.freeze(acceptances),
	})
}

export interface MultipartyAuthorizationSnapshotBinding {
	readonly schedule_index: number
	readonly role: 'validator' | 'v4v'
	readonly recipient_pubkey: string
	readonly payout_xpub: string
	readonly payout_capability_event_id: string
	readonly validator_offer_event_id?: string
	readonly validator_acceptance_event_id?: string
	readonly allocation_bps: number
}

export interface MultipartyAuthorizationSnapshotRelations {
	readonly root_event_id: string
	readonly activation_event_id: string
	readonly payout_schedule_commitment: string
	readonly mints: readonly string[]
	readonly bindings: readonly MultipartyAuthorizationSnapshotBinding[]
}

/**
 * Pure exact-snapshot relationship validation only.
 *
 * SECURITY BOUNDARY:
 * This function does NOT prove NIP-01 signatures and does NOT verify the
 * payout_xpub BIP-340 proof of possession. Gate C2 MUST cryptographically
 * verify every exact event and payout-xpub PoP before this relation result
 * can participate in a funding decision.
 */
export const validateMultipartyAuthorizationSnapshotRelations = (input: {
	root: ParsedMultipartyRoot
	capabilities: readonly ParsedMultipartyPayoutCapability[]
	offers: readonly ParsedMultipartyValidatorOffer[]
	acceptances: readonly ParsedMultipartyValidatorAcceptance[]
	activation: ParsedMultipartySellerActivation
}): MultipartyAuthorizationSnapshotRelations => {
	const { root, activation } = input

	if (activation.seller_pubkey !== root.seller_pubkey) {
		fail('auth_activation_author_mismatch')
	}

	if (activation.auction_root_event_id !== root.id) {
		fail('auth_activation_root_mismatch')
	}

	if (activation.auction_coordinate !== root.coordinate) {
		fail('auth_activation_coordinate_mismatch')
	}

	if (activation.payout_schedule_commitment !== root.payout_schedule_commitment) {
		fail('auth_activation_schedule_commitment_mismatch')
	}

	assertSubset(activation.mints, root.mints, 'auth_activation_mint_not_root_authorized')

	const capabilities = new Map<string, ParsedMultipartyPayoutCapability>()
	for (const capability of input.capabilities) {
		if (capabilities.has(capability.id)) {
			fail('auth_duplicate_capability_event_id')
		}
		capabilities.set(capability.id, capability)
	}

	const offers = new Map<string, ParsedMultipartyValidatorOffer>()
	for (const offer of input.offers) {
		if (offers.has(offer.id)) {
			fail('auth_duplicate_offer_event_id')
		}
		offers.set(offer.id, offer)
	}

	const acceptances = new Map<string, ParsedMultipartyValidatorAcceptance>()
	for (const acceptance of input.acceptances) {
		if (acceptances.has(acceptance.id)) {
			fail('auth_duplicate_acceptance_event_id')
		}
		acceptances.set(acceptance.id, acceptance)
	}

	const validatorRows = root.schedule_entries.filter((entry) => entry.role === 'validator')

	if (activation.validator_acceptances.length !== validatorRows.length) {
		fail('auth_activation_acceptance_set_mismatch')
	}

	for (let index = 0; index < validatorRows.length; index++) {
		if (activation.validator_acceptances[index].schedule_index !== validatorRows[index].schedule_index) {
			fail('auth_activation_acceptance_set_mismatch')
		}
	}

	const activationAcceptanceByIndex = new Map(
		activation.validator_acceptances.map((entry) => [entry.schedule_index, entry.acceptance_event_id]),
	)

	const rootAuditors = new Set(root.auditors)
	const bindings: MultipartyAuthorizationSnapshotBinding[] = []
	let serviceAuthorizedValidators = 0

	for (const scheduleEntry of root.schedule_entries) {
		const capability = requireDefined(capabilities.get(scheduleEntry.payout_capability_event_id), 'auth_capability_missing')

		if (capability.recipient_pubkey !== scheduleEntry.recipient_pubkey) {
			fail('auth_capability_author_mismatch')
		}

		if (capability.valid_from > root.start_at || capability.expires_at < root.max_end_at) {
			fail('auth_capability_validity_window_insufficient')
		}

		if (scheduleEntry.allocation_bps > 0) {
			assertSubset(activation.mints, capability.mints, 'auth_activation_mint_not_capability_authorized')
		}

		if (scheduleEntry.role === 'validator') {
			if (!rootAuditors.has(scheduleEntry.recipient_pubkey)) {
				fail('auth_schedule_validator_not_root_auditor')
			}

			const offerId = requireDefined(scheduleEntry.validator_offer_event_id, 'auth_offer_missing')

			const offer = requireDefined(offers.get(offerId), 'auth_offer_missing')

			if (offer.validator_pubkey !== scheduleEntry.recipient_pubkey) {
				fail('auth_offer_author_mismatch')
			}

			if (offer.payout_capability_event_id !== scheduleEntry.payout_capability_event_id) {
				fail('auth_offer_capability_mismatch')
			}

			if (offer.allocation_bps !== scheduleEntry.allocation_bps) {
				fail('auth_offer_allocation_mismatch')
			}

			if (offer.valid_from > root.start_at || offer.expires_at < root.max_end_at) {
				fail('auth_offer_validity_window_insufficient')
			}

			assertSubset(offer.mints, capability.mints, 'auth_offer_mint_not_capability_authorized')

			const selectedAcceptanceId = requireDefined(activationAcceptanceByIndex.get(scheduleEntry.schedule_index), 'auth_acceptance_missing')

			const acceptance = requireDefined(acceptances.get(selectedAcceptanceId), 'auth_acceptance_missing')

			if (acceptance.validator_pubkey !== scheduleEntry.recipient_pubkey) {
				fail('auth_acceptance_author_mismatch')
			}

			if (acceptance.auction_root_event_id !== root.id) {
				fail('auth_acceptance_root_mismatch')
			}

			if (acceptance.auction_coordinate !== root.coordinate) {
				fail('auth_acceptance_coordinate_mismatch')
			}

			if (acceptance.payout_schedule_commitment !== root.payout_schedule_commitment) {
				fail('auth_acceptance_schedule_commitment_mismatch')
			}

			if (acceptance.schedule_index !== scheduleEntry.schedule_index) {
				fail('auth_acceptance_schedule_index_mismatch')
			}

			if (acceptance.payout_capability_event_id !== scheduleEntry.payout_capability_event_id) {
				fail('auth_acceptance_capability_mismatch')
			}

			if (acceptance.validator_offer_event_id !== offerId) {
				fail('auth_acceptance_offer_mismatch')
			}

			if (acceptance.allocation_bps !== scheduleEntry.allocation_bps) {
				fail('auth_acceptance_allocation_mismatch')
			}

			if (acceptance.expires_at < root.max_end_at) {
				fail('auth_acceptance_expiry_insufficient')
			}

			if (scheduleEntry.allocation_bps > 0) {
				assertSubset(activation.mints, offer.mints, 'auth_activation_mint_not_offer_authorized')
			}

			serviceAuthorizedValidators += 1

			bindings.push(
				Object.freeze({
					schedule_index: scheduleEntry.schedule_index,
					role: scheduleEntry.role,
					recipient_pubkey: scheduleEntry.recipient_pubkey,
					payout_xpub: capability.payout_xpub,
					payout_capability_event_id: scheduleEntry.payout_capability_event_id,
					validator_offer_event_id: offerId,
					validator_acceptance_event_id: acceptance.id,
					allocation_bps: scheduleEntry.allocation_bps,
				}),
			)
		} else {
			bindings.push(
				Object.freeze({
					schedule_index: scheduleEntry.schedule_index,
					role: scheduleEntry.role,
					recipient_pubkey: scheduleEntry.recipient_pubkey,
					payout_xpub: capability.payout_xpub,
					payout_capability_event_id: scheduleEntry.payout_capability_event_id,
					allocation_bps: scheduleEntry.allocation_bps,
				}),
			)
		}
	}

	if (serviceAuthorizedValidators < root.auditor_quorum) {
		fail('auth_contracted_validator_quorum_insufficient')
	}

	return Object.freeze({
		root_event_id: root.id,
		activation_event_id: activation.id,
		payout_schedule_commitment: root.payout_schedule_commitment,
		mints: Object.freeze([...activation.mints]),
		bindings: Object.freeze(bindings),
	})
}
