/**
 * Phase 6 — pure-logic tests for seller settlement.
 *
 * The full `publishAuctionSettlement` path involves NDK + a Cashu mint +
 * the seller's NIP-60 wallet — none of which are testable in a unit
 * harness. What IS testable, and what these tests cover, is the
 * non-I/O substrate the publisher composes on top of:
 *
 *   1. `buildSettlementTags` emits the right tag set for `status=settled`
 *      (winner / path_release / payout) and for `status=reserve_not_met`
 *      (no winner fields).
 *   2. `buildPathReleaseTags` propagates the new `cashu_token` tag.
 *   3. `parsePathReleaseEvent` round-trips `cashu_token` from event tags
 *      to the parsed object.
 *   4. The derivation invariant the publisher enforces — `derive(xpub,
 *      path) === bid.child_pubkey` — must match the same calculation
 *      done at lock time.
 *
 * If any of these break, the publisher cannot succeed regardless of
 * mint / NDK availability, so trapping them here is high-leverage.
 */

import { describe, expect, test } from 'bun:test'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { AUCTION_PATH_RELEASE_KIND } from '../auction/constants'
import { buildPathReleaseTags, buildSettlementTags } from '../auction/tagBuilders'
import { parsePathReleaseEvent } from '../schemas/auction/settlementEvents'
import { deriveAuctionChildP2pkPubkeyFromXpub } from '../auctionP2pk'

const REAL_AUCTION_XPUB =
	'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz'

const SELLER_PK = 'a'.repeat(64)
const BIDDER_PK = 'b'.repeat(64)
const AUCTION_ROOT = '1'.repeat(64)
const AUCTION_COORDINATE = `30408:${SELLER_PK}:auction-1`
const BID_EVENT_ID = '2'.repeat(64)
const PATH_RELEASE_EVENT_ID = '3'.repeat(64)

// ---------------------------------------------------------------------------
// buildSettlementTags — kind-1024 tag emission
// ---------------------------------------------------------------------------

describe('buildSettlementTags', () => {
	test('status=settled emits winner / path_release / payout tags', () => {
		const tags = buildSettlementTags({
			auctionRootEventId: AUCTION_ROOT,
			auctionCoordinate: AUCTION_COORDINATE,
			status: 'settled',
			closeAt: 1_700,
			finalAmount: 12_000,
			winningBidId: BID_EVENT_ID,
			winnerPubkey: BIDDER_PK,
			pathReleaseEventId: PATH_RELEASE_EVENT_ID,
			payouts: [{ bidEventId: BID_EVENT_ID, amount: 12_000, status: 'redeemed' }],
		})

		// Sanity: only one of each scalar tag.
		const tagsByKey = new Map<string, string[][]>()
		for (const t of tags) {
			const arr = tagsByKey.get(t[0]) ?? []
			arr.push(t)
			tagsByKey.set(t[0], arr)
		}

		expect(tagsByKey.get('e')?.[0]?.[1]).toBe(AUCTION_ROOT)
		expect(tagsByKey.get('a')?.[0]?.[1]).toBe(AUCTION_COORDINATE)
		expect(tagsByKey.get('status')?.[0]?.[1]).toBe('settled')
		expect(tagsByKey.get('close_at')?.[0]?.[1]).toBe('1700')
		expect(tagsByKey.get('final_amount')?.[0]?.[1]).toBe('12000')
		expect(tagsByKey.get('winning_bid')?.[0]?.[1]).toBe(BID_EVENT_ID)
		expect(tagsByKey.get('winner')?.[0]?.[1]).toBe(BIDDER_PK)
		expect(tagsByKey.get('path_release')?.[0]?.[1]).toBe(PATH_RELEASE_EVENT_ID)

		const payout = tagsByKey.get('payout')?.[0]
		expect(payout?.[1]).toBe(BID_EVENT_ID)
		expect(payout?.[2]).toBe('12000')
		expect(payout?.[3]).toBe('redeemed')
	})

	test('status=reserve_not_met omits winner / path_release tags', () => {
		const tags = buildSettlementTags({
			auctionRootEventId: AUCTION_ROOT,
			auctionCoordinate: AUCTION_COORDINATE,
			status: 'reserve_not_met',
			closeAt: 1_700,
			finalAmount: 0,
			reason: 'reserve_not_met',
		})

		const keys = tags.map((t) => t[0])
		expect(keys).toContain('status')
		expect(keys).toContain('final_amount')
		expect(keys).toContain('reason')
		expect(keys).not.toContain('winner')
		expect(keys).not.toContain('winning_bid')
		expect(keys).not.toContain('path_release')
		expect(keys).not.toContain('payout')

		expect(tags.find((t) => t[0] === 'status')?.[1]).toBe('reserve_not_met')
		expect(tags.find((t) => t[0] === 'final_amount')?.[1]).toBe('0')
		expect(tags.find((t) => t[0] === 'reason')?.[1]).toBe('reserve_not_met')
	})

	test('fallback_chain tags emit per entry', () => {
		const tags = buildSettlementTags({
			auctionRootEventId: AUCTION_ROOT,
			auctionCoordinate: AUCTION_COORDINATE,
			status: 'settled',
			closeAt: 1_700,
			finalAmount: 9_000,
			winningBidId: BID_EVENT_ID,
			winnerPubkey: BIDDER_PK,
			pathReleaseEventId: PATH_RELEASE_EVENT_ID,
			fallbackChain: [
				{ bidEventId: 'aa'.repeat(32), status: 'griefed' },
				{ bidEventId: BID_EVENT_ID, status: 'accepted' },
			],
		})

		const fbTags = tags.filter((t) => t[0] === 'fallback_chain')
		expect(fbTags).toHaveLength(2)
		expect(fbTags[0][1]).toBe('aa'.repeat(32))
		expect(fbTags[0][2]).toBe('griefed')
		expect(fbTags[1][1]).toBe(BID_EVENT_ID)
		expect(fbTags[1][2]).toBe('accepted')
	})
})

