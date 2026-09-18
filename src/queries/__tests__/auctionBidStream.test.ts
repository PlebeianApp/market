import { describe, test, expect } from 'bun:test'
import { buildAuctionBidFilters, mergeAndSortBids } from '@/queries/auctions'
import type { NDKEvent } from '@nostr-dev-kit/ndk'

const AUCTION_BID_KIND = 1023

// Minimal NDKEvent stub — only the fields the hook logic reads.
function makeBid(id: string, created_at: number, pubkey = 'pubkey1'): NDKEvent {
	return { id, pubkey, created_at, tags: [], content: '', kind: AUCTION_BID_KIND } as unknown as NDKEvent
}

// ---------------------------------------------------------------------------
// buildAuctionBidFilters
// ---------------------------------------------------------------------------

describe('buildAuctionBidFilters', () => {
	test('returns #e filter when only rootEventId is given', () => {
		const filters = buildAuctionBidFilters('root123', undefined, 500)
		expect(filters).toHaveLength(1)
		expect((filters[0] as { '#e'?: string[] })['#e']).toEqual(['root123'])
		expect((filters[0] as { '#a'?: string[] })['#a']).toBeUndefined()
	})

	test('returns #a filter when only coordinates are given', () => {
		const filters = buildAuctionBidFilters('', '30408:pubkey:dtag', 500)
		expect(filters).toHaveLength(1)
		expect((filters[0] as { '#a'?: string[] })['#a']).toEqual(['30408:pubkey:dtag'])
		expect((filters[0] as { '#e'?: string[] })['#e']).toBeUndefined()
	})

	test('returns both filters when both ids are given', () => {
		const filters = buildAuctionBidFilters('root123', '30408:pubkey:dtag', 500)
		expect(filters).toHaveLength(2)
		expect((filters[0] as { '#e'?: string[] })['#e']).toEqual(['root123'])
		expect((filters[1] as { '#a'?: string[] })['#a']).toEqual(['30408:pubkey:dtag'])
	})

	test('returns empty array when both ids are empty', () => {
		const filters = buildAuctionBidFilters('', undefined, 500)
		expect(filters).toHaveLength(0)
	})

	test('passes limit to every filter', () => {
		const filters = buildAuctionBidFilters('root123', '30408:pubkey:dtag', 250)
		expect(filters.every((f) => f.limit === 250)).toBe(true)
	})

	test('every filter targets AUCTION_BID_KIND', () => {
		const filters = buildAuctionBidFilters('root123', '30408:pubkey:dtag', 500)
		expect(filters.every((f) => f.kinds?.includes(AUCTION_BID_KIND as never))).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// mergeAndSortBids — the bug-fix path
// ---------------------------------------------------------------------------

describe('mergeAndSortBids', () => {
	test('adds new bids to an empty existing list', () => {
		const incoming = [makeBid('b1', 100), makeBid('b2', 200)]
		const result = mergeAndSortBids([], incoming)
		expect(result.map((b) => b.id)).toEqual(['b1', 'b2'])
	})

	test('preserves existing bids when incoming is empty', () => {
		const existing = [makeBid('b1', 100)]
		const result = mergeAndSortBids(existing, [])
		expect(result).toBe(existing) // same reference — no allocation
	})

	test('merges without duplicates — regression for disappearing bids on re-subscription', () => {
		// Simulates: first subscription loaded b1+b2, coordinates arrive,
		// effect re-runs, relay re-delivers b1+b2 plus new b3.
		const existing = [makeBid('b1', 100), makeBid('b2', 200)]
		const incoming = [makeBid('b1', 100), makeBid('b2', 200), makeBid('b3', 300)]
		const result = mergeAndSortBids(existing, incoming)
		expect(result.map((b) => b.id)).toEqual(['b1', 'b2', 'b3'])
	})

	test('deduplicates when identical ids arrive in incoming', () => {
		const existing = [makeBid('b1', 100)]
		const result = mergeAndSortBids(existing, [makeBid('b1', 100)])
		expect(result).toBe(existing)
	})

	test('sorts merged result ascending by created_at', () => {
		const existing = [makeBid('b3', 300), makeBid('b1', 100)]
		const incoming = [makeBid('b2', 200)]
		const result = mergeAndSortBids(existing, incoming)
		expect(result.map((b) => b.id)).toEqual(['b1', 'b2', 'b3'])
	})

	test('treats missing created_at as 0 when sorting', () => {
		const noTimestamp = { ...makeBid('b_old', 0), created_at: undefined } as unknown as NDKEvent
		const withTimestamp = makeBid('b_new', 50)
		const result = mergeAndSortBids([], [withTimestamp, noTimestamp])
		expect(result[0].id).toBe('b_old')
		expect(result[1].id).toBe('b_new')
	})

	test('existing bids are not mutated', () => {
		const existing = [makeBid('b1', 100)]
		const frozen = Object.freeze([...existing])
		// Should not throw even though frozen array cannot be mutated in-place
		expect(() => mergeAndSortBids(frozen as NDKEvent[], [makeBid('b2', 200)])).not.toThrow()
	})
})
