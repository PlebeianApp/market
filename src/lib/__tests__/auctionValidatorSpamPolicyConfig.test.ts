/**
 * Configurability coverage for the validator's admission (spam) policy
 * (PlebeianApp/market#1285, review 5645059400 required change 3).
 *
 * The admission limits were declared as deps but nothing ever supplied
 * them: the only production call site passes `{ signer, relayPool,
 * name }`, so the bounds were hard-coded defaults an operator could not
 * raise, lower, or verify. These tests pin the intended contract:
 *
 *   explicit options  >  environment  >  DEFAULT_BID_SPAM_POLICY
 *
 * with validation, so a malformed env value can never silently produce
 * an unbounded (or zeroed) buffer, and the fully resolved policy is
 * exposed on the running handle so an operator can verify what is
 * actually in force.
 *
 * No relays, no network: the handle test uses an in-process fake pool.
 */

import { describe, expect, test } from 'bun:test'
import { DEFAULT_BID_SPAM_POLICY, resolveBidSpamPolicyFromEnv } from '../../server/auction-validator/spamPolicy'
import { startAuctionValidator } from '../../server/auction-validator/index'

const VALIDATOR_PUBKEY = 'a'.repeat(64)

const POLICY_FIELD_COUNT = Object.keys(DEFAULT_BID_SPAM_POLICY).length

const collectWarnings = () => {
	const warnings: string[] = []
	return { warnings, warn: (...args: unknown[]) => void warnings.push(args.map(String).join(' ')) }
}