// ---------------------------------------------------------------------------
// buildPathReleaseTags — propagates cashu_token tag
// ---------------------------------------------------------------------------

describe('buildPathReleaseTags', () => {
	test('emits cashu_token tag when provided', () => {
		const path = 'm/1/2/3/4/5'
		const child = deriveAuctionChildP2pkPubkeyFromXpub(REAL_AUCTION_XPUB, path)
		const tags = buildPathReleaseTags({
			bidEventId: BID_EVENT_ID,
			auctionCoordinate: AUCTION_COORDINATE,
			sellerPubkey: SELLER_PK,
			derivationPath: path,
			childPubkey: child,
			releaseReason: 'settlement',
			cashuToken: 'cashuAfakeTokenForTest',
		})
		const tokenTag = tags.find((t) => t[0] === 'cashu_token')
		expect(tokenTag?.[1]).toBe('cashuAfakeTokenForTest')
	})

	test('omits cashu_token tag when absent (e.g. seed fixtures)', () => {
		const path = 'm/9/8/7/6/5'
		const child = deriveAuctionChildP2pkPubkeyFromXpub(REAL_AUCTION_XPUB, path)
		const tags = buildPathReleaseTags({
			bidEventId: BID_EVENT_ID,
			auctionCoordinate: AUCTION_COORDINATE,
			sellerPubkey: SELLER_PK,
			derivationPath: path,
			childPubkey: child,
			releaseReason: 'voluntary_late',
		})
		expect(tags.find((t) => t[0] === 'cashu_token')).toBeUndefined()
	})
})

// ---------------------------------------------------------------------------
// parsePathReleaseEvent — reads cashu_token from the event tags
// ---------------------------------------------------------------------------

const buildPathReleaseNdkEvent = (overrides: { tags?: string[][]; bidderPubkey?: string } = {}): NDKEvent => {
	const path = 'm/1/2/3/4/5'
	const child = deriveAuctionChildP2pkPubkeyFromXpub(REAL_AUCTION_XPUB, path)
	const tags = overrides.tags ?? [
		['e', BID_EVENT_ID],
		['a', AUCTION_COORDINATE],
		['p', SELLER_PK],
		['derivation_path', path],
		['child_pubkey', child],
		['release_reason', 'settlement'],
		['cashu_token', 'cashuAtokenForParserTest'],
	]
	return {
		id: PATH_RELEASE_EVENT_ID,
		pubkey: overrides.bidderPubkey ?? BIDDER_PK,
		kind: AUCTION_PATH_RELEASE_KIND as unknown as number,
		created_at: 1_700,
		tags,
		content: '',
	} as unknown as NDKEvent
}

describe('parsePathReleaseEvent', () => {
	test('round-trips cashu_token tag', () => {
		const event = buildPathReleaseNdkEvent()
		const parsed = parsePathReleaseEvent(event)
		if (!parsed.ok) throw new Error('expected parse success')
		expect(parsed.value.cashuToken).toBe('cashuAtokenForParserTest')
	})

	test('cashuToken absent when no tag present', () => {
		const path = 'm/1/2/3/4/5'
		const child = deriveAuctionChildP2pkPubkeyFromXpub(REAL_AUCTION_XPUB, path)
		const event = buildPathReleaseNdkEvent({
			tags: [
				['e', BID_EVENT_ID],
				['a', AUCTION_COORDINATE],
				['p', SELLER_PK],
				['derivation_path', path],
				['child_pubkey', child],
				['release_reason', 'voluntary_late'],
			],
		})
		const parsed = parsePathReleaseEvent(event)
		if (!parsed.ok) throw new Error('expected parse success')
		expect(parsed.value.cashuToken).toBeUndefined()
	})
})

// ---------------------------------------------------------------------------
// Derivation invariant — the publisher's central correctness check
// ---------------------------------------------------------------------------

describe('publishAuctionSettlement — derivation invariant', () => {
	test('honest path: derive(xpub, path) matches bid.child_pubkey', () => {
		const path = 'm/9/8/7/6/5'
		const childAtLockTime = deriveAuctionChildP2pkPubkeyFromXpub(REAL_AUCTION_XPUB, path)
		// At settlement, the seller re-derives from the same (xpub, path)
		// and compares against the bid's child_pubkey tag.
		const childAtSettlement = deriveAuctionChildP2pkPubkeyFromXpub(REAL_AUCTION_XPUB, path)
		expect(childAtSettlement).toBe(childAtLockTime)
	})

	test('fraudulent path: derive(xpub, path) does NOT match an arbitrary pubkey', () => {
		const path = 'm/9/8/7/6/5'
		const derived = deriveAuctionChildP2pkPubkeyFromXpub(REAL_AUCTION_XPUB, path)
		const tamperedChildPubkey = '02' + 'c'.repeat(64)
		expect(derived).not.toBe(tamperedChildPubkey)
	})
})
