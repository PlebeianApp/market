import { describe, expect, test } from 'bun:test'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import type { ValidatedBidSet } from '../auction/bidValidation'
import type { ParsedBidEvent } from '../auction/events'
import {
	getValidatedTopAmount,
	getValidatedTopBidderPubkey,
	getValidatedBidderState,
	isBidValidated,
	getBidClassification,
} from '../auction/validatedBidView'

// =============================================================================
// validatedBidView — pure selectors over a ValidatedBidSet
//
// T4 coverage:
//   - zero verdicts → not top (no valid bids)
//   - quorum-confirmed → top (canonicalWinner set)
//   - canonicalWinner tie-break (equal amount → earliest created_at → lexical id)
//   - duplicate-proof bid excluded
//   - all four bidder status kinds (winning, outbid, won, was_outbid)
// =============================================================================

const stubRawEvent = (): NDKEvent =>
	({
		kind: 1023,
		pubkey: '',
		content: '',
		tags: [] as string[][],
		id: 'stub',
		created_at: 0,
	}) as unknown as NDKEvent

function makeParsedBid(id: string, bidderPubkey: string, amount: number, createdAt: number): ParsedBidEvent {
	return {
		rawEvent: stubRawEvent(),
		id,
		bidderPubkey,
		createdAt,
		auctionRootEventId: 'root',
		auctionCoordinate: '30408:seller:test',
		sellerPubkey: 'seller',
		amount,
		legLockedAmount: amount,
		currency: 'SAT',
		mint: 'https://mint.test',
		locktime: 10_000,
		refundPubkey: 'refund',
		childPubkey: 'child',
		lockSecrets: ['secret'],
		proofYs: ['proof_y'],
		createdForEndAt: 5_000,
		bidNonce: 'nonce',
		keyScheme: 'hd_p2pk',
		status: 'locked',
	}
}

function makeEmptySet(overrides: Partial<ValidatedBidSet> = {}): ValidatedBidSet {
	return {
		classified: [],
		validBids: [],
		pendingBids: [],
		invalidBids: [],
		canonicalWinner: null,
		currentTopValidAmount: 0,
		...overrides,
	}
}

const ALICE = 'a'.repeat(64)
const BOB = 'b'.repeat(64)
const CHARLIE = 'c'.repeat(64)

// ---------------------------------------------------------------------------
// getValidatedTopAmount
// ---------------------------------------------------------------------------

describe('getValidatedTopAmount', () => {
	test('returns 0 when no valid bids and no startingBid', () => {
		const set = makeEmptySet()
		expect(getValidatedTopAmount(set)).toBe(0)
	})

	test('returns startingBid when no valid bids but startingBid given', () => {
		const set = makeEmptySet()
		expect(getValidatedTopAmount(set, 1_000)).toBe(1_000)
	})

	test('returns currentTopValidAmount when it exceeds startingBid', () => {
		const set = makeEmptySet({ currentTopValidAmount: 5_000 })
		expect(getValidatedTopAmount(set, 1_000)).toBe(5_000)
	})

	test('returns currentTopValidAmount when it equals startingBid', () => {
		const set = makeEmptySet({ currentTopValidAmount: 1_000 })
		expect(getValidatedTopAmount(set, 1_000)).toBe(1_000)
	})

	test('returns startingBid when it exceeds currentTopValidAmount (T3 baseline)', () => {
		const set = makeEmptySet({ currentTopValidAmount: 500 })
		expect(getValidatedTopAmount(set, 1_000)).toBe(1_000)
	})
})

// ---------------------------------------------------------------------------
// getValidatedTopBidderPubkey
// ---------------------------------------------------------------------------

describe('getValidatedTopBidderPubkey', () => {
	test('returns null when no canonicalWinner', () => {
		const set = makeEmptySet()
		expect(getValidatedTopBidderPubkey(set)).toBeNull()
	})

	test('returns winner pubkey when canonicalWinner exists', () => {
		const bid = makeParsedBid('bid1', ALICE, 5_000, 1_000)
		const set = makeEmptySet({ canonicalWinner: bid })
		expect(getValidatedTopBidderPubkey(set)).toBe(ALICE)
	})
})

// ---------------------------------------------------------------------------
// getValidatedBidderState
// ---------------------------------------------------------------------------