describe('resolveBidSpamPolicyFromEnv', () => {
	test('returns the documented defaults when nothing is configured', () => {
		const { warnings, warn } = collectWarnings()
		const resolved = resolveBidSpamPolicyFromEnv(undefined, {}, { warn })

		expect(resolved).toEqual(DEFAULT_BID_SPAM_POLICY)
		expect(warnings).toEqual([])
	})

	test('applies an environment override to every bound-bearing field', () => {
		const { warnings, warn } = collectWarnings()
		const resolved = resolveBidSpamPolicyFromEnv(
			undefined,
			{
				AUCTION_VALIDATOR_MAX_BIDS_PER_WINDOW: '5',
				AUCTION_VALIDATOR_RATE_WINDOW_SEC: '30',
				AUCTION_VALIDATOR_MAX_ACTIVE_BIDS_PER_AUCTION: '10',
				AUCTION_VALIDATOR_MAX_PENDING_EVENTS_PER_KEY: '8',
				AUCTION_VALIDATOR_MAX_PENDING_KEYS: '64',
				AUCTION_VALIDATOR_MAX_PENDING_EVENTS: '128',
				AUCTION_VALIDATOR_PENDING_TTL_SEC: '300',
				AUCTION_VALIDATOR_MAX_SEEN_EVENT_IDS: '500',
				AUCTION_VALIDATOR_MAX_EVENT_BYTES: '2048',
				AUCTION_VALIDATOR_MAX_TAG_COUNT: '16',
				AUCTION_VALIDATOR_MAX_NONCE_LENGTH: '64',
				AUCTION_VALIDATOR_MAX_PROOF_COUNT: '4',
				AUCTION_VALIDATOR_MAX_CONTENT_BYTES: '1024',
			},
			{ warn },
		)

		expect(resolved).toEqual({
			maxBidsPerWindow: 5,
			rateWindowSec: 30,
			maxActiveBidsPerAuction: 10,
			maxPendingEventsPerKey: 8,
			maxPendingKeys: 64,
			maxPendingEvents: 128,
			pendingTtlSec: 300,
			maxSeenEventIds: 500,
			maxEventBytes: 2048,
			maxTagCount: 16,
			maxNonceLength: 64,
			maxProofCount: 4,
			maxContentBytes: 1024,
		})
		expect(warnings).toEqual([])
	})

	test('explicit options win over the environment', () => {
		const { warn } = collectWarnings()
		const resolved = resolveBidSpamPolicyFromEnv(
			{ maxPendingKeys: 32, pendingTtlSec: 60 },
			{ AUCTION_VALIDATOR_MAX_PENDING_KEYS: '64', AUCTION_VALIDATOR_PENDING_TTL_SEC: '300' },
			{ warn },
		)

		expect(resolved.maxPendingKeys).toBe(32)
		expect(resolved.pendingTtlSec).toBe(60)
	})

	test('a JSON blob env var overrides the defaults and individual vars override the blob', () => {
		const { warnings, warn } = collectWarnings()
		const resolved = resolveBidSpamPolicyFromEnv(
			undefined,
			{
				AUCTION_VALIDATOR_SPAM_POLICY: JSON.stringify({ maxPendingKeys: 7, pendingTtlSec: 90, maxEventBytes: 4096 }),
				AUCTION_VALIDATOR_MAX_PENDING_KEYS: '9',
			},
			{ warn },
		)

		expect(resolved.maxPendingKeys).toBe(9)
		expect(resolved.pendingTtlSec).toBe(90)
		expect(resolved.maxEventBytes).toBe(4096)
		expect(warnings).toEqual([])
	})

	test('rejects non-finite and non-numeric env values, keeping the default and warning', () => {
		for (const bad of ['abc', '', 'NaN', 'Infinity', '-Infinity', '1.5.2', '0x10']) {
			const { warnings, warn } = collectWarnings()
			const resolved = resolveBidSpamPolicyFromEnv(undefined, { AUCTION_VALIDATOR_MAX_PENDING_KEYS: bad }, { warn })

			expect(resolved.maxPendingKeys).toBe(DEFAULT_BID_SPAM_POLICY.maxPendingKeys)
			expect(warnings.length).toBe(1)
			expect(warnings[0]).toContain('AUCTION_VALIDATOR_MAX_PENDING_KEYS')
		}
	})

	test('never lets a bad env value zero or unbound a buffer', () => {
		for (const bad of ['0', '-1', '-0', '0.4', 'NaN']) {
			const { warnings, warn } = collectWarnings()
			const resolved = resolveBidSpamPolicyFromEnv(
				undefined,
				{
					AUCTION_VALIDATOR_MAX_PENDING_KEYS: bad,
					AUCTION_VALIDATOR_MAX_PENDING_EVENTS: bad,
					AUCTION_VALIDATOR_MAX_PENDING_EVENTS_PER_KEY: bad,
					AUCTION_VALIDATOR_PENDING_TTL_SEC: bad,
				},
				{ warn },
			)

			// Every rejected value falls back to the (finite, positive)
			// default rather than to 0 / NaN / Infinity.
			expect(resolved.maxPendingKeys).toBe(DEFAULT_BID_SPAM_POLICY.maxPendingKeys)
			expect(resolved.maxPendingEvents).toBe(DEFAULT_BID_SPAM_POLICY.maxPendingEvents)
			expect(resolved.maxPendingEventsPerKey).toBe(DEFAULT_BID_SPAM_POLICY.maxPendingEventsPerKey)
			expect(resolved.pendingTtlSec).toBe(DEFAULT_BID_SPAM_POLICY.pendingTtlSec)
			expect(warnings.length).toBe(4)
		}
	})

	test('rejects out-of-range values above the documented ceiling', () => {
		const { warnings, warn } = collectWarnings()
		const resolved = resolveBidSpamPolicyFromEnv(
			undefined,
			{
				AUCTION_VALIDATOR_MAX_PENDING_KEYS: String(Number.MAX_SAFE_INTEGER),
				AUCTION_VALIDATOR_MAX_PENDING_EVENTS: String(DEFAULT_BID_SPAM_POLICY.maxPendingEvents * 1_000_000),
				AUCTION_VALIDATOR_MAX_EVENT_BYTES: String(DEFAULT_BID_SPAM_POLICY.maxEventBytes * 1_000_000),
			},
			{ warn },
		)

		expect(resolved.maxPendingKeys).toBe(DEFAULT_BID_SPAM_POLICY.maxPendingKeys)
		expect(resolved.maxPendingEvents).toBe(DEFAULT_BID_SPAM_POLICY.maxPendingEvents)
		expect(resolved.maxEventBytes).toBe(DEFAULT_BID_SPAM_POLICY.maxEventBytes)
		expect(warnings.length).toBe(3)
	})

	test('a malformed JSON blob is ignored with a warning, not fatal', () => {
		const { warnings, warn } = collectWarnings()
		const resolved = resolveBidSpamPolicyFromEnv(undefined, { AUCTION_VALIDATOR_SPAM_POLICY: '{not json' }, { warn })

		expect(resolved).toEqual(DEFAULT_BID_SPAM_POLICY)
		expect(warnings.length).toBe(1)
		expect(warnings[0]).toContain('AUCTION_VALIDATOR_SPAM_POLICY')
	})

	test('a JSON blob with invalid fields keeps per-field defaults', () => {
		const { warnings, warn } = collectWarnings()
		const resolved = resolveBidSpamPolicyFromEnv(
			undefined,
			{ AUCTION_VALIDATOR_SPAM_POLICY: JSON.stringify({ maxPendingKeys: 0, pendingTtlSec: 'nope' }) },
			{ warn },
		)

		expect(resolved.maxPendingKeys).toBe(DEFAULT_BID_SPAM_POLICY.maxPendingKeys)
		expect(resolved.pendingTtlSec).toBe(DEFAULT_BID_SPAM_POLICY.pendingTtlSec)
		expect(warnings.length).toBeGreaterThanOrEqual(1)
	})
})

