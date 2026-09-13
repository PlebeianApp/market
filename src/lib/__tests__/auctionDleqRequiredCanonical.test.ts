import { describe, expect, test } from 'bun:test'
import {
	APP_AUCTION_DLEQ_ROLLOUT_START_AT,
	DLEQ_REQUIRED_TAG,
	readDleqRequiredTag,
	resolveDleqRequired,
} from '../auction/constants'
import { auctionImmutableFieldsMatch } from '../auction/immutability'
import type { NostrEventLike } from '../nostr/eventLike'

/**
 * Review A1 / B2 (PlebeianApp/market#1280, review by @maximotodev) — the
 * `dleq_required` tag needs ONE immutable, strict protocol meaning.
 *
 * Semantics pinned here (ADR-0011 Decision 8 amendment):
 *
 *   - exactly one `dleq_required` tag, exactly one value, value exactly
 *     `"1"` or `"0"` → canonical, and authoritative for BOTH directions
 *     (`"1"` requires DLEQ; `"0"` is the seller's explicit, signed opt-out,
 *     legal at any `start_at` because it is visible to bidders before they
 *     bid and it is immutable).
 *   - absent → legacy event: fall back to the `start_at` rollout boundary.
 *   - ANYTHING ELSE (duplicate tags, empty value, a missing value, extra
 *     values, an unexpected string) → non-canonical → FAIL CLOSED to
 *     "DLEQ required". A malformed tag must never silently mean "not
 *     required", and the result must not depend on tag order.
 */

const boundary = APP_AUCTION_DLEQ_ROLLOUT_START_AT
const POST_ROLLOUT = boundary + 1
const PRE_ROLLOUT = boundary - 1

const tagsWith = (...values: Array<string | undefined>): string[][] =>
	values.map((value) => (value === undefined ? [DLEQ_REQUIRED_TAG] : [DLEQ_REQUIRED_TAG, value]))

const bidderTags = (tags: string[][]) => tags

describe('readDleqRequiredTag — strict canonical parse (review A1)', () => {
	test('a single canonical "1" is canonical/required', () => {
		expect(readDleqRequiredTag(tagsWith('1'))).toEqual({ kind: 'canonical', required: true })
	})

	test('a single canonical "0" is canonical/not-required', () => {
		expect(readDleqRequiredTag(tagsWith('0'))).toEqual({ kind: 'canonical', required: false })
	})

	test('an absent tag is reported as absent (legacy), never as "0"', () => {
		expect(readDleqRequiredTag([['start_at', '1']])).toEqual({ kind: 'absent' })
	})

	test('duplicate tags are non-canonical regardless of value order', () => {
		expect(readDleqRequiredTag(tagsWith('1', '0'))).toEqual({ kind: 'non-canonical', reason: 'duplicate' })
		expect(readDleqRequiredTag(tagsWith('0', '1'))).toEqual({ kind: 'non-canonical', reason: 'duplicate' })
	})

	test('duplicate tags with identical values are still non-canonical', () => {
		expect(readDleqRequiredTag(tagsWith('1', '1'))).toEqual({ kind: 'non-canonical', reason: 'duplicate' })
		expect(readDleqRequiredTag(tagsWith('0', '0'))).toEqual({ kind: 'non-canonical', reason: 'duplicate' })
	})

	test('an empty value, a missing value, or extra values are non-canonical', () => {
		expect(readDleqRequiredTag(tagsWith(''))).toEqual({ kind: 'non-canonical', reason: 'empty' })
		expect(readDleqRequiredTag(tagsWith(undefined))).toEqual({ kind: 'non-canonical', reason: 'empty' })
		expect(readDleqRequiredTag(bidderTags([[DLEQ_REQUIRED_TAG, '1', '0']]))).toEqual({ kind: 'non-canonical', reason: 'multi-value' })
		expect(readDleqRequiredTag(bidderTags([[DLEQ_REQUIRED_TAG, '1', 'extra']]))).toEqual({ kind: 'non-canonical', reason: 'multi-value' })
	})

	test('any unexpected value is non-canonical (never a silent opt-out)', () => {
		for (const value of ['true', '2', '01', 'yes', 'false', 'TRUE', ' ', 'null']) {
			expect(readDleqRequiredTag(tagsWith(value))).toEqual({ kind: 'non-canonical', reason: 'unexpected-value' })
		}
	})
})

