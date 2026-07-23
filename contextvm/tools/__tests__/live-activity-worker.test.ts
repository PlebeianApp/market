import { describe, test, expect, beforeEach } from 'bun:test'
import {
	countParticipants,
	getIntervalMs,
	getLookbackDays,
	resetDedupMap,
	getDedupMap,
	scheduleAuctionEnd,
	clearEndTimers,
	getEndTimers,
	NEUTRAL_END_MESSAGE,
	pollAndUpdateLiveActivities,
} from '../live-activity-worker'
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
				commentatorDelivered: false,
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

	describe('countParticipants excludes system author', () => {
		test('excludes provided pubkeys from both current and total', () => {
			const now = 1000000
			const cvm = 'cvm'.repeat(16).padEnd(64, '0').slice(0, 64)
			const messages = [
				{ pubkey: 'user1', created_at: now - 10 },
				{ pubkey: cvm, created_at: now - 5 },
				{ pubkey: 'user2', created_at: now - 20 },
				{ pubkey: cvm, created_at: now - 30 },
			]
			const result = countParticipants(messages, now, [cvm])
			expect(result.total).toBe(2)
			expect(result.current).toBe(2)
		})

		test('no exclusion param behaves like before', () => {
			const now = 1000000
			const messages = [
				{ pubkey: 'user1', created_at: now - 10 },
				{ pubkey: 'user2', created_at: now - 20 },
			]
			expect(countParticipants(messages, now).total).toBe(2)
		})
	})

	describe('NEUTRAL_END_MESSAGE', () => {
		test('is a neutral message without winner or price assertions', () => {
			expect(NEUTRAL_END_MESSAGE).toBe('🏁 Bidding closed; settlement pending.')
			expect(NEUTRAL_END_MESSAGE).not.toContain('Won by')
			expect(NEUTRAL_END_MESSAGE).not.toContain('sats')
		})
	})

	describe('scheduleAuctionEnd', () => {
		const fakeCtx = { relayPool: {}, signer: {}, issuerPubkey: 'issuer' } as never

		beforeEach(() => {
			clearEndTimers()
		})

		test('returns 0 and registers nothing when maxEndAt is in the past', () => {
			const past = Math.floor(Date.now() / 1000) - 100
			expect(scheduleAuctionEnd(fakeCtx, 'k1', past)).toBe(0)
			expect(getEndTimers().size).toBe(0)
		})

		test('schedules a timer when maxEndAt is in the future', () => {
			const future = Math.floor(Date.now() / 1000) + 60
			const delay = scheduleAuctionEnd(fakeCtx, 'k2', future)
			expect(delay).toBeGreaterThan(0)
			expect(getEndTimers().has('k2')).toBe(true)
			clearEndTimers()
			expect(getEndTimers().size).toBe(0)
		})

		test('does not double-schedule for the same key', () => {
			const future = Math.floor(Date.now() / 1000) + 120
			scheduleAuctionEnd(fakeCtx, 'k3', future)
			const second = scheduleAuctionEnd(fakeCtx, 'k3', future)
			expect(second).toBe(0)
			expect(getEndTimers().size).toBe(1)
		})
	})

	describe('single-flight guard (pollAndUpdateLiveActivities)', () => {
		test('concurrent triggers execute the underlying poll body once', async () => {
			let subscribeCallCount = 0

			const mockCtx = {
				relayPool: {
					subscribe: (_filters: unknown, _onEvent: unknown, onEose: () => void) => {
						subscribeCallCount++
						// Immediately signal EOSE so the fetch resolves with no events
						onEose()
						return Promise.resolve(() => {})
					},
					getRelayUrls: () => [],
					publish: () => Promise.resolve(),
				},
				signer: { signEvent: () => Promise.resolve({}) },
				issuerPubkey: 'a'.repeat(64),
			} as never

			// Fire two concurrent calls
			const [result1, result2] = await Promise.all([
				pollAndUpdateLiveActivities(mockCtx),
				pollAndUpdateLiveActivities(mockCtx),
			])

			// The underlying relay subscribe (poll body) executed exactly once
			expect(subscribeCallCount).toBe(1)

			// Both callers received a valid result
			expect(result1).toBeDefined()
			expect(result2).toBeDefined()
			expect(result1).toEqual(result2)
		})
	})
})
