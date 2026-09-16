/**
 * Admission-policy disclosure coverage for the kind-30441 validator
 * policy declaration (PlebeianApp/market#1285, reviewer maxime-tt
 * required change 2).
 *
 * The validator enforced a whole set of admission limits (rate window,
 * pending-buffer caps, event envelope) that were serialized NOWHERE: not
 * in the 30441 policy document, not in the state, only in a startup log
 * line. A bidder reading the published policy could not tell whether the
 * validator checks nothing or checks a great deal, and could not read
 * back the limits it does apply. These tests pin the intended contract:
 *
 *   - the document carries an `admission` block with the RESOLVED limits
 *     (the same object the validator enforces and logs — no drift, and
 *     the document can never advertise limits that are not in force);
 *   - `{ enabled: false }` is a first-class, explicitly parsed, round-
 *     trippable "this validator runs no admission checks" declaration,
 *     so an unchecked validator says so instead of saying nothing;
 *   - the block survives parse/round-trip without loosening any existing
 *     validation, and a document cannot half-declare limits.
 *
 * Refusal reasons: see the last describe block. The reason codes the
 * validator refuses with do reach the operator log; wiring them through
 * to the bidder is deliberately NOT done here — see the comment at the
 * refusal site in src/server/auction-validator/subscriber.ts and the PR
 * notes for why the only per-bid carrier the protocol defines cannot be
 * used without changing verdict semantics.
 *
 * No relays, no network, no `mock.module()`: the handle test uses an
 * in-process fake pool + signer (same pattern as
 * auctionValidatorSpamPolicyConfig.test.ts), the subscriber test uses
 * real signed events and a fake publisher.
 */

import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, type EventTemplate, type NostrEvent } from 'nostr-tools'
import { VALIDATOR_POLICY_KIND, VALIDATOR_REASONS } from '../auction/constants'
import { buildValidatorPolicyContent, buildValidatorPolicyTags } from '../auction/tagBuilders'
import type { ValidatorAdmissionPolicy } from '../auction/events'
import { parseValidatorPolicyEvent } from '../schemas/auction/validatorEvents'
import type { NostrEventLike } from '../nostr/eventLike'
import { DEFAULT_BID_SPAM_POLICY, type BidSpamPolicy } from '../../server/auction-validator/spamPolicy'
import { toValidatorAdmissionPolicy, type AdmissionPolicyFieldParity } from '../../server/auction-validator/policy'
import { startAuctionValidator } from '../../server/auction-validator/index'
import { createValidatorState, setAuctionMintReachability, upsertAuction, type ValidatorState } from '../../server/auction-validator/state'
import { createValidatorSubscriber } from '../../server/auction-validator/subscriber'
import { AUCTION_BID_KIND } from '../auction/constants'

const VALIDATOR_PUBKEY = 'a'.repeat(64)
const POLICY_FIELD_COUNT = Object.keys(DEFAULT_BID_SPAM_POLICY).length

// ---------------------------------------------------------------------------
// Compile-time parity: adding a limit to the enforced policy without
// publishing it (or publishing a limit nothing enforces) fails to
// compile here, so the published document cannot drift from the code.
// ---------------------------------------------------------------------------
const admissionPolicyFieldParity: AdmissionPolicyFieldParity = 'parity'

const toEvent = (content: string): NostrEventLike => ({
	id: 'f'.repeat(64),
	pubkey: VALIDATOR_PUBKEY,
	kind: VALIDATOR_POLICY_KIND as unknown as number,
	created_at: 1_700_000_000,
	content,
	tags: buildValidatorPolicyTags({ name: 'Test validator' }),
})

/** A published policy document as authored by some other validator. */
const parseContent = (content: string) => parseValidatorPolicyEvent(toEvent(content))

const admissionOf = (content: string): ValidatorAdmissionPolicy => {
	const parsed = parseContent(content)
	if (!parsed.ok) throw new Error(`policy document did not parse: ${JSON.stringify(parsed.error)}`)
	return parsed.value.policy.admission as ValidatorAdmissionPolicy
}

// ---------------------------------------------------------------------------
// Resolved-limits disclosure, end to end through the real startup path
// ---------------------------------------------------------------------------

