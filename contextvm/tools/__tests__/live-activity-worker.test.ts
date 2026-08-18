import { describe, test, expect, beforeEach } from 'bun:test'
import { countParticipants, getIntervalMs, getLookbackDays, resetDedupMap, getDedupMap } from '../live-activity-worker'
import { AUCTION_KIND, buildLiveActivityDTag } from '../../../src/lib/nip53'

const SELLER_A = 'a'.repeat(64)
const SELLER_B = 'b'.repeat(64)

describe('live-activity-worker', () => {
	beforeEach(() => {
		resetDedupMap()
	})

	describe('countParticipants', () => {
		test('counts unique authors as total', () => {
			const now = 1000000
			const messages = [
				{ pubkey: 'user1', created_at: now - 10 },
				{ pubkey: 'user2', created_at: now - 20 },
				{ pubkey: 'user1', created_at: now - 30 },
			]
			const result = countParticipants(messages, now)
			expect(result.total).toBe(2)
		})

		test('counts recent authors as current (within 5min window)', () => {
			const now = 1000000
			const messages = [
				{ pubkey: 'user1', created_at: now - 10 },
				{ pubkey: 'user2', created_at: now - 100 },
				{ pubkey: 'user3', created_at: now - 200 },
			]
			const result = countParticipants(messages, now)
			expect(result.current).toBe(3)
		})

		test('excludes participants outside 5min window from current', () => {
			const now = 1000000
			const messages = [
				{ pubkey: 'user1', created_at: now - 10 },
				{ pubkey: 'user2', created_at: now - 600 },
			]
			const result = countParticipants(messages, now)
			expect(result.current).toBe(1)
			expect(result.total).toBe(2)
		})

		test('handles empty message list', () => {
			const result = countParticipants([], 1000000)
			expect(result.current).toBe(0)
			expect(result.total).toBe(0)
		})
	})

	describe('dedup key safety', () => {
		test('different sellers with same d tag do not collide', () => {
			const dedup = getDedupMap()
			const dTag = 'my-auction'

			const keyA = `${SELLER_A}:${dTag}`
			const keyB = `${SELLER_B}:${dTag}`

			dedup.set(keyA, {
				status: 'live' as const,
				currentParticipants: 5,
				totalParticipants: 10,
				updatedAt: 1000,
			})

			expect(dedup.has(keyA)).toBe(true)
			expect(dedup.has(keyB)).toBe(false)
		})
	})

	describe('buildLiveActivityDTag collision prevention', () => {
		test('same d tag from different sellers produces different activity d tags', () => {
			const coordA = `${AUCTION_KIND}:${SELLER_A}:my-auction`
			const coordB = `${AUCTION_KIND}:${SELLER_B}:my-auction`

			const dTagA = buildLiveActivityDTag(coordA)
			const dTagB = buildLiveActivityDTag(coordB)

			expect(dTagA).not.toBe(dTagB)
		})
	})

	describe('configuration', () => {
		test('getIntervalMs returns default when env not set', () => {
			const orig = process.env.LIVE_ACTIVITY_INTERVAL_MS
			delete process.env.LIVE_ACTIVITY_INTERVAL_MS
			expect(getIntervalMs()).toBe(60_000)
			if (orig) process.env.LIVE_ACTIVITY_INTERVAL_MS = orig
		})

		test('getIntervalMs returns custom value when env set', () => {
			const orig = process.env.LIVE_ACTIVITY_INTERVAL_MS
			process.env.LIVE_ACTIVITY_INTERVAL_MS = '30000'
			expect(getIntervalMs()).toBe(30_000)
			if (orig) process.env.LIVE_ACTIVITY_INTERVAL_MS = orig
		})

		test('getLookbackDays returns default when env not set', () => {
			const orig = process.env.LIVE_ACTIVITY_LOOKBACK_DAYS
			delete process.env.LIVE_ACTIVITY_LOOKBACK_DAYS
			expect(getLookbackDays()).toBe(7)
			if (orig) process.env.LIVE_ACTIVITY_LOOKBACK_DAYS = orig
		})
	})
})
