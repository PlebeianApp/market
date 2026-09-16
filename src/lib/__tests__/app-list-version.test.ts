import { describe, expect, test } from 'bun:test'
import { nextAppListVersion, readAppListVersion, selectPreferredAppListEvent } from '@/lib/nostr/appListVersion'

/**
 * Ordering contract for app-owned list events (admins / editors / blacklist /
 * app settings).
 *
 * The pre-hardening rule was `created_at` DESC only. A copy published by a
 * relay whose clock is skewed forward could then outrank the real latest
 * revision forever. The authoritative ordering therefore prefers a monotonic
 * `['version', '<n>']` tag when both copies carry one, and keeps the legacy
 * `created_at` (then lowest event id, per NIP-01) rule otherwise — so an
 * unversioned publish still wins on freshness and legacy events stay readable.
 *
 * These tests pin each branch of that rule, plus arrival-order independence:
 * the winner must not depend on the order the relays answered in.
 */

interface Candidate {
	label: string
	tags: string[][]
	created_at: number
	id: string
}

/** An app-owned list event carrying `d` plus an optional monotonic version tag. */
const candidate = (label: string, created_at: number, id: string, version?: number): Candidate => ({
	label,
	created_at,
	id,
	tags:
		version === undefined
			? [['d', 'admins']]
			: [
					['d', 'admins'],
					['version', String(version)],
				],
})

const winner = (events: Candidate[]): string | undefined => selectPreferredAppListEvent(events)?.label

describe('readAppListVersion', () => {
	test('reads the numeric value of a version tag', () => {
		expect(readAppListVersion(candidate('a', 1, 'aa', 7))).toBe(7)
	})

	test('returns undefined when no version tag is present', () => {
		expect(
			readAppListVersion({
				tags: [
					['d', 'admins'],
					['p', 'ab'.repeat(32)],
				],
			}),
		).toBeUndefined()
	})

	test('returns undefined for a non-numeric version value', () => {
		expect(readAppListVersion({ tags: [['version', 'not-a-number']] })).toBeUndefined()
	})

	test('ignores malformed leading version tags and takes the first parseable one', () => {
		expect(
			readAppListVersion({
				tags: [
					['version', ''],
					['version', '4'],
				],
			}),
		).toBe(4)
	})

	test('tolerates surrounding whitespace and is case-sensitive on the tag name', () => {
		expect(readAppListVersion({ tags: [['version', ' 3 ']] })).toBe(3)
		expect(readAppListVersion({ tags: [['Version', '3']] })).toBeUndefined()
	})

	test('handles events without tags (relay junk) without throwing', () => {
		expect(readAppListVersion({})).toBeUndefined()
	})
})

describe('nextAppListVersion', () => {
	test('starts at 1 when the current list carries no version', () => {
		expect(nextAppListVersion(undefined)).toBe(1)
	})

	test('is strictly monotonic', () => {
		expect(nextAppListVersion(1)).toBe(2)
		expect(nextAppListVersion(41)).toBe(42)
	})

	test('never returns a non-positive version', () => {
		expect(nextAppListVersion(0)).toBe(1)
	})
})

