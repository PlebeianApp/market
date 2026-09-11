import { describe, expect, test } from 'bun:test'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { APP_AUCTION_DLEQ_ROLLOUT_START_AT } from '@/lib/auction/constants'
import { getAuctionDleqRequired } from '@/queries/auctions'

/**
 * ADR-0011 Decision 8 / review N1 — the bid FORM must carry the auction's
 * canonical DLEQ activation, not leave `publishAuctionBid` to re-derive it
 * from the local `start_at` boundary. These tests pin the tag reader the bid
 * form uses to build `AuctionBidFormData.dleqRequired`.
 */

const boundary = APP_AUCTION_DLEQ_ROLLOUT_START_AT

const buildAuctionEvent = (opts: { startAt: number; dleqRequired?: string }): NDKEvent =>
	({
		kind: 30408,
		pubkey: 'a'.repeat(64),
		content: '',
		created_at: 0,
		id: '1'.repeat(64),
		tags: [
			['d', 'auction-1'],
			['start_at', String(opts.startAt)],
			...(opts.dleqRequired !== undefined ? [['dleq_required', opts.dleqRequired]] : []),
		],
	}) as unknown as NDKEvent

describe('getAuctionDleqRequired (ADR-0011 Decision 8, review N1)', () => {
	test('signed dleq_required="1" is authoritative even on a pre-rollout start_at', () => {
		expect(getAuctionDleqRequired(buildAuctionEvent({ startAt: boundary - 1, dleqRequired: '1' }))).toBe(true)
	})

	test('signed dleq_required="0" is authoritative even on a post-rollout start_at', () => {
		expect(getAuctionDleqRequired(buildAuctionEvent({ startAt: boundary + 1, dleqRequired: '0' }))).toBe(false)
	})

	test('a tag-less legacy event falls back to the start_at rollout boundary', () => {
		expect(getAuctionDleqRequired(buildAuctionEvent({ startAt: boundary - 1 }))).toBe(false)
		expect(getAuctionDleqRequired(buildAuctionEvent({ startAt: boundary + 1 }))).toBe(true)
	})

	test('a null event is not DLEQ-required (no auction to bid on)', () => {
		expect(getAuctionDleqRequired(null)).toBe(false)
	})

	// The reader inherits `resolveDleqRequired`'s tag semantics; pin them here
	// so a future refactor of the reader cannot silently change the decision.
	test('only the canonical "1" opts in — a present but malformed tag does not', () => {
		for (const malformed of ['true', '2', '', 'yes']) {
			expect(getAuctionDleqRequired(buildAuctionEvent({ startAt: boundary + 1, dleqRequired: malformed }))).toBe(false)
		}
	})

	test('repeated tags: the first one wins (matches the parser’s single-tag read)', () => {
		const event = buildAuctionEvent({ startAt: boundary + 1, dleqRequired: '0' })
		event.tags.push(['dleq_required', '1'])
		expect(getAuctionDleqRequired(event)).toBe(false)
	})
})