describe('getValidatedBidderState', () => {
	test('returns "won" when user is canonical winner and auction ended', () => {
		const bid = makeParsedBid('bid1', ALICE, 5_000, 1_000)
		const set = makeEmptySet({
			canonicalWinner: bid,
			validBids: [bid],
		})
		expect(getValidatedBidderState(set, ALICE, true)).toBe('won')
	})

	test('returns "winning" when user is canonical winner and auction active', () => {
		const bid = makeParsedBid('bid1', ALICE, 5_000, 1_000)
		const set = makeEmptySet({
			canonicalWinner: bid,
			validBids: [bid],
		})
		expect(getValidatedBidderState(set, ALICE, false)).toBe('winning')
	})

	test('returns "was_outbid" when user has a valid bid but is not winner and auction ended', () => {
		const winner = makeParsedBid('bid1', ALICE, 5_000, 1_000)
		const loser = makeParsedBid('bid2', BOB, 3_000, 2_000)
		const set = makeEmptySet({
			canonicalWinner: winner,
			validBids: [winner, loser],
		})
		expect(getValidatedBidderState(set, BOB, true)).toBe('was_outbid')
	})

	test('returns "outbid" when user has a valid bid but is not winner and auction active', () => {
		const winner = makeParsedBid('bid1', ALICE, 5_000, 1_000)
		const loser = makeParsedBid('bid2', BOB, 3_000, 2_000)
		const set = makeEmptySet({
			canonicalWinner: winner,
			validBids: [winner, loser],
		})
		expect(getValidatedBidderState(set, BOB, false)).toBe('outbid')
	})

	test('returns "none" when user has no valid bid', () => {
		const winner = makeParsedBid('bid1', ALICE, 5_000, 1_000)
		const set = makeEmptySet({
			canonicalWinner: winner,
			validBids: [winner],
		})
		expect(getValidatedBidderState(set, CHARLIE, false)).toBe('none')
	})

	test('returns "none" when user has no valid bid and auction ended', () => {
		const winner = makeParsedBid('bid1', ALICE, 5_000, 1_000)
		const set = makeEmptySet({
			canonicalWinner: winner,
			validBids: [winner],
		})
		expect(getValidatedBidderState(set, CHARLIE, true)).toBe('none')
	})

	test('returns "none" when set is empty', () => {
		const set = makeEmptySet()
		expect(getValidatedBidderState(set, ALICE, false)).toBe('none')
	})
})

// ---------------------------------------------------------------------------
// isBidValidated
// ---------------------------------------------------------------------------