describe('startAuctionValidator admission policy exposure', () => {
	const withEnv = async (
		env: Record<string, string | undefined>,
		run: (input: { handle: Awaited<ReturnType<typeof startAuctionValidator>>; info: string[]; warnings: string[] }) => Promise<void>,
	): Promise<void> => {
		const saved: Record<string, string | undefined> = {}
		for (const [key, value] of Object.entries(env)) {
			saved[key] = process.env[key]
			if (value === undefined) delete process.env[key]
			else process.env[key] = value
		}

		const info: string[] = []
		const warnings: string[] = []
		const pool = {
			subscribe: async (_filters: unknown, _handler: unknown, onEose?: () => void) => {
				onEose?.()
				return () => undefined
			},
			publish: async () => undefined,
		}
		const signer = {
			getPublicKey: async () => VALIDATOR_PUBKEY,
			signEvent: async (template: Record<string, unknown>) => ({
				...template,
				pubkey: VALIDATOR_PUBKEY,
				id: 'b'.repeat(64),
				sig: 'c'.repeat(128),
			}),
		}

		try {
			const handle = await startAuctionValidator({
				signer: signer as never,
				relayPool: pool as never,
				logger: {
					info: (...args: unknown[]) => void info.push(args.map(String).join(' ')),
					warn: (...args: unknown[]) => void warnings.push(args.map(String).join(' ')),
					error: () => undefined,
				},
			})
			try {
				await run({ handle, info, warnings })
			} finally {
				await handle.stop()
			}
		} finally {
			for (const [key, value] of Object.entries(saved)) {
				if (value === undefined) delete process.env[key]
				else process.env[key] = value
			}
		}
	}

	test('exposes the resolved policy on the handle, not the caller partial', async () => {
		await withEnv({ AUCTION_VALIDATOR_MAX_PENDING_KEYS: '64' }, async ({ handle }) => {
			expect(handle.spamPolicy.maxPendingKeys).toBe(64)
			expect(handle.spamPolicy.pendingTtlSec).toBe(DEFAULT_BID_SPAM_POLICY.pendingTtlSec)
		})
	})

	test('exposes every policy field on the handle', async () => {
		await withEnv({ AUCTION_VALIDATOR_MAX_PENDING_KEYS: undefined }, async ({ handle }) => {
			expect(Object.keys(handle.spamPolicy).sort()).toEqual(Object.keys(DEFAULT_BID_SPAM_POLICY).sort())
			expect(Object.keys(handle.spamPolicy).length).toBe(POLICY_FIELD_COUNT)
		})
	})

	test('an invalid env value cannot widen a bound in the running validator', async () => {
		await withEnv({ AUCTION_VALIDATOR_MAX_PENDING_EVENTS: 'Infinity' }, async ({ handle, warnings }) => {
			expect(handle.spamPolicy.maxPendingEvents).toBe(DEFAULT_BID_SPAM_POLICY.maxPendingEvents)
			expect(warnings.some((line) => line.includes('AUCTION_VALIDATOR_MAX_PENDING_EVENTS'))).toBe(true)
		})
	})

	test('logs the fully resolved admission policy once at startup', async () => {
		await withEnv({ AUCTION_VALIDATOR_MAX_PENDING_KEYS: '64' }, async ({ info }) => {
			const lines = info.filter((line) => line.includes('[validator] admission policy resolved:'))
			expect(lines.length).toBe(1)

			const json = lines[0].slice(lines[0].indexOf('{'))
			const parsed = JSON.parse(json) as Record<string, number>
			expect(parsed.maxPendingKeys).toBe(64)
			expect(Object.keys(parsed).sort()).toEqual(Object.keys(DEFAULT_BID_SPAM_POLICY).sort())
		})
	})
})