const runValidator = async (
	env: Record<string, string | undefined>,
	run: (input: {
		published: NostrEventLike[]
		info: string[]
		admission: ValidatorAdmissionPolicy
		enforced: typeof DEFAULT_BID_SPAM_POLICY
	}) => Promise<void>,
): Promise<void> => {
	const saved: Record<string, string | undefined> = {}
	for (const [key, value] of Object.entries(env)) {
		saved[key] = process.env[key]
		if (value === undefined) delete process.env[key]
		else process.env[key] = value
	}

	const info: string[] = []
	const published: NostrEventLike[] = []
	const pool = {
		subscribe: async (_filters: unknown, _handler: unknown, onEose?: () => void) => {
			onEose?.()
			return () => undefined
		},
		publish: async (event: NostrEventLike) => void published.push(event),
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
				warn: () => undefined,
				error: () => undefined,
			},
		})
		try {
			const policyEvents = published.filter((event) => event.kind === (VALIDATOR_POLICY_KIND as unknown as number))
			expect(policyEvents.length).toBe(1)
			const parsed = parseValidatorPolicyEvent(policyEvents[0])
			if (!parsed.ok) throw new Error(`published policy did not parse: ${JSON.stringify(parsed.error)}`)
			const admission = parsed.value.policy.admission
			if (!admission) throw new Error('published policy carries no admission block')
			await run({ published, info, admission, enforced: handle.spamPolicy })
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

describe('kind-30441 admission disclosure', () => {
	test('the admission block is published with the values the validator enforces', async () => {
		await runValidator(
			{ AUCTION_VALIDATOR_MAX_PENDING_KEYS: '64', AUCTION_VALIDATOR_MAX_BIDS_PER_WINDOW: '5' },
			async ({ admission, enforced }) => {
				expect(admission).toEqual({ enabled: true, ...enforced })
				expect(admission.enabled).toBe(true)
				if (!admission.enabled) throw new Error('unreachable')
				expect(admission.maxPendingKeys).toBe(64)
				expect(admission.maxBidsPerWindow).toBe(5)
				// Not the caller's partial and not the built-in default.
				expect(admission.maxPendingKeys).not.toBe(DEFAULT_BID_SPAM_POLICY.maxPendingKeys)
			},
		)
	})

	test('an unconfigured validator publishes the resolved defaults', async () => {
		await runValidator({ AUCTION_VALIDATOR_MAX_PENDING_KEYS: undefined }, async ({ admission }) => {
			expect(admission).toEqual({ enabled: true, ...DEFAULT_BID_SPAM_POLICY })
		})
	})

	test('every enforced limit is published: enforced, logged and published agree', async () => {
		await runValidator({ AUCTION_VALIDATOR_PENDING_TTL_SEC: '300' }, async ({ admission, info, enforced }) => {
			if (!admission.enabled) throw new Error('expected the limits to be declared as enabled')
			const publishedLimits = { ...admission } as Record<string, unknown>
			delete publishedLimits.enabled

			// Same field set as the policy the validator enforces.
			expect(Object.keys(publishedLimits).sort()).toEqual(Object.keys(DEFAULT_BID_SPAM_POLICY).sort())
			expect(Object.keys(publishedLimits).length).toBe(POLICY_FIELD_COUNT)
			// Same values as the handle exposes...
			expect(publishedLimits).toEqual({ ...enforced })
			expect(enforced.pendingTtlSec).toBe(300)

			// ...and the same values as the startup log line.
			const logged = info.filter((line) => line.includes('[validator] admission policy resolved:'))
			expect(logged.length).toBe(1)
			expect(JSON.parse(logged[0].slice(logged[0].indexOf('{'))) as Record<string, unknown>).toEqual(publishedLimits)
		})
	})

	test('the mapper is the single projection from the enforced policy to the document', () => {
		const mapped = toValidatorAdmissionPolicy({ ...DEFAULT_BID_SPAM_POLICY, maxTagCount: 7 })
		expect(mapped).toEqual({ enabled: true, ...DEFAULT_BID_SPAM_POLICY, maxTagCount: 7 })
	})

	test('this validator always declares a state — absence is not how it says "no limits"', async () => {
		await runValidator({ AUCTION_VALIDATOR_MAX_PENDING_KEYS: '64' }, async ({ admission }) => {
			// It enforces limits, so it must not claim the no-limits state.
			expect(admission.enabled).toBe(true)
		})
	})
})

// ---------------------------------------------------------------------------
// Explicit no-limits state + parse round-trip
// ---------------------------------------------------------------------------

describe('kind-30441 admission parse/round-trip', () => {
	test('a validator that runs no admission checks declares it, and it parses back explicitly', () => {
		const content = buildValidatorPolicyContent({ admission: { enabled: false } } as never)
		const parsed = parseContent(content)
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) return

		expect(parsed.value.policy.admission).toEqual({ enabled: false })
		// The declaration is the whole block: no limits are implied or
		// carried alongside it.
		expect(Object.keys(parsed.value.policy.admission as object)).toEqual(['enabled'])
		expect('maxBidsPerWindow' in (parsed.value.policy.admission as object)).toBe(false)
	})

	test('eligibility fields and the admission block coexist and round-trip unchanged', () => {
		const admission = { enabled: true, ...DEFAULT_BID_SPAM_POLICY } satisfies ValidatorAdmissionPolicy
		const content = buildValidatorPolicyContent({
			relatrMinScore: 0.1,
			requireNip05: true,
			minAccountAgeDays: 30,
			blacklist: ['c'.repeat(64)],
			blacklistRefs: ['d'.repeat(64)],
			requiredAttestors: ['e'.repeat(64)],
			categoryAllowlist: ['art'],
			categoryDenylist: ['spam'],
			maxAcceptableSkewSec: 60,
			griefingDecayDays: 30,
			notes: 'scoped validator',
			admission,
		})
		const parsed = parseContent(content)
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) return

		expect(parsed.value.policy).toMatchObject({
			relatrMinScore: 0.1,
			requireNip05: true,
			minAccountAgeDays: 30,
			blacklist: ['c'.repeat(64)],
			categoryAllowlist: ['art'],
			notes: 'scoped validator',
			admission,
		})
		expect(parsed.value.policy.admission).toEqual(admission)
	})

	test('the admission block is rejected when it half-declares limits', () => {
		// `enabled: false` means "no limits": carrying limits alongside it is
		// a contradiction, not a document to guess at.
		const contradiction = parseContent(buildValidatorPolicyContent({ admission: { enabled: false, maxBidsPerWindow: 5 } } as never))
		expect(contradiction.ok).toBe(false)

		// `enabled: true` must state every limit it claims to apply.
		expect(parseContent(buildValidatorPolicyContent({ admission: { enabled: true } } as never)).ok).toBe(false)
		expect(
			parseContent(
				buildValidatorPolicyContent({ admission: { enabled: true, ...DEFAULT_BID_SPAM_POLICY, maxPendingKeys: undefined } } as never),
			).ok,
		).toBe(false)
	})

	test('admission limits are validated, not merely accepted', () => {
		for (const bad of [
			{ enabled: true, ...DEFAULT_BID_SPAM_POLICY, maxPendingKeys: -1 },
			{ enabled: true, ...DEFAULT_BID_SPAM_POLICY, pendingTtlSec: 1.5 },
			{ enabled: true, ...DEFAULT_BID_SPAM_POLICY, maxTagCount: 'lots' },
			{ enabled: 'yes' },
			{ enabled: false, enabledReason: 'no checks' },
		]) {
			expect(parseContent(buildValidatorPolicyContent({ admission: bad } as never)).ok).toBe(false)
		}
	})

	test('a document without an admission block still parses (older validators)', () => {
		const parsed = parseContent(buildValidatorPolicyContent({ relatrMinScore: 0.1 }))
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) return
		expect(parsed.value.policy.admission).toBeUndefined()
	})
})