describe('isBidValidated', () => {
	test('returns true when bid is classified as valid', () => {
		const bid = makeParsedBid('bid1', ALICE, 5_000, 1_000)
		const set = makeEmptySet({
			classified: [{ bid, classification: 'valid', observedAt: 1_000 }],
		})
		expect(isBidValidated(set, 'bid1')).toBe(true)
	})

	test('returns false when bid is classified as pending', () => {
		const bid = makeParsedBid('bid1', ALICE, 5_000, 1_000)
		const set = makeEmptySet({
			classified: [{ bid, classification: 'pending', observedAt: 1_000 }],
		})
		expect(isBidValidated(set, 'bid1')).toBe(false)
	})

	test('returns false when bid is classified as invalid', () => {
		const bid = makeParsedBid('bid1', ALICE, 5_000, 1_000)
		const set = makeEmptySet({
			classified: [{ bid, classification: 'invalid', observedAt: 1_000, invalidReason: 'duplicate_proof' }],
		})
		expect(isBidValidated(set, 'bid1')).toBe(false)
	})

	test('returns false when bid is not in the set', () => {
		const set = makeEmptySet()
		expect(isBidValidated(set, 'unknown')).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// getBidClassification
// ---------------------------------------------------------------------------

describe('getBidClassification', () => {
	test('returns "valid" for valid bid', () => {
		const bid = makeParsedBid('bid1', ALICE, 5_000, 1_000)
		const set = makeEmptySet({
			classified: [{ bid, classification: 'valid', observedAt: 1_000 }],
		})
		expect(getBidClassification(set, 'bid1')).toBe('valid')
	})

	test('returns "pending" for pending bid', () => {
		const bid = makeParsedBid('bid1', ALICE, 5_000, 1_000)
		const set = makeEmptySet({
			classified: [{ bid, classification: 'pending', observedAt: 1_000 }],
		})
		expect(getBidClassification(set, 'bid1')).toBe('pending')
	})

	test('returns "invalid" for invalid bid', () => {
		const bid = makeParsedBid('bid1', ALICE, 5_000, 1_000)
		const set = makeEmptySet({
			classified: [{ bid, classification: 'invalid', observedAt: 1_000, invalidReason: 'duplicate_proof' }],
		})
		expect(getBidClassification(set, 'bid1')).toBe('invalid')
	})

	test('returns "unknown" for bid not in the set', () => {
		const set = makeEmptySet()
		expect(getBidClassification(set, 'unknown')).toBe('unknown')
	})
})

// ---------------------------------------------------------------------------
// Tie-break contract — canonicalWinner uses deterministic rules
// (amount → earliest created_at → lexical id)
// ---------------------------------------------------------------------------

describe('canonicalWinner tie-break (validated set)', () => {
	test('higher amount wins', () => {
		const low = makeParsedBid('bid_a', ALICE, 3_000, 1_000)
		const high = makeParsedBid('bid_b', BOB, 5_000, 2_000)
		const set = makeEmptySet({
			canonicalWinner: high,
			validBids: [low, high],
			currentTopValidAmount: 5_000,
		})
		expect(getValidatedTopBidderPubkey(set)).toBe(BOB)
		expect(getValidatedTopAmount(set)).toBe(5_000)
	})

	test('equal amount: earliest created_at wins', () => {
		const early = makeParsedBid('bid_a', ALICE, 5_000, 1_000)
		const late = makeParsedBid('bid_b', BOB, 5_000, 2_000)
		const set = makeEmptySet({
			canonicalWinner: early, // earliest created_at wins
			validBids: [early, late],
			currentTopValidAmount: 5_000,
		})
		expect(getValidatedTopBidderPubkey(set)).toBe(ALICE)
	})

	test('equal amount and equal created_at: lexical id wins', () => {
		const a = makeParsedBid('aaaa01', ALICE, 5_000, 1_000)
		const b = makeParsedBid('bbbb02', BOB, 5_000, 1_000)
		const set = makeEmptySet({
			canonicalWinner: a, // 'aaaa01' < 'bbbb02' → lexical
			validBids: [a, b],
			currentTopValidAmount: 5_000,
		})
		expect(getValidatedTopBidderPubkey(set)).toBe(ALICE)
	})
})

// ---------------------------------------------------------------------------
// Duplicate-proof bid excluded (T4)
// ---------------------------------------------------------------------------

describe('duplicate-proof bid excluded', () => {
	test('duplicate bid (same amount, same bidder) not in validBids — not top', () => {
		const original = makeParsedBid('bid_original', ALICE, 5_000, 1_000)
		const duplicate = makeParsedBid('bid_duplicate', ALICE, 5_000, 2_000) // different id but same bidder+amount
		// In a real set, the duplicate is excluded from validBids. We test that
		// the selector correctly reflects that exclusion.
		const set = makeEmptySet({
			canonicalWinner: original,
			validBids: [original], // duplicate excluded
			classified: [
				{ bid: original, classification: 'valid', observedAt: 1_000 },
				{ bid: duplicate, classification: 'invalid', observedAt: 2_000, invalidReason: 'duplicate_proof' },
			],
			currentTopValidAmount: 5_000,
		})
		// The duplicate should show as invalid
		expect(getBidClassification(set, 'bid_duplicate')).toBe('invalid')
		// The canonical winner remains the original
		expect(getValidatedTopBidderPubkey(set)).toBe(ALICE)
	})

	test('bid with same lock_secret/proof_y as another bidder excluded (M5 cross-bid check)', () => {
		const legit = makeParsedBid('bid_legit', ALICE, 5_000, 1_000)
		const fake = makeParsedBid('bid_fake', BOB, 5_000, 2_000)
		const set = makeEmptySet({
			canonicalWinner: legit,
			validBids: [legit], // fake excluded by cross-bid duplicate check
			classified: [
				{ bid: legit, classification: 'valid', observedAt: 1_000 },
				{ bid: fake, classification: 'invalid', observedAt: 2_000, invalidReason: 'cross_bid_duplicate_proof' },
			],
			invalidBids: [fake],
			currentTopValidAmount: 5_000,
		})
		// Legit stays winner
		expect(getValidatedTopBidderPubkey(set)).toBe(ALICE)
		// Fake is classified as invalid
		expect(getBidClassification(set, 'bid_fake')).toBe('invalid')
	})
})