describe('resolveDleqRequired — fail-closed resolution (review A1)', () => {
	test('canonical "1" requires DLEQ at any start_at', () => {
		expect(resolveDleqRequired(tagsWith('1'), POST_ROLLOUT)).toBe(true)
		expect(resolveDleqRequired(tagsWith('1'), PRE_ROLLOUT)).toBe(true)
	})

	test('canonical "0" is authoritative at any start_at (explicit signed opt-out)', () => {
		expect(resolveDleqRequired(tagsWith('0'), POST_ROLLOUT)).toBe(false)
		expect(resolveDleqRequired(tagsWith('0'), PRE_ROLLOUT)).toBe(false)
	})

	test('an absent tag falls back to the start_at rollout boundary (legacy)', () => {
		expect(resolveDleqRequired([['d', 'x']], PRE_ROLLOUT)).toBe(false)
		expect(resolveDleqRequired([['d', 'x']], POST_ROLLOUT)).toBe(true)
	})

	test('non-canonical forms fail closed to required at any start_at', () => {
		const nonCanonical: string[][] = [
			tagsWith('1', '0'),
			tagsWith('0', '1'),
			tagsWith('1', '1'),
			tagsWith('0', '0'),
			tagsWith(''),
			tagsWith(undefined),
			[[DLEQ_REQUIRED_TAG, '1', '0']],
			tagsWith('yes'),
			tagsWith('2'),
		]
		for (const tags of nonCanonical) {
			expect(resolveDleqRequired(tags, POST_ROLLOUT)).toBe(true)
			expect(resolveDleqRequired(tags, PRE_ROLLOUT)).toBe(true)
		}
	})

	test('resolution never depends on relay tag order for conflicting duplicates', () => {
		const forward = resolveDleqRequired(tagsWith('1', '0'), POST_ROLLOUT)
		const backward = resolveDleqRequired(tagsWith('0', '1'), POST_ROLLOUT)
		expect(forward).toBe(backward)
		expect(forward).toBe(true)
	})
})

describe('dleq_required is immutable across kind-30408 replacements (review A1)', () => {
	const auctionEvent = (tags: string[][]): NostrEventLike =>
		({
			id: '1'.repeat(64),
			kind: 30408,
			pubkey: 'a'.repeat(64),
			created_at: 1_000,
			content: '',
			tags,
		}) as NostrEventLike

	const BASE_TAGS: string[][] = [
		['d', 'auction-test'],
		['start_at', String(POST_ROLLOUT)],
		['currency', 'SAT'],
	]

	test('a replacement that flips dleq_required 1 -> 0 is rejected', () => {
		const root = auctionEvent([...BASE_TAGS, [DLEQ_REQUIRED_TAG, '1']])
		const replacement = auctionEvent([...BASE_TAGS, ['title', 'updated'], [DLEQ_REQUIRED_TAG, '0']])
		expect(auctionImmutableFieldsMatch(root, replacement)).toBe(false)
	})

	test('a replacement that drops dleq_required is rejected', () => {
		const root = auctionEvent([...BASE_TAGS, [DLEQ_REQUIRED_TAG, '1']])
		const replacement = auctionEvent([...BASE_TAGS, ['title', 'updated']])
		expect(auctionImmutableFieldsMatch(root, replacement)).toBe(false)
	})

	test('a replacement that adds dleq_required is rejected', () => {
		const root = auctionEvent(BASE_TAGS)
		const replacement = auctionEvent([...BASE_TAGS, [DLEQ_REQUIRED_TAG, '0']])
		expect(auctionImmutableFieldsMatch(root, replacement)).toBe(false)
	})

	test('a replacement that leaves dleq_required unchanged is allowed', () => {
		const root = auctionEvent([...BASE_TAGS, [DLEQ_REQUIRED_TAG, '1']])
		const replacement = auctionEvent([...BASE_TAGS, ['title', 'updated'], [DLEQ_REQUIRED_TAG, '1']])
		expect(auctionImmutableFieldsMatch(root, replacement)).toBe(true)
	})
})
