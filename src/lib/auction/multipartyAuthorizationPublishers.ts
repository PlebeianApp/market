/**
 * Publishers for the multiparty authorization events (kinds 1027-1030).
 *
 * The parsers in `multipartyAuthorization.ts` are the acceptance oracle: they
 * define, field by field, what the network accepts. Until now only the read side
 * existed, so nothing in the app could produce a payout capability, a validator
 * offer, a validator acceptance or a seller activation.
 *
 * Two properties this module holds:
 *
 * 1. **Canonicalize what the wire defines as order, reject what is ambiguous.**
 *    The mint set has a canonical UTF-8 order and the activation's acceptances must
 *    ascend by schedule index, so the builders sort both. Duplicates, out-of-range
 *    values and non-canonical encodings are refused rather than silently repaired.
 *
 * 2. **Construct, then verify with the acceptance oracle.** An event builder does
 *    not return until the corresponding parser has accepted its own output. A
 *    builder can therefore never emit an event the network would reject, and no
 *    field rule is duplicated between the two sides.
 *
 * Nothing here signs, publishes or touches funds: the caller supplies the event
 * identity (id, pubkey, signature, created_at) that its signer produced.
 */

import {
	AUCTION_MULTIPARTY_ACTIVATION_KIND,
	AUCTION_MULTIPARTY_ENTITLEMENT_BASIS,
	AUCTION_MULTIPARTY_MAX_MINTS,
	AUCTION_MULTIPARTY_MAX_MINT_BYTES,
	AUCTION_MULTIPARTY_PAYOUT_CAPABILITY_KIND,
	AUCTION_MULTIPARTY_VALIDATOR_ACCEPTANCE_KIND,
	AUCTION_MULTIPARTY_VALIDATOR_OFFER_KIND,
	AUCTION_MULTIPARTY_VALIDATOR_SERVICE_CONTRACT,
	AuctionMultipartyAuthorizationError,
	parseMultipartyPayoutCapability,
	parseMultipartySellerActivation,
	parseMultipartyValidatorAcceptance,
	parseMultipartyValidatorOffer,
} from './multipartyAuthorization'
import { AUCTION_MULTIPARTY_SCHEDULE_MAX_ENTRIES, AUCTION_MULTIPARTY_SETTLEMENT_POLICY } from './multipartySchedule'

const HEX64 = /^[0-9a-f]{64}$/
const HEX128 = /^[0-9a-f]{128}$/
const UINT = /^(0|[1-9][0-9]*)$/
const ROOT_COORDINATE = /^30408:[0-9a-f]{64}:[A-Za-z0-9_-]+$/
const ASCII_CONTROL_OR_SPACE = /[\x00-\x20\x7f]/

const utf8Encoder = new TextEncoder()

const fail = (code: string): never => {
	throw new AuctionMultipartyAuthorizationError(code)
}

/** The identity a signer produced for the event being assembled. */
export interface MultipartyEventIdentity {
	readonly id: string
	readonly pubkey: string
	readonly sig: string
	readonly created_at: number
}

export interface MultipartyPayoutCapabilityPayload {
	readonly payout_xpub: string
	readonly payout_xpub_pop: string
	readonly mints: readonly string[]
	readonly valid_from: number
	readonly expires_at: number
}

export interface MultipartyValidatorOfferPayload {
	readonly payout_capability_event_id: string
	readonly allocation_bps: number
	readonly mints: readonly string[]
	readonly valid_from: number
	readonly expires_at: number
}

export interface MultipartyValidatorAcceptancePayload {
	readonly auction_root_event_id: string
	readonly auction_coordinate: string
	readonly payout_schedule_commitment: string
	readonly schedule_index: number
	readonly payout_capability_event_id: string
	readonly validator_offer_event_id: string
	readonly allocation_bps: number
	readonly expires_at: number
}

export interface MultipartySellerActivationPayload {
	readonly auction_root_event_id: string
	readonly auction_coordinate: string
	readonly payout_schedule_commitment: string
	readonly mints: readonly string[]
	readonly validator_acceptances: readonly {
		readonly schedule_index: number
		readonly acceptance_event_id: string
	}[]
}

const assertHex64 = (value: string, code: string): string => (HEX64.test(value) ? value : fail(code))

const assertHex128 = (value: string, code: string): string => (HEX128.test(value) ? value : fail(code))

const assertCanonicalUint = (value: number, code: string, maximum = Number.MAX_SAFE_INTEGER): number => {
	if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
		fail(code)
	}
	// The wire form is a canonical decimal string; a value that cannot round-trip
	// through it would be re-encoded differently by another implementation.
	if (!UINT.test(String(value))) {
		fail(code)
	}
	return value
}

const assertCoordinate = (value: string, code: string): string => (ROOT_COORDINATE.test(value) ? value : fail(code))

