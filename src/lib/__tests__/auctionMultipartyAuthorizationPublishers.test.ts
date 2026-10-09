import { describe, expect, test } from 'bun:test'
import { HDKey } from '@scure/bip32'
import {
	AUCTION_MULTIPARTY_ENTITLEMENT_BASIS,
	AUCTION_MULTIPARTY_VALIDATOR_SERVICE_CONTRACT,
	AuctionMultipartyAuthorizationError,
} from '../auction/multipartyAuthorization'
import { AUCTION_MULTIPARTY_SETTLEMENT_POLICY } from '../auction/multipartySchedule'
import {
	buildMultipartyPayoutCapabilityEvent,
	buildMultipartyPayoutCapabilityTags,
	buildMultipartySellerActivationEvent,
	buildMultipartySellerActivationTags,
	buildMultipartyValidatorAcceptanceEvent,
	buildMultipartyValidatorOfferEvent,
	buildMultipartyValidatorOfferTags,
	type MultipartyEventIdentity,
} from '../auction/multipartyAuthorizationPublishers'

const xpub = (seedByte: number): string => HDKey.fromMasterSeed(new Uint8Array(32).fill(seedByte)).publicExtendedKey
const xpriv = (seedByte: number): string => HDKey.fromMasterSeed(new Uint8Array(32).fill(seedByte)).privateExtendedKey

const IDENTITY: MultipartyEventIdentity = {
	id: 'a'.repeat(64),
	pubkey: 'b'.repeat(64),
	sig: 'c'.repeat(128),
	created_at: 1_760_000_000,
}

const ROOT_ID = 'd'.repeat(64)
const COORDINATE = `30408:${'b'.repeat(64)}:harvest-auction`
const SCHEDULE_COMMITMENT = 'e'.repeat(64)
const CAPABILITY_ID = 'f'.repeat(64)
const OFFER_ID = '1'.repeat(64)
const MINT_A = 'https://mint.alpha.example'
const MINT_B = 'https://mint.beta.example'

const capabilityPayload = (overrides: Record<string, unknown> = {}) => ({
	payout_xpub: xpub(2),
	payout_xpub_pop: 'ab'.repeat(64),
	mints: [MINT_B, MINT_A],
	valid_from: 1_760_000_000,
	expires_at: 1_770_000_000,
	...overrides,
})

const offerPayload = (overrides: Record<string, unknown> = {}) => ({
	payout_capability_event_id: CAPABILITY_ID,
	allocation_bps: 625,
	mints: [MINT_A],
	valid_from: 1_760_000_000,
	expires_at: 1_770_000_000,
	...overrides,
})

const acceptancePayload = (overrides: Record<string, unknown> = {}) => ({
	auction_root_event_id: ROOT_ID,
	auction_coordinate: COORDINATE,
	payout_schedule_commitment: SCHEDULE_COMMITMENT,
	schedule_index: 0,
	payout_capability_event_id: CAPABILITY_ID,
	validator_offer_event_id: OFFER_ID,
	allocation_bps: 625,
	expires_at: 1_770_000_000,
	...overrides,
})

const activationPayload = (overrides: Record<string, unknown> = {}) => ({
	auction_root_event_id: ROOT_ID,
	auction_coordinate: COORDINATE,
	payout_schedule_commitment: SCHEDULE_COMMITMENT,
	mints: [MINT_A],
	validator_acceptances: [
		{ schedule_index: 2, acceptance_event_id: '2'.repeat(64) },
		{ schedule_index: 0, acceptance_event_id: '3'.repeat(64) },
	],
	...overrides,
})

type CapabilityPayload = ReturnType<typeof capabilityPayload>
type OfferPayload = ReturnType<typeof offerPayload>
type AcceptancePayload = ReturnType<typeof acceptancePayload>
type ActivationPayload = ReturnType<typeof activationPayload>

const code = (fn: () => unknown): string => {
	try {
		fn()
	} catch (error) {
		return error instanceof AuctionMultipartyAuthorizationError ? error.code : `not_our_error:${String(error)}`
	}
	return 'no_error'
}

