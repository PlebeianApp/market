import { describe, test, expect, beforeEach } from 'bun:test'
import {
	countParticipants,
	getIntervalMs,
	getLookbackDays,
	getPathIssuerFilter,
	resetDedupMap,
	getDedupMap,
	pollAndUpdateLiveActivities,
} from '../live-activity-worker'
import type { LiveActivityStatus } from '../../../src/lib/nip53'

describe('countParticipants', () => {
	test('returns zero for empty messages', () => {
		const result = countParticipants([], 1000)
		expect(result.current).toBe(0)
		expect(result.total).toBe(0)
	})

	test('counts unique authors as total', () => {
		const messages = [
			{ pubkey: 'aaa', created_at: 900 },
			{ pubkey: 'bbb', created_at: 950 },
			{ pubkey: 'aaa', created_at: 980 },
		]
		const result = countParticipants(messages, 1000)
		expect(result.total).toBe(2)
	})

	test('counts recent authors as current (within 300s window)', () => {
		const now = 1000
		const messages = [
			{ pubkey: 'aaa', created_at: now - 100 },
			{ pubkey: 'bbb', created_at: now - 200 },
			{ pubkey: 'ccc', created_at: now - 400 },
		]
		const result = countParticipants(messages, now)
		expect(result.current).toBe(2)
		expect(result.total).toBe(3)
	})

	test('all authors are recent when within window', () => {
		const now = 1000
		const messages = [
			{ pubkey: 'aaa', created_at: now - 10 },
			{ pubkey: 'bbb', created_at: now - 50 },
		]
		const result = countParticipants(messages, now)
		expect(result.current).toBe(2)
		expect(result.total).toBe(2)
	})

	test('no current authors when all outside window', () => {
		const now = 1000
		const messages = [
			{ pubkey: 'aaa', created_at: now - 500 },
			{ pubkey: 'bbb', created_at: now - 600 },
		]
		const result = countParticipants(messages, now)
		expect(result.current).toBe(0)
		expect(result.total).toBe(2)
	})
})

describe('configuration', () => {
	test('getIntervalMs returns default 60000', () => {
		delete process.env.LIVE_ACTIVITY_INTERVAL_MS
		expect(getIntervalMs()).toBe(60000)
	})

	test('getIntervalMs reads from env', () => {
		process.env.LIVE_ACTIVITY_INTERVAL_MS = '30000'
		expect(getIntervalMs()).toBe(30000)
		delete process.env.LIVE_ACTIVITY_INTERVAL_MS
	})

	test('getLookbackDays returns default 7', () => {
		delete process.env.LIVE_ACTIVITY_LOOKBACK_DAYS
		expect(getLookbackDays()).toBe(7)
	})

	test('getLookbackDays reads from env', () => {
		process.env.LIVE_ACTIVITY_LOOKBACK_DAYS = '14'
		expect(getLookbackDays()).toBe(14)
		delete process.env.LIVE_ACTIVITY_LOOKBACK_DAYS
	})

	test('getPathIssuerFilter returns undefined by default', () => {
		delete process.env.LIVE_ACTIVITY_PATH_ISSUER_FILTER
		expect(getPathIssuerFilter()).toBeUndefined()
	})

	test('getPathIssuerFilter reads from env', () => {
		process.env.LIVE_ACTIVITY_PATH_ISSUER_FILTER = 'abc123'
		expect(getPathIssuerFilter()).toBe('abc123')
		delete process.env.LIVE_ACTIVITY_PATH_ISSUER_FILTER
	})
})

describe('dedupMap', () => {
	beforeEach(() => {
		resetDedupMap()
	})

	test('starts empty', () => {
		expect(getDedupMap().size).toBe(0)
	})

	test('entries can be set and retrieved', () => {
		const map = getDedupMap()
		map.set('test-auction', {
			status: 'live' as LiveActivityStatus,
			currentParticipants: 5,
			totalParticipants: 10,
			updatedAt: 1000,
		})
		expect(map.get('test-auction')?.status).toBe('live')
		expect(map.get('test-auction')?.currentParticipants).toBe(5)
	})

	test('resetDedupMap clears entries', () => {
		getDedupMap().set('test', {
			status: 'ended',
			currentParticipants: 0,
			totalParticipants: 1,
			updatedAt: 2000,
		})
		resetDedupMap()
		expect(getDedupMap().size).toBe(0)
	})
})

