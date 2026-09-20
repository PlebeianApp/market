import { describe, expect, test } from 'bun:test'
import { auctionWinResolutionQueryOptions } from '../auctions'
import { auctionKeys } from '../queryKeyFactory'
import { getAuctionCoordinate } from '@/lib/auctionSettlement'
import type { NostrEventLike } from '@/lib/nostr/eventLike'
import type { QueuedAuctionWin } from '@/lib/auction/winNotification'

const SELLER_PUBKEY = 'c'.repeat(64)
const AUCTION_ROOT_ID = 'a'.repeat(64)
const BID_ID = 'e'.repeat(64)

const auction: NostrEventLike = {
	id: AUCTION_ROOT_ID,
	pubkey: SELLER_PUBKEY,
	kind: 30408,
	created_at: 100,
	content: '',
	tags: [['d', 'auction-1']],
}

const win: QueuedAuctionWin = { auctionRootEventId: AUCTION_ROOT_ID, bidEventId: BID_ID }

describe('auctionWinResolutionQueryOptions', () => {
	test('disables the query without a queued win', () => {
		expect(auctionWinResolutionQueryOptions(null, auction).enabled).toBe(false)
	})

	test('disables the query without the auction event', () => {
		expect(auctionWinResolutionQueryOptions(win, null).enabled).toBe(false)
	})

	test('disables the query when the auction carries no coordinate', () => {
		// A 30408 with no `d` tag has no `kind:pubkey:d` identity, so the release
		// chain cannot be resolved for it.
		const noCoordinate: NostrEventLike = { ...auction, tags: [] }

		expect(getAuctionCoordinate(noCoordinate)).toBe('')
		expect(auctionWinResolutionQueryOptions(win, noCoordinate).enabled).toBe(false)
	})

	test('enables the query for a queued win with a coordinate-bearing auction', () => {
		expect(auctionWinResolutionQueryOptions(win, auction).enabled).toBe(true)
	})

	test('keys on the auction and bid ids via auctionKeys.winResolution', () => {
		// Exact-value regression: the prompt invalidates and refetches by this key,
		// so the adapter must not invent its own shape.
		expect(auctionWinResolutionQueryOptions(win, auction).queryKey).toEqual([...auctionKeys.winResolution(AUCTION_ROOT_ID, BID_ID)])
	})

	test('keys on empty ids when no win is queued (never a shared undefined key)', () => {
		expect(auctionWinResolutionQueryOptions(null, null).queryKey).toEqual([...auctionKeys.winResolution('', '')])
	})

	test('caller composition: spreading and overriding enabled narrows the gate', () => {
		// The win prompt applies its own `isActiveBidder` condition on top of the
		// adapter's permissive gate; the override must be able to win.
		const options = auctionWinResolutionQueryOptions(win, auction)
		const narrowed = { ...options, enabled: options.enabled && false }

		expect(narrowed.enabled).toBe(false)
		expect(options.enabled).toBe(true)
	})
})