describe('Multiparty authorization publishers', () => {
	test('builds a payout capability that its own parser accepts, field for field', () => {
		const payload = capabilityPayload()
		const { parsed, event } = buildMultipartyPayoutCapabilityEvent({
			identity: IDENTITY,
			payload: payload as CapabilityPayload,
		})
		expect(parsed.recipient_pubkey).toBe(IDENTITY.pubkey)
		expect(parsed.payout_xpub).toBe(payload.payout_xpub)
		expect(parsed.payout_xpub_pop).toBe(payload.payout_xpub_pop)
		expect(parsed.mints).toEqual([MINT_A, MINT_B])
		expect(parsed.valid_from).toBe(payload.valid_from)
		expect(parsed.expires_at).toBe(payload.expires_at)
		expect(event.kind).toBe(1027)
		expect(event.content).toBe('')
	})

	test('canonicalizes the mint set instead of trusting the caller order', () => {
		const forward = buildMultipartyPayoutCapabilityTags(capabilityPayload({ mints: [MINT_A, MINT_B] }) as CapabilityPayload)
		const reversed = buildMultipartyPayoutCapabilityTags(capabilityPayload({ mints: [MINT_B, MINT_A] }) as CapabilityPayload)
		expect(forward).toEqual(reversed)
		expect(forward.filter((tag) => tag[0] === 'mint')).toEqual([
			['mint', MINT_A],
			['mint', MINT_B],
		])
	})

	test('refuses a duplicate mint, an empty mint set and a non-http mint', () => {
		expect(code(() => buildMultipartyPayoutCapabilityTags(capabilityPayload({ mints: [MINT_A, MINT_A] }) as CapabilityPayload))).toBe(
			'capability_mint_set_invalid',
		)
		expect(code(() => buildMultipartyPayoutCapabilityTags(capabilityPayload({ mints: [] }) as CapabilityPayload))).toBe(
			'capability_mint_set_invalid',
		)
		expect(code(() => buildMultipartyPayoutCapabilityTags(capabilityPayload({ mints: ['wss://mint.example'] }) as CapabilityPayload))).toBe(
			'capability_mint_set_invalid',
		)
	})

	test('refuses a non-canonical proof of possession and a reversed validity window', () => {
		expect(code(() => buildMultipartyPayoutCapabilityTags(capabilityPayload({ payout_xpub_pop: 'zz' }) as CapabilityPayload))).toBe(
			'capability_payout_xpub_pop_noncanonical',
		)
		expect(code(() => buildMultipartyPayoutCapabilityTags(capabilityPayload({ valid_from: 1_770_000_001 }) as CapabilityPayload))).toBe(
			'capability_validity_window_invalid',
		)
	})

	test('builds a validator offer carrying the allocation, basis and service contract', () => {
		const { parsed } = buildMultipartyValidatorOfferEvent({
			identity: IDENTITY,
			payload: offerPayload() as OfferPayload,
		})
		expect(parsed.validator_pubkey).toBe(IDENTITY.pubkey)
		expect(parsed.payout_capability_event_id).toBe(CAPABILITY_ID)
		expect(parsed.allocation_bps).toBe(625)
		expect(parsed.mints).toEqual([MINT_A])

		const tags = buildMultipartyValidatorOfferTags(offerPayload() as OfferPayload)
		expect(tags).toContainEqual(['entitlement_basis', AUCTION_MULTIPARTY_ENTITLEMENT_BASIS])
		expect(tags).toContainEqual(['service_contract', AUCTION_MULTIPARTY_VALIDATOR_SERVICE_CONTRACT])
		expect(tags).toContainEqual(['settlement_policy', AUCTION_MULTIPARTY_SETTLEMENT_POLICY])
	})

	test('refuses an allocation above the basis points ceiling and a non-canonical capability id', () => {
		expect(
			code(() =>
				buildMultipartyValidatorOfferEvent({
					identity: IDENTITY,
					payload: offerPayload({ allocation_bps: 10_001 }) as OfferPayload,
				}),
			),
		).toBe('offer_allocation_bps_noncanonical')
		expect(
			code(() =>
				buildMultipartyValidatorOfferEvent({
					identity: IDENTITY,
					payload: offerPayload({ payout_capability_event_id: 'not-hex' }) as OfferPayload,
				}),
			),
		).toBe('offer_payout_capability_noncanonical')
	})

	test('builds a validator acceptance bound to the root, the coordinate, the commitment and the index', () => {
		const { parsed } = buildMultipartyValidatorAcceptanceEvent({
			identity: IDENTITY,
			payload: acceptancePayload() as AcceptancePayload,
		})
		expect(parsed.auction_root_event_id).toBe(ROOT_ID)
		expect(parsed.auction_coordinate).toBe(COORDINATE)
		expect(parsed.payout_schedule_commitment).toBe(SCHEDULE_COMMITMENT)
		expect(parsed.schedule_index).toBe(0)
		expect(parsed.validator_offer_event_id).toBe(OFFER_ID)
	})

	test('refuses an out-of-range schedule index and a malformed auction coordinate', () => {
		expect(
			code(() =>
				buildMultipartyValidatorAcceptanceEvent({
					identity: IDENTITY,
					payload: acceptancePayload({ schedule_index: 16 }) as AcceptancePayload,
				}),
			),
		).toBe('acceptance_schedule_index_noncanonical')
		expect(
			code(() =>
				buildMultipartyValidatorAcceptanceEvent({
					identity: IDENTITY,
					payload: acceptancePayload({ auction_coordinate: '30408:nothex:auction' }) as AcceptancePayload,
				}),
			),
		).toBe('acceptance_auction_coordinate_noncanonical')
	})

	test('builds a seller activation whose acceptances ascend by schedule index', () => {
		const tags = buildMultipartySellerActivationTags(activationPayload() as ActivationPayload)
		expect(tags.filter((tag) => tag[0] === 'acceptance')).toEqual([
			['acceptance', '0', '3'.repeat(64)],
			['acceptance', '2', '2'.repeat(64)],
		])

		const { parsed } = buildMultipartySellerActivationEvent({
			identity: IDENTITY,
			payload: activationPayload() as ActivationPayload,
		})
		expect(parsed.seller_pubkey).toBe(IDENTITY.pubkey)
		expect(parsed.validator_acceptances.map((entry) => entry.schedule_index)).toEqual([0, 2])
	})

	test('refuses duplicate schedule indexes in an activation, and a non-hex acceptance id', () => {
		expect(
			code(() =>
				buildMultipartySellerActivationTags(
					activationPayload({
						validator_acceptances: [
							{ schedule_index: 1, acceptance_event_id: '2'.repeat(64) },
							{ schedule_index: 1, acceptance_event_id: '3'.repeat(64) },
						],
					}) as ActivationPayload,
				),
			),
		).toBe('activation_acceptance_order_noncanonical')
		expect(
			code(() =>
				buildMultipartySellerActivationTags(
					activationPayload({
						validator_acceptances: [{ schedule_index: 0, acceptance_event_id: 'nope' }],
					}) as ActivationPayload,
				),
			),
		).toBe('activation_acceptance_event_id_noncanonical')
	})

	test('the event builder refuses to return an event its parser would reject', () => {
		// A private extended key passes the cheap shape checks the tag builder makes
		// but is not a payout xpub. Only the acceptance oracle catches it — which is
		// the whole point of constructing and then verifying.
		expect(code(() => buildMultipartyPayoutCapabilityTags(capabilityPayload({ payout_xpub: xpriv(9) }) as CapabilityPayload))).toBe(
			'no_error',
		)
		expect(
			code(() =>
				buildMultipartyPayoutCapabilityEvent({
					identity: IDENTITY,
					payload: capabilityPayload({ payout_xpub: xpriv(9) }) as CapabilityPayload,
				}),
			),
		).toBe('capability_payout_xpub_noncanonical')
	})

	test('refuses a malformed event identity rather than returning an unsigned event', () => {
		expect(
			code(() =>
				buildMultipartyPayoutCapabilityEvent({
					identity: { ...IDENTITY, id: 'short' },
					payload: capabilityPayload() as CapabilityPayload,
				}),
			),
		).toBe('publish_event_id_noncanonical')
		expect(
			code(() =>
				buildMultipartyPayoutCapabilityEvent({
					identity: { ...IDENTITY, sig: 'f'.repeat(127) },
					payload: capabilityPayload() as CapabilityPayload,
				}),
			),
		).toBe('publish_event_signature_noncanonical')
		expect(
			code(() =>
				buildMultipartyPayoutCapabilityEvent({
					identity: { ...IDENTITY, created_at: -1 },
					payload: capabilityPayload() as CapabilityPayload,
				}),
			),
		).toBe('publish_event_created_at_noncanonical')
	})

	test('never mutates the payload it was given, and returns a frozen envelope', () => {
		const payload = Object.freeze({ ...capabilityPayload(), mints: Object.freeze([MINT_B, MINT_A]) })
		const result = buildMultipartyPayoutCapabilityEvent({
			identity: IDENTITY,
			payload: payload as unknown as CapabilityPayload,
		})
		expect(payload.mints).toEqual([MINT_B, MINT_A])
		expect(Object.isFrozen(result)).toBe(true)
		expect(Object.isFrozen(result.event)).toBe(true)
		expect(result.event.tags.filter((tag) => tag[0] === 'mint')).toEqual([
			['mint', MINT_A],
			['mint', MINT_B],
		])
	})
})