describe('pollAndUpdateLiveActivities', () => {
	const mockNdk = {
		fetchEvents: async () => new Set(),
		pool: { connectedRelays: () => [] },
	}
	const mockSigner = {
		sign: async () => {},
		user: async () => ({ pubkey: 'cvm-pubkey' }),
		blockUntilReady: async () => {},
		privateKey: 'test-key',
	}
	const mockStateStore = {
		enforcePathRequestRateLimit: () => {},
		close: () => {},
	}

	function makeCtx(overrides: Record<string, any> = {}): any {
		return {
			ndk: { ...mockNdk, ...overrides.ndk },
			signer: { ...mockSigner, ...overrides.signer },
			issuerPubkey: 'cvm-pubkey',
			stateStore: { ...mockStateStore, ...overrides.stateStore },
		}
	}

	beforeEach(() => {
		resetDedupMap()
	})

	test('returns errors=1 when fetchEvents throws', async () => {
		const ctx = makeCtx({
			ndk: {
				fetchEvents: async () => {
					throw new Error('relay down')
				},
				pool: { connectedRelays: () => [] },
			},
		})
		const result = await pollAndUpdateLiveActivities(ctx)
		expect(result.errors).toBe(1)
		expect(result.checked).toBe(0)
	})

	test('skips auctions with no d tag', async () => {
		const mockAuction = {
			pubkey: 'seller1',
			tags: [['title', 'No d tag auction']],
			created_at: 1000,
		}
		const ctx = makeCtx({
			ndk: {
				fetchEvents: async () => new Set([mockAuction]),
				pool: { connectedRelays: () => [] },
			},
		})
		const result = await pollAndUpdateLiveActivities(ctx)
		expect(result.checked).toBe(1)
		expect(result.created).toBe(0)
	})

	test('creates live activity for new auction', async () => {
		const now = Math.floor(Date.now() / 1000)
		const mockAuction = {
			pubkey: 'seller1',
			tags: [
				['d', 'auction-123'],
				['title', 'Test Auction'],
				['summary', 'A test'],
				['start_at', String(now + 3600)],
				['max_end_at', String(now + 7200)],
			],
			created_at: now,
		}
		const published: any[] = []
		const ctx = makeCtx({
			ndk: {
				fetchEvents: async (filter: any) => {
					if (filter.kinds?.[0] === 30408) return new Set([mockAuction])
					return new Set()
				},
				pool: { connectedRelays: () => [] },
			},
		})

		const result = await pollAndUpdateLiveActivities(ctx, {
			publishOverride: async (params) => {
				published.push(params)
			},
		})
		expect(result.checked).toBe(1)
		expect(result.created).toBe(1)
		expect(published.length).toBe(1)
		expect(published[0].status).toBe('planned')
		expect(published[0].dTag).toBe('auction-123')
		expect(published[0].sellerPubkey).toBe('seller1')
		expect(typeof published[0].currentParticipants).toBe('number')
		expect(typeof published[0].totalParticipants).toBe('number')
	})

	test('updates live activity when status changes', async () => {
		const now = Math.floor(Date.now() / 1000)
		const mockAuction = {
			pubkey: 'seller1',
			tags: [
				['d', 'auction-456'],
				['title', 'Test Auction'],
				['start_at', String(now - 3600)],
				['max_end_at', String(now + 3600)],
			],
			created_at: now - 7200,
		}
		const existingLiveActivity = {
			pubkey: 'cvm-pubkey',
			kind: 30311,
			tags: [
				['d', 'auction-456'],
				['status', 'planned'],
			],
			created_at: now - 7200,
		}

		resetDedupMap()
		getDedupMap().set('auction-456', {
			status: 'planned',
			currentParticipants: 0,
			totalParticipants: 0,
			updatedAt: now - 7200,
		})

		const published: any[] = []
		const ctx = makeCtx({
			ndk: {
				fetchEvents: async (filter: any) => {
					if (filter.kinds?.[0] === 30408) return new Set([mockAuction])
					if (filter.kinds?.[0] === 30311) return new Set([existingLiveActivity])
					if (filter.kinds?.[0] === 1311) return new Set()
					return new Set()
				},
				pool: { connectedRelays: () => [] },
			},
		})

		const result = await pollAndUpdateLiveActivities(ctx, {
			publishOverride: async (params) => {
				published.push(params)
			},
		})
		expect(result.checked).toBe(1)
		expect(result.updated).toBe(1)
		expect(published.length).toBe(1)
		expect(published[0].status).toBe('live')
	})

	test('skips when status and participants unchanged', async () => {
		const now = Math.floor(Date.now() / 1000)
		const mockAuction = {
			pubkey: 'seller1',
			tags: [
				['d', 'auction-789'],
				['title', 'Test'],
				['start_at', String(now - 100)],
				['max_end_at', String(now + 3600)],
			],
			created_at: now - 7200,
		}

		resetDedupMap()
		getDedupMap().set('auction-789', {
			status: 'live',
			currentParticipants: 0,
			totalParticipants: 0,
			updatedAt: now,
		})

		const published: any[] = []
		const ctx = makeCtx({
			ndk: {
				fetchEvents: async (filter: any) => {
					if (filter.kinds?.[0] === 30408) return new Set([mockAuction])
					return new Set()
				},
				pool: { connectedRelays: () => [] },
			},
		})

		const result = await pollAndUpdateLiveActivities(ctx, {
			publishOverride: async (params) => {
				published.push(params)
			},
		})
		expect(result.skipped).toBe(1)
		expect(result.updated).toBe(0)
		expect(result.created).toBe(0)
		expect(published.length).toBe(0)
	})
})
