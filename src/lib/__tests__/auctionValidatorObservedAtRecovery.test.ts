import { describe, expect, test } from 'bun:test'
import type { NostrEvent } from 'nostr-tools'
import { buildObservedAtSeed, recoverObservedAt } from '../../server/auction-validator/observedAtRecovery'

const VALIDATOR_PK = 'd'.repeat(64)
const BIDDER_PK = 'b'.repeat(64)
const AUCTION_ROOT = '1'.repeat(64)

/** Build a raw kind-30440 verdict event with explicit tags. */
const buildVerdictEvent = (overrides: { bidEventId: string; observedAt: number; createdAt?: number; claim?: string }): NostrEvent => {
	const bid = overrides.bidEventId
	const dTag = `${BIDDER_PK}:${AUCTION_ROOT}:${bid}`
	return {
		id: 'v' + bid.slice(0, 63),
		kind: 30440,
		pubkey: VALIDATOR_PK,
		created_at: overrides.createdAt ?? overrides.observedAt,
		tags: [
			['d', dTag],
			['p', BIDDER_PK],
			['a', `30408:${'a'.repeat(64)}:auction-test`],
			['e', AUCTION_ROOT],
			['bid', bid],
			['claim', overrides.claim ?? 'valid_bid_placed'],
			['observed_at', String(overrides.observedAt)],
		],
		content: '{}',
		sig: 's'.repeat(128),
	} as NostrEvent
}

describe('buildObservedAtSeed', () => {
	test('seeds observed_at = the earliest verdict observed_at per bid', () => {
		// Bid A has two verdicts: a later upgrade (won_pending_settlement) at
		// observed_at=1_500 and the original valid_bid_placed at observed_at=1_500.
		// Both carry the same first-observation stamp; the seed takes the min.
		const events = [
			buildVerdictEvent({ bidEventId: 'a'.repeat(64), observedAt: 1_500, claim: 'valid_bid_placed' }),
			buildVerdictEvent({ bidEventId: 'a'.repeat(64), observedAt: 1_500, claim: 'won_pending_settlement' }),
			buildVerdictEvent({ bidEventId: 'b'.repeat(64), observedAt: 1_520 }),
		]
		const seed = buildObservedAtSeed(events)
		expect(seed.size).toBe(2)
		expect(seed.get('a'.repeat(64))).toBe(1_500)
		expect(seed.get('b'.repeat(64))).toBe(1_520)
	})

	test('takes the minimum across verdicts for the same bid (defensive)', () => {
		// If an anomaly produced differing observed_at values, the earliest
		// (true first observation) wins.
		const events = [
			buildVerdictEvent({ bidEventId: 'a'.repeat(64), observedAt: 2_000 }),
			buildVerdictEvent({ bidEventId: 'a'.repeat(64), observedAt: 1_500 }),
		]
		const seed = buildObservedAtSeed(events)
		expect(seed.get('a'.repeat(64))).toBe(1_500)
	})

	test('skips malformed events (missing bid or observed_at)', () => {
		const noBid: NostrEvent = {
			...buildVerdictEvent({ bidEventId: 'x'.repeat(64), observedAt: 1_500 }),
			tags: [
				['d', `${BIDDER_PK}:${AUCTION_ROOT}`],
				['observed_at', '1500'],
			],
		} as NostrEvent
		const noObservedAt: NostrEvent = {
			...buildVerdictEvent({ bidEventId: 'y'.repeat(64), observedAt: 1_500 }),
			tags: [
				['d', `${BIDDER_PK}:${AUCTION_ROOT}:y`],
				['bid', 'y'.repeat(64)],
			],
		} as NostrEvent
		const invalidNumber: NostrEvent = {
			...buildVerdictEvent({ bidEventId: 'z'.repeat(64), observedAt: 1_500 }),
			tags: [
				['d', `${BIDDER_PK}:${AUCTION_ROOT}:z`],
				['bid', 'z'.repeat(64)],
				['observed_at', 'not-a-number'],
			],
		} as NostrEvent
		const seed = buildObservedAtSeed([noBid, noObservedAt, invalidNumber])
		expect(seed.size).toBe(0)
	})

	test('empty input yields an empty seed', () => {
		expect(buildObservedAtSeed([]).size).toBe(0)
	})
})

describe('recoverObservedAt', () => {
	test('collects events until EOSE and projects the seed', async () => {
		const events = [
			buildVerdictEvent({ bidEventId: 'a'.repeat(64), observedAt: 1_500 }),
			buildVerdictEvent({ bidEventId: 'b'.repeat(64), observedAt: 1_520 }),
		]
		// A fake relay pool that delivers the events then EOSEs on subscribe.
		const relayPool = {
			subscribe: async (_filters: unknown, onEvent: (e: NostrEvent) => void, onEose?: () => void) => {
				for (const e of events) onEvent(e)
				onEose?.()
				return () => undefined
			},
		}
		const seed = await recoverObservedAt({ relayPool: relayPool as any, validatorPubkey: VALIDATOR_PK })
		expect(seed.size).toBe(2)
		expect(seed.get('a'.repeat(64))).toBe(1_500)
		expect(seed.get('b'.repeat(64))).toBe(1_520)
	})

	test('falls back to an empty seed on subscribe failure', async () => {
		const relayPool = {
			subscribe: async () => {
				throw new Error('relay down')
			},
		}
		const seed = await recoverObservedAt({ relayPool: relayPool as any, validatorPubkey: VALIDATOR_PK })
		expect(seed.size).toBe(0)
	})

	test('times out and returns whatever was collected if EOSE never fires', async () => {
		const events = [buildVerdictEvent({ bidEventId: 'a'.repeat(64), observedAt: 1_500 })]
		const relayPool = {
			subscribe: async (_filters: unknown, onEvent: (e: NostrEvent) => void) => {
				// Deliver one event but never EOSE.
				onEvent(events[0]!)
				return () => undefined
			},
		}
		const seed = await recoverObservedAt({
			relayPool: relayPool as any,
			validatorPubkey: VALIDATOR_PK,
			timeoutMs: 50,
		})
		// The event delivered before the timeout is still collected.
		expect(seed.get('a'.repeat(64))).toBe(1_500)
	})
})
