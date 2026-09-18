import { describe, expect, test } from 'bun:test'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { getAuctionBidderStatus, getValidatedBidderStatus } from '@/lib/auctionBidderStatus'
import type { ValidatedBidSet } from '@/lib/auction/bidValidation'
import type { ParsedBidEvent } from '@/lib/auction/events'

const makeAuction = (params: { id?: string; startAt?: number; endAt?: number }): NDKEvent =>
	({
		id: params.id ?? 'auction-root',
		pubkey: 'seller',
		created_at: 1,
		content: 'Auction description',
		tags: [
			['d', 'auction-1'],
			['title', 'Auction'],
			['start_at', String(params.startAt ?? 100)],
			['end_at', String(params.endAt ?? 300)],
			['max_end_at', String(params.endAt ?? 300)],
			['extension_rule', 'none'],
		],
	}) as NDKEvent

const makeBid = (params: { id: string; pubkey: string; amount: number; createdAt: number; status?: string }): NDKEvent =>
	({
		id: params.id,
		pubkey: params.pubkey,
		created_at: params.createdAt,
		content: JSON.stringify({ amount: params.amount }),
		tags: [
			['e', 'auction-root'],
			['amount', String(params.amount), 'SAT'],
			['status', params.status ?? 'locked'],
		],
	}) as NDKEvent

describe('auction bidder status', () => {
	test('no current user returns no status', () => {
		const auction = makeAuction({})
		const bids = [makeBid({ id: 'bid-1', pubkey: 'alice', amount: 1000, createdAt: 120 })]

		expect(getAuctionBidderStatus({ currentUserPubkey: '', auction, bids, isEnded: false })).toBeNull()
	})

	test('current user with no bids returns no status', () => {
		const auction = makeAuction({})
		const bids = [makeBid({ id: 'bid-1', pubkey: 'alice', amount: 1000, createdAt: 120 })]

		expect(getAuctionBidderStatus({ currentUserPubkey: 'bob', auction, bids, isEnded: false })).toBeNull()
	})

	test('current user is top bidder while live', () => {
		const auction = makeAuction({})
		const bids = [
			makeBid({ id: 'bid-1', pubkey: 'alice', amount: 1000, createdAt: 120 }),
			makeBid({ id: 'bid-2', pubkey: 'bob', amount: 1200, createdAt: 130 }),
		]

		expect(getAuctionBidderStatus({ currentUserPubkey: 'bob', auction, bids, isEnded: false })).toEqual({
			status: 'winning',
			label: "You're winning",
		})
	})

	test('current user is outbid while live', () => {
		const auction = makeAuction({})
		const bids = [
			makeBid({ id: 'bid-1', pubkey: 'alice', amount: 1000, createdAt: 120 }),
			makeBid({ id: 'bid-2', pubkey: 'bob', amount: 1200, createdAt: 130 }),
		]

		expect(getAuctionBidderStatus({ currentUserPubkey: 'alice', auction, bids, isEnded: false })).toEqual({
			status: 'outbid',
			label: "You've been outbid",
		})
	})

	test('current user is top bidder after ended', () => {
		const auction = makeAuction({})
		const bids = [
			makeBid({ id: 'bid-1', pubkey: 'alice', amount: 1000, createdAt: 120 }),
			makeBid({ id: 'bid-2', pubkey: 'bob', amount: 1200, createdAt: 130 }),
		]

		expect(getAuctionBidderStatus({ currentUserPubkey: 'bob', auction, bids, isEnded: true })).toEqual({
			status: 'won',
			label: 'You had the top bid',
		})
	})

	test('current user is outbid after ended', () => {
		const auction = makeAuction({})
		const bids = [
			makeBid({ id: 'bid-1', pubkey: 'alice', amount: 1000, createdAt: 120 }),
			makeBid({ id: 'bid-2', pubkey: 'bob', amount: 1200, createdAt: 130 }),
		]

		expect(getAuctionBidderStatus({ currentUserPubkey: 'alice', auction, bids, isEnded: true })).toEqual({
			status: 'was_outbid',
			label: 'You were outbid',
		})
	})

	test('tie-breaker follows existing auction bid ordering semantics', () => {
		const auction = makeAuction({})
		const bids = [
			makeBid({ id: 'bid-later', pubkey: 'alice', amount: 1200, createdAt: 130 }),
			makeBid({ id: 'bid-earlier', pubkey: 'bob', amount: 1200, createdAt: 120 }),
		]

		expect(getAuctionBidderStatus({ currentUserPubkey: 'bob', auction, bids, isEnded: false })).toEqual({
			status: 'winning',
			label: "You're winning",
		})
		expect(getAuctionBidderStatus({ currentUserPubkey: 'alice', auction, bids, isEnded: false })?.status).toBe('outbid')
	})
})