const assertMintIdentifier = (value: string, code: string): string => {
	if (typeof value !== 'string' || value.length === 0 || value.length > AUCTION_MULTIPARTY_MAX_MINT_BYTES) {
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

/**
 * Canonical mint set: valid identifiers, no duplicates, ascending UTF-8 order.
 * The caller's input order is irrelevant — the wire defines one order.
 */
const canonicalMintSet = (mints: readonly string[], code: string): string[] => {
	if (mints.length === 0 || mints.length > AUCTION_MULTIPARTY_MAX_MINTS) {
		fail(code)
	}
	const parsed = mints.map((mint) => assertMintIdentifier(mint, code))
	if (new Set(parsed).size !== parsed.length) {
		fail(code)
	}
	return [...parsed].sort((left, right) => {
		const leftBytes = utf8Encoder.encode(left)
		const rightBytes = utf8Encoder.encode(right)
		const length = Math.min(leftBytes.length, rightBytes.length)
		for (let index = 0; index < length; index++) {
			if (leftBytes[index] !== rightBytes[index]) {
				return (leftBytes[index] as number) - (rightBytes[index] as number)
			}
		}
		return leftBytes.length - rightBytes.length
	})
}

const assertValidityWindow = (validFrom: number, expiresAt: number, prefix: string): void => {
	assertCanonicalUint(validFrom, `${prefix}_valid_from_noncanonical`)
	assertCanonicalUint(expiresAt, `${prefix}_expires_at_noncanonical`)
	if (expiresAt < validFrom) {
		fail(`${prefix}_validity_window_invalid`)
	}
}

/** The event envelope the caller signs and publishes, plus the oracle's reading of it. */
export interface MultipartyAssembledEvent<T> {
	readonly event: {
		readonly id: string
		readonly pubkey: string
		readonly sig: string
		readonly created_at: number
		readonly kind: number
		readonly tags: string[][]
		readonly content: string
	}
	readonly parsed: T
}

/**
 * Construct, then verify with the acceptance oracle before returning.
 *
 * The caller signs and publishes `event`; `parsed` is proof that the network will
 * accept it. A builder therefore cannot emit an event the parsers would reject, and
 * none of their field rules are duplicated here.
 */
const assembleAndVerify = <T>(
	identity: MultipartyEventIdentity,
	kind: number,
	tags: string[][],
	parse: (event: never) => T,
): MultipartyAssembledEvent<T> => {
	assertHex64(identity.id, 'publish_event_id_noncanonical')
	assertHex64(identity.pubkey, 'publish_event_author_noncanonical')
	assertHex128(identity.sig, 'publish_event_signature_noncanonical')
	assertCanonicalUint(identity.created_at, 'publish_event_created_at_noncanonical')

	const event = {
		id: identity.id,
		pubkey: identity.pubkey,
		sig: identity.sig,
		created_at: identity.created_at,
		kind,
		tags,
		content: '',
	} as const

	return Object.freeze({ event: Object.freeze(event), parsed: parse(event as never) })
}

export const buildMultipartyPayoutCapabilityTags = (payload: MultipartyPayoutCapabilityPayload): string[][] => {
	assertValidityWindow(payload.valid_from, payload.expires_at, 'capability')

	return [
		['settlement_policy', AUCTION_MULTIPARTY_SETTLEMENT_POLICY],
		['payout_xpub', payload.payout_xpub],
		['payout_xpub_pop', assertHex128(payload.payout_xpub_pop, 'capability_payout_xpub_pop_noncanonical')],
		...canonicalMintSet(payload.mints, 'capability_mint_set_invalid').map((mint) => ['mint', mint]),
		['valid_from', String(payload.valid_from)],
		['expires_at', String(payload.expires_at)],
	]
}

export const buildMultipartyPayoutCapabilityEvent = (input: {
	readonly identity: MultipartyEventIdentity
	readonly payload: MultipartyPayoutCapabilityPayload
}) =>
	assembleAndVerify(
		input.identity,
		AUCTION_MULTIPARTY_PAYOUT_CAPABILITY_KIND,
		buildMultipartyPayoutCapabilityTags(input.payload),
		parseMultipartyPayoutCapability,
	)

export const buildMultipartyValidatorOfferTags = (payload: MultipartyValidatorOfferPayload): string[][] => {
	assertValidityWindow(payload.valid_from, payload.expires_at, 'offer')

	return [
		['settlement_policy', AUCTION_MULTIPARTY_SETTLEMENT_POLICY],
		['payout_capability', assertHex64(payload.payout_capability_event_id, 'offer_payout_capability_noncanonical')],
		['allocation_bps', String(assertCanonicalUint(payload.allocation_bps, 'offer_allocation_bps_noncanonical', 10_000))],
		['entitlement_basis', AUCTION_MULTIPARTY_ENTITLEMENT_BASIS],
		['service_contract', AUCTION_MULTIPARTY_VALIDATOR_SERVICE_CONTRACT],
		...canonicalMintSet(payload.mints, 'offer_mint_set_invalid').map((mint) => ['mint', mint]),
		['valid_from', String(payload.valid_from)],
		['expires_at', String(payload.expires_at)],
	]
}

export const buildMultipartyValidatorOfferEvent = (input: {
	readonly identity: MultipartyEventIdentity
	readonly payload: MultipartyValidatorOfferPayload
}) =>
	assembleAndVerify(
		input.identity,
		AUCTION_MULTIPARTY_VALIDATOR_OFFER_KIND,
		buildMultipartyValidatorOfferTags(input.payload),
		parseMultipartyValidatorOffer,
	)

export const buildMultipartyValidatorAcceptanceTags = (payload: MultipartyValidatorAcceptancePayload): string[][] => [
	['settlement_policy', AUCTION_MULTIPARTY_SETTLEMENT_POLICY],
	['e', assertHex64(payload.auction_root_event_id, 'acceptance_root_event_id_noncanonical')],
	['a', assertCoordinate(payload.auction_coordinate, 'acceptance_auction_coordinate_noncanonical')],
	['payout_schedule_commitment', assertHex64(payload.payout_schedule_commitment, 'acceptance_schedule_commitment_noncanonical')],
	[
		'schedule_index',
		String(
			assertCanonicalUint(payload.schedule_index, 'acceptance_schedule_index_noncanonical', AUCTION_MULTIPARTY_SCHEDULE_MAX_ENTRIES - 1),
		),
	],
	['payout_capability', assertHex64(payload.payout_capability_event_id, 'acceptance_payout_capability_noncanonical')],
	['validator_offer', assertHex64(payload.validator_offer_event_id, 'acceptance_validator_offer_noncanonical')],
	['allocation_bps', String(assertCanonicalUint(payload.allocation_bps, 'acceptance_allocation_bps_noncanonical', 10_000))],
	['entitlement_basis', AUCTION_MULTIPARTY_ENTITLEMENT_BASIS],
	['expires_at', String(assertCanonicalUint(payload.expires_at, 'acceptance_expires_at_noncanonical'))],
]

export const buildMultipartyValidatorAcceptanceEvent = (input: {
	readonly identity: MultipartyEventIdentity
	readonly payload: MultipartyValidatorAcceptancePayload
}) =>
	assembleAndVerify(
		input.identity,
		AUCTION_MULTIPARTY_VALIDATOR_ACCEPTANCE_KIND,
		buildMultipartyValidatorAcceptanceTags(input.payload),
		parseMultipartyValidatorAcceptance,
	)

export const buildMultipartySellerActivationTags = (payload: MultipartySellerActivationPayload): string[][] => {
	const indexes = new Set<number>()
	const acceptances = payload.validator_acceptances.map((acceptance) => {
		const scheduleIndex = assertCanonicalUint(
			acceptance.schedule_index,
			'activation_acceptance_schedule_index_noncanonical',
			AUCTION_MULTIPARTY_SCHEDULE_MAX_ENTRIES - 1,
		)
		// One acceptance per schedule entry: a duplicate index is ambiguous, not a
		// thing to deduplicate on the seller's behalf.
		if (indexes.has(scheduleIndex)) {
			fail('activation_acceptance_order_noncanonical')
		}
		indexes.add(scheduleIndex)
		return ['acceptance', String(scheduleIndex), assertHex64(acceptance.acceptance_event_id, 'activation_acceptance_event_id_noncanonical')]
	})

	return [
		['settlement_policy', AUCTION_MULTIPARTY_SETTLEMENT_POLICY],
		['e', assertHex64(payload.auction_root_event_id, 'activation_root_event_id_noncanonical')],
		['a', assertCoordinate(payload.auction_coordinate, 'activation_auction_coordinate_noncanonical')],
		['payout_schedule_commitment', assertHex64(payload.payout_schedule_commitment, 'activation_schedule_commitment_noncanonical')],
		...canonicalMintSet(payload.mints, 'activation_mint_set_invalid').map((mint) => ['mint', mint]),
		// The wire requires strictly ascending schedule indexes.
		...acceptances.sort((left, right) => Number(left[1]) - Number(right[1])),
	]
}

export const buildMultipartySellerActivationEvent = (input: {
	readonly identity: MultipartyEventIdentity
	readonly payload: MultipartySellerActivationPayload
}) =>
	assembleAndVerify(
		input.identity,
		AUCTION_MULTIPARTY_ACTIVATION_KIND,
		buildMultipartySellerActivationTags(input.payload),
		parseMultipartySellerActivation,
	)