// ---------------------------------------------------------------------------
// Refusal reasons: operator-visible today, bidder-visible deliberately NOT
// wired (see the comment at the refusal site in subscriber.ts).
// ---------------------------------------------------------------------------

describe('auction validator admission refusals carry a reason code', () => {
	const buildHarness = (overrides: Partial<BidSpamPolicy>) => {
		// Full resolved policy, exactly as production passes it (see
		// startAuctionValidator): the subscriber is never handed a
		// partial policy, so neither is this harness.
		const policy: BidSpamPolicy = { ...DEFAULT_BID_SPAM_POLICY, ...overrides }
		const state: ValidatorState = createValidatorState(VALIDATOR_PUBKEY)
		const auction = {
			id: 'd'.repeat(64),
			kind: 30408 as never,
			pubkey: 'b'.repeat(64),
			created_at: 1_000,
			content: '',
			tags: [
				['d', 'auction-test'],
				['title', 'Auction'],
				['auction_type', 'english'],
				['start_at', '1000'],
				['end_at', '2000'],
				['max_end_at', '2100'],
				['settlement_grace', '3600'],
				['currency', 'SAT'],
				['reserve', '0'],
				['starting_bid', '1000'],
				['bid_increment', '100'],
				['min_bid_curve', 'none'],
				['settlement_policy', 'cashu_p2pk_bidder_path_v1'],
				['key_scheme', 'hd_p2pk'],
				['p2pk_xpub', 'xpub-root'],
				['auditors', VALIDATOR_PUBKEY],
				['auditor_quorum', '1'],
				['max_skew_sec', '60'],
				['fallback_delay_sec', '1800'],
				['mint', 'https://mint.test'],
			],
		} as unknown as NostrEvent
		const parsedAuction = {
			rawEvent: auction,
			dTag: 'auction-test',
			sellerPubkey: 'b'.repeat(64),
			coordinate: `30408:${'b'.repeat(64)}:auction-test`,
			rootEventId: 'd'.repeat(64),
			title: 'Auction',
			content: '',
			auctionType: 'english' as const,
			startAt: 1_000,
			endAt: 2_000,
			maxEndAt: 2_100,
			settlementGrace: 3_600,
			currency: 'SAT' as const,
			reserve: 0,
			startingBid: 1_000,
			bidIncrement: 100,
			minBidCurve: { shape: 'none', peakMultiplier: 1, raw: '' },
			settlementPolicy: 'cashu_p2pk_bidder_path_v1' as const,
			keyScheme: 'hd_p2pk' as const,
			mints: ['https://mint.test'],
			p2pkXpub: 'xpub-root',
			auditors: [VALIDATOR_PUBKEY],
			auditorQuorum: 1,
			maxSkewSec: 60,
			vadiumRatioBps: 10_000,
			schema: 'auction_v1' as const,
		}
		const result = upsertAuction(state, parsedAuction as never)
		setAuctionMintReachability(result.auctionState, [['https://mint.test', true]])

		const publishCalls: string[] = []
		const warnings: string[] = []
		const handles = new Map<number, (event: NostrEvent) => void>()
		const relayPool = {
			subscribe: async (filters: Array<{ kinds?: number[] }>, handler: (event: NostrEvent) => void) => {
				const kind = filters[0]?.kinds?.[0]
				if (kind !== undefined) handles.set(kind, handler)
				return () => undefined
			},
			publish: async () => undefined,
		}
		const publisher = {
			publishIfChanged: async (input: { bidState: { bid: { id: string } } }) => {
				publishCalls.push(input.bidState.bid.id)
				return { verdict: { claim: 'valid_bid_placed' }, published: true }
			},
		}
		const subscriber = createValidatorSubscriber({
			state,
			relayPool: relayPool as never,
			publisher: publisher as never,
			spamPolicy: policy,
			now: () => 1_500,
			logger: {
				info: () => undefined,
				warn: (...args: unknown[]) => void warnings.push(args.map(String).join(' ')),
				error: () => undefined,
			},
		})
		return { subscriber, handles, publishCalls, warnings }
	}

	const signedBid = (): NostrEvent =>
		finalizeEvent(
			{
				kind: AUCTION_BID_KIND as unknown as number,
				created_at: 1_500,
				content: '',
				tags: [
					['e', 'd'.repeat(64)],
					['a', `30408:${'b'.repeat(64)}:auction-test`],
					['p', 'b'.repeat(64)],
					['amount', '1200'],
					['currency', 'SAT'],
					['mint', 'https://mint.test'],
					['locktime', '5700'],
					['refund_pubkey', '03' + 'f'.repeat(64)],
					['child_pubkey', '02' + 'a'.repeat(64)],
					['lock_secret', 'secret-1'],
					['proof_y', '02' + 'b'.repeat(64)],
					['created_for_end_at', '2100'],
					['bid_nonce', 'nonce'],
					['key_scheme', 'hd_p2pk'],
					['status', 'locked'],
				],
			} as EventTemplate,
			generateSecretKey(),
		)

	const flush = async () => {
		await Promise.resolve()
		await Promise.resolve()
		await Promise.resolve()
	}

	test('a refused bid names its reason to the operator and publishes no verdict', async () => {
		// `maxNonceLength: 1` refuses the bid on a nonce two characters long,
		// i.e. the validator HAS the bid and the auction in context — the
		// strongest case for telling the bidder something.
		const { subscriber, handles, publishCalls, warnings } = buildHarness({ maxNonceLength: 1 })
		await subscriber.start()
		const bid = signedBid()
		handles.get(bid.kind)?.(bid)
		await flush()

		const refusals = warnings.filter((line) => line.includes('dropping bid'))
		expect(refusals.length).toBe(1)
		expect(refusals[0]).toContain('invalid_bid_nonce')
		expect(VALIDATOR_REASONS).toContain('invalid_bid_nonce')
		// Deferred by design: the reason does not reach the bidder, because
		// the only per-bid carrier in the protocol is a kind-30440 verdict
		// whose claim would have to be a condemn claim (`bid_invalid`), which
		// would report a capacity refusal as invalid-bid evidence.
		expect(publishCalls).toEqual([])
		await subscriber.stop()
	})

	test('control: the same bid under a permissive policy is admitted and published', async () => {
		const { subscriber, handles, publishCalls } = buildHarness({ maxNonceLength: 256 })
		await subscriber.start()
		const bid = signedBid()
		handles.get(bid.kind)?.(bid)
		await flush()

		expect(publishCalls.length).toBe(1)
		await subscriber.stop()
	})
})

// Keep the parity proof referenced so the compiler evaluates it even if the
// assertion above is ever moved.
test('the published admission block and the enforced policy have the same fields', () => {
	expect(admissionPolicyFieldParity).toBe('parity')
})
