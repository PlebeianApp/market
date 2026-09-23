/**
 * "Ending Soon" ordering — the second half of the malformed-auction defect.
 *
 * `getAuctionBiddingCutoffAt` returns `0` for "no usable close time". The old
 * comparator treated `0` as "not ended" and then compared numerically, so a
 * zero cutoff beat every real `end_at`: the malformed staging event rendered
 * "No end date" and held slot #1, ahead of auctions ending in ten minutes.
 *
 * These cases pin the fix — live auctions first (soonest first), then events
 * whose close time is unknown, then ended ones — and they pin it at the
 * comparator, because `useFilteredAuctions` (the hook that consumed the inline
 * closure) has no renderer in this suite. That is why the comparators were
 * extracted as pure functions.
 */
import { describe, expect, test } from 'bun:test'

import type { NostrEventLike } from '../nostr/eventLike'
import { compareAuctionsEndingSoon, getAuctionEndingSoonRank } from '../utils/auctions'

const NOW = 1_700_000_000

const auction = (id: string, tags: string[][], created_at = NOW): NostrEventLike => ({
	id,
	pubkey: 'a'.repeat(64),
	kind: 30408,
	created_at,
	content: '',
	tags,
})

/** A live auction whose bidding cutoff is `NOW + seconds`. */
const liveAuction = (id: string, seconds: number) => auction(id, [['end_at', String(NOW + seconds)]])

/** An auction whose bidding cutoff has already passed. */
const endedAuction = (id: string, secondsAgo: number) => auction(id, [['end_at', String(NOW - secondsAgo)]])

/** The malformed shape: no timing tags at all, so the cutoff resolves to 0. */
const unknownCutoffAuction = (id: string) => auction(id, [['d', `malformed-${id}`]])

const order = (events: NostrEventLike[]): string[] =>
	[...events].sort((a, b) => compareAuctionsEndingSoon(a, b, NOW)).map((event) => event.id)

describe('getAuctionEndingSoonRank', () => {
	test('a future cutoff is live (0)', () => {
		expect(getAuctionEndingSoonRank(NOW + 600, NOW)).toBe(0)
	})

	test('a non-positive cutoff is unknown (1), not live', () => {
		expect(getAuctionEndingSoonRank(0, NOW)).toBe(1)
		expect(getAuctionEndingSoonRank(-1, NOW)).toBe(1)
	})

	test('a past cutoff is ended (2)', () => {
		expect(getAuctionEndingSoonRank(NOW - 1, NOW)).toBe(2)
	})
})

describe('compareAuctionsEndingSoon', () => {
	test('the reported regression: a zero-cutoff event no longer takes slot #1', () => {
		const malformed = unknownCutoffAuction('malformed')
		const endingIn10 = liveAuction('soon', 600)
		const endingIn2h = liveAuction('later', 7200)

		expect(order([malformed, endingIn10, endingIn2h])).toEqual(['soon', 'later', 'malformed'])
	})

	test('live auctions stay in soonest-first order regardless of input order', () => {
		const a = liveAuction('a', 3600)
		const b = liveAuction('b', 60)
		const c = liveAuction('c', 600)

		expect(order([a, b, c])).toEqual(['b', 'c', 'a'])
		expect(order([c, b, a])).toEqual(['b', 'c', 'a'])
	})

	test('ended auctions sort last, after unknown cutoffs', () => {
		const live = liveAuction('live', 600)
		const unknown = unknownCutoffAuction('unknown')
		const ended = endedAuction('ended', 600)

		expect(order([ended, unknown, live])).toEqual(['live', 'unknown', 'ended'])
	})

	test('several unknown cutoffs keep their incoming order (no reshuffle)', () => {
		const first = unknownCutoffAuction('first')
		const second = unknownCutoffAuction('second')

		expect(order([first, second])).toEqual(['first', 'second'])
		expect(order([second, first])).toEqual(['second', 'first'])
	})

	test('an auction with no end_at tag at all is treated as unknown, not as ending now', () => {
		const noEndTag = auction('no-end-tag', [['d', 'no-end-tag']])
		const live = liveAuction('live', 86400)

		expect(order([noEndTag, live])).toEqual(['live', 'no-end-tag'])
	})

	test('the cutoff is the bidding cutoff (max_end_at), not raw end_at', () => {
		// end_at is 10 minutes away but the anti-snipe window pushes the hard
		// cutoff to +2h — bidding closes at max_end_at, so that is what orders it.
		const antiSnipe = auction('anti-snipe', [
			['end_at', String(NOW + 600)],
			['max_end_at', String(NOW + 7200)],
		])
		const plainLive = liveAuction('plain', 3600)

		expect(order([antiSnipe, plainLive])).toEqual(['plain', 'anti-snipe'])
	})
})