// ---------------------------------------------------------------------------
// Validated-set path — `getAuctionBidderStatus` delegates to
// `getValidatedBidderStatus` whenever a ValidatedBidSet is supplied, so the raw
// bid chains are never consulted. These cases pin that contract: the set is the
// single source of truth for the badge, and `'none'` means no badge at all.
// ---------------------------------------------------------------------------

// Only `bidderPubkey` (and `id` for readability) is read by the status
// derivation, so a single documented cast keeps the fixture readable — same
// approach as makeAuction/makeBid above.
const makeValidatedSet = (winnerPubkey: string | null, validPubkeys: string[]): ValidatedBidSet => {
	const bid = (pubkey: string, id: string) => ({ id, bidderPubkey: pubkey }) as unknown as ParsedBidEvent
	return {
		classified: [],
		validBids: validPubkeys.map((pubkey, index) => bid(pubkey, `bid-${index}`)),
		pendingBids: [],
		invalidBids: [],
		canonicalWinner: winnerPubkey ? bid(winnerPubkey, 'bid-winner') : null,
		currentTopValidAmount: 1200,
	}
}

describe('auction bidder status — validated set path', () => {
	test('the validated set overrides raw bids for the badge', () => {
		const auction = makeAuction({})
		// Raw bids say alice is winning; the validated set says bob is.
		const bids = [makeBid({ id: 'bid-1', pubkey: 'alice', amount: 9999, createdAt: 120 })]
		const validatedBidSet = makeValidatedSet('bob', ['bob'])

		expect(getAuctionBidderStatus({ currentUserPubkey: 'bob', auction, bids, isEnded: false, validatedBidSet })).toEqual({
			status: 'winning',
			label: "You're winning",
		})
		expect(getAuctionBidderStatus({ currentUserPubkey: 'alice', auction, bids, isEnded: false, validatedBidSet })).toBeNull()
	})

	test('validated winner after the auction ended reads "won"', () => {
		const auction = makeAuction({})
		expect(
			getAuctionBidderStatus({
				currentUserPubkey: 'bob',
				auction,
				bids: [],
				isEnded: true,
				validatedBidSet: makeValidatedSet('bob', ['bob']),
			}),
		).toEqual({ status: 'won', label: 'You had the top bid' })
	})

	test('validated non-winner with a valid bid is "outbid", and "was_outbid" once ended', () => {
		const auction = makeAuction({})
		const validatedBidSet = makeValidatedSet('bob', ['bob', 'alice'])

		expect(getAuctionBidderStatus({ currentUserPubkey: 'alice', auction, bids: [], isEnded: false, validatedBidSet })).toEqual({
			status: 'outbid',
			label: "You've been outbid",
		})
		expect(getAuctionBidderStatus({ currentUserPubkey: 'alice', auction, bids: [], isEnded: true, validatedBidSet })).toEqual({
			status: 'was_outbid',
			label: 'You were outbid',
		})
	})

	test('no valid bid in the set returns null even when the user has a raw bid', () => {
		const auction = makeAuction({})
		const bids = [makeBid({ id: 'bid-1', pubkey: 'alice', amount: 1000, createdAt: 120 })]

		expect(
			getAuctionBidderStatus({ currentUserPubkey: 'alice', auction, bids, isEnded: false, validatedBidSet: makeValidatedSet(null, []) }),
		).toBeNull()
	})

	test('pending-only set (no quorum) returns null — no badge while validators decide', () => {
		const auction = makeAuction({})
		expect(
			getAuctionBidderStatus({
				currentUserPubkey: 'alice',
				auction,
				bids: [],
				isEnded: false,
				validatedBidSet: makeValidatedSet(null, []),
			}),
		).toBeNull()
	})

	test('getValidatedBidderStatus returns null for a pubkey outside the valid set', () => {
		expect(getValidatedBidderStatus('carol', makeValidatedSet('bob', ['bob']), false)).toBeNull()
	})

	test('getValidatedBidderStatus trims nothing — callers pass a normalised pubkey', () => {
		// getAuctionBidderStatus trims before delegating; the direct export is the
		// low-level half and expects an already-normalised pubkey.
		expect(getValidatedBidderStatus('bob', makeValidatedSet('bob', ['bob']), false)).toEqual({
			status: 'winning',
			label: "You're winning",
		})
	})
})