describe('selectPreferredAppListEvent', () => {
	test('returns undefined for no candidates', () => {
		expect(selectPreferredAppListEvent([])).toBeUndefined()
	})

	test('returns the only candidate', () => {
		expect(winner([candidate('only', 10, 'aa')])).toBe('only')
	})

	test('prefers the higher version even when its created_at is much older', () => {
		const stale = candidate('versioned-latest', 1_000, 'aa', 9)
		const clockSkewed = candidate('clock-skewed-earlier-revision', 9_999_999, 'bb', 3)
		expect(winner([stale, clockSkewed])).toBe('versioned-latest')
		expect(winner([clockSkewed, stale])).toBe('versioned-latest')
	})

	test('falls back to created_at when both candidates carry a version', () => {
		const older = candidate('older', 1_000, 'aa', 4)
		const newer = candidate('newer', 2_000, 'bb', 4)
		expect(winner([older, newer])).toBe('newer')
	})

	test('falls back to created_at when neither candidate carries a version', () => {
		const older = candidate('older', 1_000, 'aa')
		const newer = candidate('newer', 2_000, 'bb')
		expect(winner([older, newer])).toBe('newer')
		expect(winner([newer, older])).toBe('newer')
	})

	test('does not let a version tag outrank an unversioned copy on version alone', () => {
		// Mixed comparison keeps the legacy rule: a newer unversioned publish
		// (e.g. from a path that does not stamp the tag yet) must still win.
		const unversioned = candidate('unversioned-newer', 5_000, 'aa')
		const versioned = candidate('versioned-older', 1_000, 'bb', 12)
		expect(winner([unversioned, versioned])).toBe('unversioned-newer')
		expect(winner([versioned, unversioned])).toBe('unversioned-newer')
	})

	test('breaks a created_at tie with the lowest event id (NIP-01)', () => {
		const low = candidate('low-id', 1_000, 'aa')
		const high = candidate('high-id', 1_000, 'bb')
		expect(winner([high, low])).toBe('low-id')
	})

	test('breaks a version tie with the lowest event id (NIP-01)', () => {
		const low = candidate('low-id', 1_000, 'aa', 2)
		const high = candidate('high-id', 1_000, 'bb', 2)
		expect(winner([high, low])).toBe('low-id')
	})

	test('is independent of relay arrival order', () => {
		const copies = [
			candidate('a', 1_000, 'aa', 1),
			candidate('winner', 500, 'bb', 5),
			candidate('c', 9_000, 'cc', 2),
			candidate('d', 9_000, 'dd'),
		]
		const permutations = [
			[0, 1, 2, 3],
			[3, 2, 1, 0],
			[1, 0, 3, 2],
			[2, 3, 0, 1],
			[1, 3, 2, 0],
			[3, 1, 0, 2],
		]
		for (const order of permutations) {
			expect(winner(order.map((index) => copies[index]))).toBe('winner')
		}
	})
})

/**
 * The ordering rule is shared, but each of the four authority reads carries its
 * own kind + identifier shape: admin list (kind 30000, `d=admins`), editor list
 * (kind 30000, `d=editors`), blacklist (kind 10000, no `d`), app settings
 * (kind 31990, `d=plebeian-market-handler`). Pinning the shapes here means a
 * refactor that special-cases one kind cannot silently drop the others.
 */
describe('stale-vs-newer selection per authority kind', () => {
	const authorityLists = [
		{ name: 'admin list', kind: 30000, tags: [['d', 'admins']] },
		{ name: 'editor list', kind: 30000, tags: [['d', 'editors']] },
		{ name: 'blacklist', kind: 10000, tags: [] },
		{ name: 'app settings', kind: 31990, tags: [['d', 'plebeian-market-handler']] },
	]

	for (const { name, tags } of authorityLists) {
		test(`${name}: a clock-skewed newer copy loses to the higher version`, () => {
			const latestRevision = { label: 'latest-revision', created_at: 1_000, id: 'aa', tags: [...tags, ['version', '9']] }
			const clockSkewedStale = { label: 'stale-revision', created_at: 9_999_999, id: 'bb', tags: [...tags, ['version', '3']] }

			expect(selectPreferredAppListEvent([latestRevision, clockSkewedStale])?.label).toBe('latest-revision')
			expect(selectPreferredAppListEvent([clockSkewedStale, latestRevision])?.label).toBe('latest-revision')
		})

		test(`${name}: still latest-wins on created_at when neither copy is versioned`, () => {
			const older = { label: 'older', created_at: 1_000, id: 'aa', tags: [...tags] }
			const newer = { label: 'newer', created_at: 2_000, id: 'bb', tags: [...tags] }

			expect(selectPreferredAppListEvent([older, newer])?.label).toBe('newer')
			expect(selectPreferredAppListEvent([newer, older])?.label).toBe('newer')
		})
	}
})
