import { describe, expect, test } from 'bun:test'
import { base64urlnopad } from '@scure/base'
import { finalizeEvent, getPublicKey } from 'nostr-tools'
import type { NostrEventLike } from '../nostr/eventLike'
import {
	AUCTION_MULTIPARTY_MAX_MINT_BYTES,
	AUCTION_MULTIPARTY_MAX_MINTS,
	AUCTION_MULTIPARTY_ROOT_KIND,
	type MultipartyAuthorizationSnapshotRelations,
} from '../auction/multipartyAuthorization'
import { AuctionMultipartyBidLegContextError, buildValidatedMultipartyBidLegContext } from '../auction/multipartyBidLegContext'
import {
	AuctionMultipartyManifestError,
	buildMultipartyManifestProjection,
	isMultipartyManifestProjection,
} from '../auction/multipartyManifest'
import {
	AUCTION_MULTIPARTY_SETTLEMENT_POLICY,
	AuctionMultipartyScheduleError,
	compileSourceSchedule,
	type AuctionMultipartyCanonicalSchedule,
} from '../auction/multipartySchedule'

const ACTIVATION = 'bb'.repeat(32)
const CAP_VALIDATOR = '11'.repeat(32)
const OFFER_VALIDATOR = '22'.repeat(32)
const ACCEPT_VALIDATOR = '33'.repeat(32)
const CAP_V4V = '44'.repeat(32)
const CREATED_AT = 1_800_000_000
const XPUB = 'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8'

const fixedSecret = (lastByte: number): Uint8Array => {
	const secret = new Uint8Array(32)
	secret[31] = lastByte
	return secret
}

const SELLER_SECRET = fixedSecret(1)
const BIDDER_SECRET = fixedSecret(2)
const SELLER = getPublicKey(SELLER_SECRET)
const BIDDER = getPublicKey(BIDDER_SECRET)
const VALIDATOR = getPublicKey(fixedSecret(3))
const V4V = '20'.repeat(32)

const MINT = 'https://mint.example'

const CHILD_SELLER = `02${'aa'.repeat(32)}`
const CHILD_VALIDATOR = `03${'bb'.repeat(32)}`
const CHILD_V4V = `02${'cc'.repeat(32)}`
const REFUND = `03${'dd'.repeat(32)}`

const PROOF_SELLER = `02${'01'.repeat(32)}`
const PROOF_VALIDATOR = `03${'02'.repeat(32)}`
const PROOF_V4V = `02${'03'.repeat(32)}`

const ZERO_SATS = BigInt(0)
const THIRTY_TWO_SATS = BigInt(32)
const SIXTY_FOUR_SATS = BigInt(64)
const NINE_HUNDRED_TWENTY_EIGHT_SATS = BigInt(928)
const ONE_THOUSAND_TWENTY_FOUR_SATS = BigInt(1024)
const TWO_THOUSAND_FORTY_EIGHT_SATS = BigInt(2048)

const expectCode = (code: string, fn: () => unknown): void => {
	try {
		fn()
		throw new Error(`Expected ${code}`)
	} catch (error) {
		expect(error).toBeInstanceOf(AuctionMultipartyManifestError)
		expect((error as AuctionMultipartyManifestError).code).toBe(code)
	}
}

const expectBidLegCode = (code: AuctionMultipartyBidLegContextError['code'], fn: () => unknown): void => {
	try {
		fn()
		throw new Error(`Expected ${code}`)
	} catch (error) {
		expect(error).toBeInstanceOf(AuctionMultipartyBidLegContextError)
		expect((error as AuctionMultipartyBidLegContextError).code).toBe(code)
	}
}

const expectScheduleCode = (code: string, fn: () => unknown): void => {
	try {
		fn()
		throw new Error(`Expected ${code}`)
	} catch (error) {
		expect(error).toBeInstanceOf(AuctionMultipartyScheduleError)
		expect((error as AuctionMultipartyScheduleError).code).toBe(code)
	}
}

const defineSplitGetter = <T extends object, K extends PropertyKey>(
	target: T,
	property: K,
	first: unknown,
	later: unknown,
): { readonly value: T; readonly reads: () => number } => {
	let reads = 0
	const value = { ...target }

	Object.defineProperty(value, property, {
		enumerable: true,
		get: () => {
			reads += 1
			return reads === 1 ? first : later
		},
	})

	return { value, reads: () => reads }
}

const buildSchedule = (validatorBps = 625, v4vBps = 313): AuctionMultipartyCanonicalSchedule =>
	compileSourceSchedule([
		{
			role: 'validator',
			recipient_pubkey: VALIDATOR,
			payout_capability_event_id: CAP_VALIDATOR,
			allocation_bps: validatorBps,
			validator_offer_event_id: OFFER_VALIDATOR,
		},
		{
			role: 'v4v',
			recipient_pubkey: V4V,
			payout_capability_event_id: CAP_V4V,
			allocation_bps: v4vBps,
		},
	])

const relationsFor = (schedule: AuctionMultipartyCanonicalSchedule, rootEventId: string): MultipartyAuthorizationSnapshotRelations => ({
	root_event_id: rootEventId,
	activation_event_id: ACTIVATION,
	payout_schedule_commitment: schedule.schedule_commitment,
	mints: [MINT],
	bindings: schedule.entries.map((entry) => ({
		schedule_index: entry.schedule_index,
		role: entry.role,
		recipient_pubkey: entry.recipient_pubkey,
		payout_xpub: `xpub-${entry.schedule_index}`,
		payout_capability_event_id: entry.payout_capability_event_id,
		...(entry.role === 'validator'
			? {
					validator_offer_event_id: entry.validator_offer_event_id,
					validator_acceptance_event_id: ACCEPT_VALIDATOR,
				}
			: {}),
		allocation_bps: entry.allocation_bps,
	})),
})

const positive = (child: string, secret: string, proofY: string, token: string) => ({
	child_pubkey: child,
	lock_secrets: [secret],
	proof_ys: [proofY],
	cashu_token: token,
})

const zero = () => ({
	child_pubkey: null,
	lock_secrets: [],
	proof_ys: [],
	cashu_token: null,
})

const signEvent = (secretKey: Uint8Array, kind: number, tags: string[][], content = ''): NostrEventLike =>
	finalizeEvent({ kind, created_at: CREATED_AT, tags, content }, secretKey)

const makeRoot = (schedule: AuctionMultipartyCanonicalSchedule, d = 'manifest'): NostrEventLike =>
	signEvent(
		SELLER_SECRET,
		AUCTION_MULTIPARTY_ROOT_KIND,
		[
			['d', d],
			['settlement_policy', AUCTION_MULTIPARTY_SETTLEMENT_POLICY],
			['payout_schedule_commitment', schedule.schedule_commitment],
			['payout_schedule', `b64u:${base64urlnopad.encode(schedule.canonical_bytes)}`],
			['start_at', String(CREATED_AT + 10)],
			['max_end_at', String(CREATED_AT + 3_600)],
			['p2pk_xpub', XPUB],
			['mint', MINT],
			['auditors', VALIDATOR],
			['auditor_quorum', '1'],
		],
		'auction',
	)

const makeBid = (root: NostrEventLike, amount: bigint): NostrEventLike =>
	signEvent(BIDDER_SECRET, 1023, [
		['e', root.id],
		['a', `${AUCTION_MULTIPARTY_ROOT_KIND}:${SELLER}:manifest`],
		['p', SELLER],
		['amount', amount.toString()],
		['currency', 'SAT'],
		['mint', MINT],
		['locktime', String(CREATED_AT + 7_200)],
		['refund_pubkey', REFUND],
		['child_pubkey', CHILD_SELLER],
		['lock_secret', `secret-${amount}`],
		['proof_y', PROOF_SELLER],
		['created_for_end_at', String(CREATED_AT + 3_600)],
		['bid_nonce', `nonce-${amount}`],
		['key_scheme', 'hd_p2pk'],
		['status', 'locked'],
	])

interface BuildInputOptions {
	readonly currentGrossSats?: bigint
	readonly predecessorGrossSats?: bigint
}

const buildInput = (schedule = buildSchedule(), options: BuildInputOptions = {}) => {
	const currentGrossSats = options.currentGrossSats ?? ONE_THOUSAND_TWENTY_FOUR_SATS
	const root = makeRoot(schedule)
	const predecessor = options.predecessorGrossSats === undefined ? null : makeBid(root, options.predecessorGrossSats)
	const bidLegContext = buildValidatedMultipartyBidLegContext({
		rootEvent: root,
		bidderPubkey: BIDDER,
		currentGrossSats,
		predecessorEventId: predecessor?.id ?? null,
		predecessorEvents: predecessor === null ? [] : [predecessor],
	})

	return {
		schedule,
		relations: relationsFor(schedule, root.id),
		bid_leg_context: bidLegContext,
		selected_mint: MINT,
		gross_sats: currentGrossSats,
		previous_bid:
			predecessor === null
				? null
				: {
						event_id: predecessor.id,
						gross_sats: options.predecessorGrossSats!,
					},
		locktime: 1_900_000_000,
		refund_pubkey: REFUND,
		seller: positive(CHILD_SELLER, 'seller-secret', PROOF_SELLER, 'seller-token'),
		auxiliary: [
			{
				schedule_index: 0,
				...positive(CHILD_VALIDATOR, 'validator-secret', PROOF_VALIDATOR, 'validator-token'),
			},
			{
				schedule_index: 1,
				...positive(CHILD_V4V, 'v4v-secret', PROOF_V4V, 'v4v-token'),
			},
		],
	}
}

describe('Auction Multiparty Gate D1 manifest projection', () => {
	test('projects the 1024-sat regression onto seller, validator, and V4V legs', () => {
		const manifest = buildMultipartyManifestProjection(buildInput())

		expect(manifest.status).toBe('manifest_projected')
		expect(manifest.gross_sats).toBe(ONE_THOUSAND_TWENTY_FOUR_SATS)
		expect(manifest.principal_sats).toBe(ONE_THOUSAND_TWENTY_FOUR_SATS)
		expect(manifest.previous_bid_event_id).toBeNull()

		expect(manifest.payouts.map((payout) => [payout.role, payout.amount_sats])).toEqual([
			['seller', NINE_HUNDRED_TWENTY_EIGHT_SATS],
			['validator', SIXTY_FOUR_SATS],
			['v4v', THIRTY_TWO_SATS],
		])

		expect(manifest.payouts[1].validator_offer_event_id).toBe(OFFER_VALIDATOR)
		expect(manifest.payouts[1].validator_acceptance_event_id).toBe(ACCEPT_VALIDATOR)
		expect(manifest.payouts[1].recipient_pubkey).toBe(VALIDATOR)
		expect(manifest.payouts[1].payout_capability_event_id).toBe(CAP_VALIDATOR)
		expect(manifest.payouts[2].validator_offer_event_id).toBeNull()
		expect(manifest.payouts[2].recipient_pubkey).toBe(V4V)
		expect(manifest.payouts[2].payout_capability_event_id).toBe(CAP_V4V)
		expect(manifest.payouts.map((payout) => payout.cashu_token_sha256)).toEqual([
			'8a434b7a4ad70d78fa4372bcc028eb94d7aba4cc359972d11310337c31cf64a9',
			'310c7ad5a652926826cd6c23b298f21ddde25fb4e5d9e4500ec8e1efbc8cc8c7',
			'03531504eadb949e8fc419a6bc671f3b59a468933d43a2dece224b19683c4740',
		])
		expect(manifest.payouts.every((payout) => !('cashu_token' in payout))).toBe(true)
		expect(!('derivation_path' in manifest)).toBe(true)

		expect(manifest.payouts.every(Object.isFrozen)).toBe(true)
		expect(Object.isFrozen(manifest.payouts)).toBe(true)
		expect(Object.isFrozen(manifest)).toBe(true)
		expect(isMultipartyManifestProjection(manifest)).toBe(true)
	})

	test('projects seller first and auxiliary rows in canonical schedule order', () => {
		const input = buildInput()
		const manifest = buildMultipartyManifestProjection({
			...input,
			auxiliary: [...input.auxiliary].reverse(),
		})

		expect(manifest.payouts.map((payout) => [payout.schedule_index, payout.role, payout.recipient_pubkey])).toEqual([
			[null, 'seller', null],
			[0, 'validator', VALIDATOR],
			[1, 'v4v', V4V],
		])
	})

	test('canonical schedule bytes control rows despite caller-reordered derived entries', () => {
		const input = buildInput()
		const schedule = {
			...input.schedule,
			entries: [...input.schedule.entries].reverse().map((entry, scheduleIndex) => ({ ...entry, schedule_index: scheduleIndex })),
		}
		const manifest = buildMultipartyManifestProjection({ ...input, schedule })

		expect(manifest.payouts.map((payout) => [payout.schedule_index, payout.role, payout.recipient_pubkey])).toEqual([
			[null, 'seller', null],
			[0, 'validator', VALIDATOR],
			[1, 'v4v', V4V],
		])
	})

	test('caller-reindexed schedule entries cannot control projected indexes', () => {
		const input = buildInput()
		const schedule = {
			...input.schedule,
			entries: input.schedule.entries.map((entry) => ({ ...entry, schedule_index: entry.schedule_index + 8 })),
		}
		const manifest = buildMultipartyManifestProjection({ ...input, schedule })

		expect(manifest.payouts.map((payout) => payout.schedule_index)).toEqual([null, 0, 1])
	})

	test('caller-modified allocation and derived totals cannot control economics', () => {
		const input = buildInput()
		const schedule = {
			...input.schedule,
			entries: input.schedule.entries.map((entry, index) => ({ ...entry, allocation_bps: index === 0 ? 9_000 : 1_000 })),
			auxiliary_allocation_bps: 10_000,
			seller_remainder_bps: 0,
		}
		const manifest = buildMultipartyManifestProjection({ ...input, schedule })

		expect(manifest.payouts.map((payout) => payout.amount_sats)).toEqual([NINE_HUNDRED_TWENTY_EIGHT_SATS, SIXTY_FOUR_SATS, THIRTY_TWO_SATS])
	})

	test('claimed schedule commitment is validated from canonical bytes', () => {
		const input = buildInput()

		expectScheduleCode('schedule_commitment_mismatch', () =>
			buildMultipartyManifestProjection({
				...input,
				schedule: { ...input.schedule, schedule_commitment: '99'.repeat(32) },
			}),
		)
	})

	test('owns schedule A bytes before a claimed-commitment getter mutates the caller alias to equal-length schedule B', () => {
		const scheduleA = buildSchedule(625, 313)
		const scheduleB = buildSchedule(624, 314)
		const input = buildInput(scheduleA, { currentGrossSats: 10_000n })
		const callerBytes = scheduleA.canonical_bytes.slice()
		let canonicalBytesReads = 0
		const hostileSchedule = {} as AuctionMultipartyCanonicalSchedule

		Object.defineProperty(hostileSchedule, 'canonical_bytes', {
			get: () => {
				canonicalBytesReads += 1
				return callerBytes
			},
		})
		Object.defineProperty(hostileSchedule, 'schedule_commitment', {
			get: () => {
				callerBytes.set(scheduleB.canonical_bytes)
				return scheduleB.schedule_commitment
			},
		})

		expectScheduleCode('schedule_commitment_mismatch', () =>
			buildMultipartyManifestProjection({
				...input,
				schedule: hostileSchedule,
				relations: { ...input.relations, payout_schedule_commitment: scheduleB.schedule_commitment },
			}),
		)
		expect(canonicalBytesReads).toBe(1)
	})

	test('caller-byte mutation after capture and after return cannot change projected schedule semantics', () => {
		const scheduleA = buildSchedule(625, 313)
		const scheduleB = buildSchedule(624, 314)
		const input = buildInput(scheduleA, { currentGrossSats: 10_000n })
		const callerBytes = scheduleA.canonical_bytes.slice()
		let canonicalBytesReads = 0
		const hostileSchedule = {} as AuctionMultipartyCanonicalSchedule

		Object.defineProperty(hostileSchedule, 'canonical_bytes', {
			get: () => {
				canonicalBytesReads += 1
				return callerBytes
			},
		})
		Object.defineProperty(hostileSchedule, 'schedule_commitment', {
			get: () => {
				callerBytes.set(scheduleB.canonical_bytes)
				return scheduleA.schedule_commitment
			},
		})

		const manifest = buildMultipartyManifestProjection({ ...input, schedule: hostileSchedule })
		callerBytes.set(scheduleB.canonical_bytes)

		expect(canonicalBytesReads).toBe(1)
		expect(manifest.payout_schedule_commitment).toBe(scheduleA.schedule_commitment)
		expect(manifest.payouts.map((payout) => payout.amount_sats)).toEqual([9_062n, 625n, 313n])
	})

	test('keeps all three commitment domains tied to the same owned canonical bytes', () => {
		const scheduleA = buildSchedule(625, 313)
		const scheduleB = buildSchedule(624, 314)
		const inputA = buildInput(scheduleA, { currentGrossSats: 10_000n })
		const inputB = buildInput(scheduleB, { currentGrossSats: 10_000n })
		const wrong = '99'.repeat(32)

		expectScheduleCode('schedule_commitment_mismatch', () =>
			buildMultipartyManifestProjection({ ...inputA, schedule: { ...scheduleA, schedule_commitment: wrong } }),
		)
		expectCode('manifest_schedule_commitment_mismatch', () =>
			buildMultipartyManifestProjection({
				...inputA,
				relations: { ...inputA.relations, payout_schedule_commitment: wrong },
			}),
		)
		expectScheduleCode('schedule_commitment_mismatch', () =>
			buildMultipartyManifestProjection({
				...inputA,
				schedule: { ...scheduleA, schedule_commitment: wrong },
				relations: { ...inputA.relations, payout_schedule_commitment: wrong },
			}),
		)
		expectScheduleCode('schedule_commitment_mismatch', () =>
			buildMultipartyManifestProjection({
				...inputA,
				schedule: { ...scheduleB, schedule_commitment: scheduleA.schedule_commitment },
			}),
		)

		const manifestB = buildMultipartyManifestProjection(inputB)
		expect(manifestB.payout_schedule_commitment).toBe(scheduleB.schedule_commitment)
		expect(manifestB.payouts.map((payout) => payout.amount_sats)).toEqual([9_062n, 624n, 314n])
	})

	test('bindings reordered to match caller-derived entries cannot override canonical bytes', () => {
		const input = buildInput()
		const entries = [...input.schedule.entries].reverse().map((entry, scheduleIndex) => ({ ...entry, schedule_index: scheduleIndex }))
		const bindings = [...input.relations.bindings]
			.reverse()
			.map((binding, scheduleIndex) => ({ ...binding, schedule_index: scheduleIndex }))

		expectCode('manifest_authorization_binding_mismatch', () =>
			buildMultipartyManifestProjection({
				...input,
				schedule: { ...input.schedule, entries },
				relations: { ...input.relations, bindings },
			}),
		)
	})

	for (const split of [
		{ field: 'recipient_pubkey', later: '99'.repeat(32) },
		{ field: 'payout_capability_event_id', later: '88'.repeat(32) },
		{ field: 'validator_offer_event_id', later: '77'.repeat(32) },
		{ field: 'validator_acceptance_event_id', later: '66'.repeat(32) },
		{ field: 'schedule_index', later: 1 },
		{ field: 'role', later: 'v4v' },
		{ field: 'allocation_bps', later: 624 },
	] as const) {
		test(`observes validator binding ${split.field} once before validation and canonical projection`, () => {
			const input = buildInput()
			const original = input.relations.bindings[0]
			const hostile = defineSplitGetter(original, split.field, original[split.field], split.later)
			const manifest = buildMultipartyManifestProjection({
				...input,
				relations: { ...input.relations, bindings: [hostile.value, input.relations.bindings[1]] },
			})

			expect(hostile.reads()).toBe(1)
			expect(manifest.payouts[1]).toMatchObject({
				schedule_index: 0,
				role: 'validator',
				recipient_pubkey: VALIDATOR,
				payout_capability_event_id: CAP_VALIDATOR,
				validator_offer_event_id: OFFER_VALIDATOR,
				validator_acceptance_event_id: ACCEPT_VALIDATOR,
			})
		})
	}

	test('observes an absent V4V acceptance once and cannot project a later supplied identity', () => {
		const input = buildInput()
		const hostile = defineSplitGetter(input.relations.bindings[1], 'validator_acceptance_event_id', undefined, '66'.repeat(32))
		const manifest = buildMultipartyManifestProjection({
			...input,
			relations: { ...input.relations, bindings: [input.relations.bindings[0], hostile.value] },
		})

		expect(hostile.reads()).toBe(1)
		expect(manifest.payouts[2].validator_acceptance_event_id).toBeNull()
	})

	test('rebid allocates only the newly locked principal delta', () => {
		const input = buildInput(buildSchedule(), {
			currentGrossSats: TWO_THOUSAND_FORTY_EIGHT_SATS,
			predecessorGrossSats: ONE_THOUSAND_TWENTY_FOUR_SATS,
		})
		const manifest = buildMultipartyManifestProjection(input)

		expect(manifest.gross_sats).toBe(TWO_THOUSAND_FORTY_EIGHT_SATS)
		expect(manifest.principal_sats).toBe(ONE_THOUSAND_TWENTY_FOUR_SATS)
		expect(manifest.previous_bid_event_id).toBe(input.bid_leg_context.predecessorEventId)
		expect(manifest.payouts.reduce((sum, payout) => sum + payout.amount_sats, ZERO_SATS)).toBe(ONE_THOUSAND_TWENTY_FOUR_SATS)
	})

	test('selected mint must be present in the supplied relation mint set', () => {
		const input = buildInput()

		expectCode('manifest_selected_mint_not_authorized', () =>
			buildMultipartyManifestProjection({
				...input,
				selected_mint: 'https://other.example',
			}),
		)
	})

	test('schedule commitment must match the authorization relations exactly', () => {
		const input = buildInput()

		expectCode('manifest_schedule_commitment_mismatch', () =>
			buildMultipartyManifestProjection({
				...input,
				relations: {
					...input.relations,
					payout_schedule_commitment: '99'.repeat(32),
				},
			}),
		)
	})

	test('authorization binding cannot drift from canonical schedule economics', () => {
		const input = buildInput()
		const bindings = input.relations.bindings.map((binding, index) =>
			index === 0
				? {
						...binding,
						allocation_bps: binding.allocation_bps + 1,
					}
				: binding,
		)

		expectCode('manifest_authorization_binding_mismatch', () =>
			buildMultipartyManifestProjection({
				...input,
				relations: {
					...input.relations,
					bindings,
				},
			}),
		)
	})

	test('positive payout requires present opaque child/proof/token construction fields', () => {
		const input = buildInput()

		expectCode('manifest_child_pubkey_invalid', () =>
			buildMultipartyManifestProjection({
				...input,
				seller: zero(),
			}),
		)
	})

	test('zero-BPS validator remains a logical row but carries no Cashu output', () => {
		const schedule = buildSchedule(0, 313)
		const input = buildInput(schedule)

		const manifest = buildMultipartyManifestProjection({
			...input,
			auxiliary: [
				{
					schedule_index: 0,
					...zero(),
				},
				input.auxiliary[1],
			],
		})

		const validator = manifest.payouts[1]

		expect(validator.role).toBe('validator')
		expect(validator.amount_sats).toBe(ZERO_SATS)
		expect(validator.child_pubkey).toBeNull()
		expect(validator.lock_secrets).toEqual([])
		expect(validator.validator_acceptance_event_id).toBe(ACCEPT_VALIDATOR)
	})

	test('zero seller remainder carries no Cashu output', () => {
		const schedule = buildSchedule(9687, 313)
		const input = buildInput(schedule)

		const manifest = buildMultipartyManifestProjection({
			...input,
			seller: zero(),
		})

		expect(manifest.payouts[0].role).toBe('seller')
		expect(manifest.payouts[0].amount_sats).toBe(ZERO_SATS)
		expect(manifest.payouts[0].child_pubkey).toBeNull()
	})

	test('proof identity cannot be reused across payout legs', () => {
		const input = buildInput()

		expectCode('manifest_proof_y_reused', () =>
			buildMultipartyManifestProjection({
				...input,
				auxiliary: [
					input.auxiliary[0],
					{
						...input.auxiliary[1],
						proof_ys: [PROOF_VALIDATOR],
					},
				],
			}),
		)
	})

	test('child keys, lock secrets, and token commitments cannot be reused across payout legs', () => {
		const input = buildInput()

		expectCode('manifest_child_pubkey_reused', () =>
			buildMultipartyManifestProjection({
				...input,
				auxiliary: [
					input.auxiliary[0],
					{
						...input.auxiliary[1],
						child_pubkey: CHILD_VALIDATOR,
					},
				],
			}),
		)

		expectCode('manifest_lock_secret_reused', () =>
			buildMultipartyManifestProjection({
				...input,
				auxiliary: [
					input.auxiliary[0],
					{
						...input.auxiliary[1],
						lock_secrets: ['validator-secret'],
					},
				],
			}),
		)

		expectCode('manifest_cashu_token_reused', () =>
			buildMultipartyManifestProjection({
				...input,
				auxiliary: [
					input.auxiliary[0],
					{
						...input.auxiliary[1],
						cashu_token: 'validator-token',
					},
				],
			}),
		)
	})

	test('legacy gross and predecessor mirrors cannot disagree with the validated context', () => {
		const firstBid = buildInput()

		expectCode('manifest_bid_leg_gross_mismatch', () =>
			buildMultipartyManifestProjection({
				...firstBid,
				gross_sats: firstBid.gross_sats + 1n,
			}),
		)

		expectCode('manifest_bid_leg_predecessor_mismatch', () =>
			buildMultipartyManifestProjection({
				...firstBid,
				previous_bid: { event_id: '55'.repeat(32), gross_sats: 1n },
			}),
		)

		const rebid = buildInput(buildSchedule(), { currentGrossSats: 1_025n, predecessorGrossSats: 1_024n })
		expectCode('manifest_bid_leg_predecessor_mismatch', () =>
			buildMultipartyManifestProjection({
				...rebid,
				previous_bid: { ...rebid.previous_bid!, gross_sats: 1_023n },
			}),
		)
	})

	test('positive rows reject empty, non-parallel, or malformed construction evidence', () => {
		const input = buildInput()

		expectCode('manifest_proof_count_invalid', () =>
			buildMultipartyManifestProjection({
				...input,
				seller: {
					...input.seller,
					proof_ys: [],
				},
			}),
		)

		expectCode('manifest_proof_y_invalid', () =>
			buildMultipartyManifestProjection({
				...input,
				seller: {
					...input.seller,
					proof_ys: [`02${'AB'.repeat(32)}`],
				},
			}),
		)

		expectCode('manifest_cashu_token_invalid', () =>
			buildMultipartyManifestProjection({
				...input,
				seller: {
					...input.seller,
					cashu_token: '',
				},
			}),
		)
	})

	for (const missing of [
		{ field: 'child_pubkey', value: null, code: 'manifest_child_pubkey_invalid' },
		{ field: 'lock_secrets', value: [], code: 'manifest_proof_count_invalid' },
		{ field: 'proof_ys', value: [], code: 'manifest_proof_count_invalid' },
		{ field: 'cashu_token', value: null, code: 'manifest_cashu_token_invalid' },
	] as const) {
		for (const row of ['seller', 'auxiliary'] as const) {
			test(`positive ${row} row rejects missing ${missing.field}`, () => {
				const input = buildInput()
				const invalidConstruction = { ...(row === 'seller' ? input.seller : input.auxiliary[0]), [missing.field]: missing.value }
				const hostileInput =
					row === 'seller' ? { ...input, seller: invalidConstruction } : { ...input, auxiliary: [invalidConstruction, input.auxiliary[1]] }

				expectCode(missing.code, () => buildMultipartyManifestProjection(hostileInput as never))
			})
		}
	}

	for (const artifact of [
		{ field: 'child_pubkey', value: CHILD_VALIDATOR },
		{ field: 'lock_secrets', value: ['forbidden-secret'] },
		{ field: 'proof_ys', value: [PROOF_VALIDATOR] },
		{ field: 'cashu_token', value: 'forbidden-token' },
	] as const) {
		test(`zero logical row rejects isolated ${artifact.field} artifact`, () => {
			const schedule = buildSchedule(0, 313)
			const input = buildInput(schedule)
			const construction = { schedule_index: 0, ...zero(), [artifact.field]: artifact.value }

			expectCode('manifest_zero_payout_has_cashu_artifact', () =>
				buildMultipartyManifestProjection({
					...input,
					auxiliary: [construction, input.auxiliary[1]],
				} as never),
			)
		})
	}

	for (const row of ['seller', 'auxiliary'] as const) {
		for (const duplicate of [
			{ field: 'lock_secrets', value: ['same-secret', 'same-secret'], code: 'manifest_lock_secret_reused' },
			{ field: 'proof_ys', value: [PROOF_SELLER, PROOF_SELLER], code: 'manifest_proof_y_reused' },
		] as const) {
			test(`${row} row rejects within-row duplicate ${duplicate.field}`, () => {
				const input = buildInput()
				const firstProofY = row === 'seller' ? PROOF_SELLER : PROOF_VALIDATOR
				const proofYs = duplicate.field === 'proof_ys' ? [firstProofY, firstProofY] : [firstProofY, `03${'04'.repeat(32)}`]
				const lockSecrets = duplicate.field === 'lock_secrets' ? duplicate.value : ['same-secret-a', 'same-secret-b']
				const base = row === 'seller' ? input.seller : input.auxiliary[0]
				const construction = { ...base, lock_secrets: lockSecrets, proof_ys: proofYs }
				const hostileInput =
					row === 'seller' ? { ...input, seller: construction } : { ...input, auxiliary: [construction, input.auxiliary[1]] }

				expectCode(duplicate.code, () => buildMultipartyManifestProjection(hostileInput as never))
			})
		}
	}

	test('does not invent a proof-count ceiling in the D1 projection layer', () => {
		const input = buildInput()
		const secrets = Array.from({ length: 65 }, (_, index) => `secret-${index}`)
		const proofYs = Array.from({ length: 65 }, (_, index) => `02${index.toString(16).padStart(64, '0')}`)

		const manifest = buildMultipartyManifestProjection({
			...input,
			seller: {
				child_pubkey: CHILD_SELLER,
				lock_secrets: secrets,
				proof_ys: proofYs,
				cashu_token: 'token',
			},
		})

		expect(manifest.payouts[0].lock_secrets).toHaveLength(65)
		expect(manifest.payouts[0].proof_ys).toHaveLength(65)
	})

	test('copies construction arrays before freezing the projection', () => {
		const input = buildInput()
		const manifest = buildMultipartyManifestProjection(input)

		input.seller.lock_secrets[0] = 'mutated-after-projection'
		input.seller.proof_ys[0] = `03${'99'.repeat(32)}`

		expect(manifest.payouts[0].lock_secrets).toEqual(['seller-secret'])
		expect(manifest.payouts[0].proof_ys).toEqual([PROOF_SELLER])
		expect(Object.isFrozen(manifest.payouts[0].lock_secrets)).toBe(true)
		expect(Object.isFrozen(manifest.payouts[0].proof_ys)).toBe(true)
	})

	for (const scalar of [
		{ field: 'selected_mint', first: MINT, later: { mint: MINT }, output: 'selected_mint', expected: MINT },
		{ field: 'locktime', first: 1_900_000_000, later: -1, output: 'locktime', expected: 1_900_000_000 },
		{ field: 'refund_pubkey', first: REFUND, later: `02${'99'.repeat(32)}`, output: 'refund_pubkey', expected: REFUND },
	] as const) {
		test(`observes top-level ${scalar.field} once and projects the owned value`, () => {
			const input = buildInput()
			const hostile = defineSplitGetter(input, scalar.field, scalar.first, scalar.later)
			const manifest = buildMultipartyManifestProjection(hostile.value)

			expect(hostile.reads()).toBe(1)
			expect(manifest[scalar.output]).toEqual(scalar.expected)
		})
	}

	for (const scalar of [
		{ field: 'child_pubkey', first: CHILD_SELLER, later: `02${'99'.repeat(32)}` },
		{ field: 'cashu_token', first: 'seller-token', later: 'attacker-token' },
	] as const) {
		test(`observes seller ${scalar.field} once before validation and projection`, () => {
			const input = buildInput()
			const hostile = defineSplitGetter(input.seller, scalar.field, scalar.first, scalar.later)
			const manifest = buildMultipartyManifestProjection({ ...input, seller: hostile.value })

			expect(hostile.reads()).toBe(1)
			expect(manifest.payouts[0].child_pubkey).toBe(CHILD_SELLER)
			expect(manifest.payouts[0].cashu_token_sha256).toBe('8a434b7a4ad70d78fa4372bcc028eb94d7aba4cc359972d11310337c31cf64a9')
		})
	}

	test('observes representative auxiliary scalar fields once', () => {
		const input = buildInput()
		let childReads = 0
		let tokenReads = 0
		const auxiliary = { ...input.auxiliary[0] }
		Object.defineProperty(auxiliary, 'child_pubkey', {
			enumerable: true,
			get: () => {
				childReads += 1
				return childReads === 1 ? CHILD_VALIDATOR : `02${'99'.repeat(32)}`
			},
		})
		Object.defineProperty(auxiliary, 'cashu_token', {
			enumerable: true,
			get: () => {
				tokenReads += 1
				return tokenReads === 1 ? 'validator-token' : 'attacker-token'
			},
		})
		const manifest = buildMultipartyManifestProjection({
			...input,
			auxiliary: [auxiliary, input.auxiliary[1]],
		})

		expect(childReads).toBe(1)
		expect(tokenReads).toBe(1)
		expect(manifest.payouts[1].child_pubkey).toBe(CHILD_VALIDATOR)
		expect(manifest.payouts[1].cashu_token_sha256).toBe('310c7ad5a652926826cd6c23b298f21ddde25fb4e5d9e4500ec8e1efbc8cc8c7')
	})

	test('observes construction array properties and elements once', () => {
		const input = buildInput()
		let secretPropertyReads = 0
		let proofPropertyReads = 0
		let secretIndexReads = 0
		let proofIndexReads = 0
		const secrets = new Proxy(['seller-secret'], {
			get: (target, property, receiver) => {
				if (property === '0') secretIndexReads += 1
				return Reflect.get(target, property, receiver)
			},
		})
		const proofs = new Proxy([PROOF_SELLER], {
			get: (target, property, receiver) => {
				if (property === '0') proofIndexReads += 1
				return Reflect.get(target, property, receiver)
			},
		})
		const seller = { ...input.seller }
		Object.defineProperty(seller, 'lock_secrets', {
			get: () => {
				secretPropertyReads += 1
				if (secretPropertyReads > 1) throw new Error('second secret-array read')
				return secrets
			},
		})
		Object.defineProperty(seller, 'proof_ys', {
			get: () => {
				proofPropertyReads += 1
				if (proofPropertyReads > 1) throw new Error('second proof-array read')
				return proofs
			},
		})

		const manifest = buildMultipartyManifestProjection({ ...input, seller })
		expect(manifest.payouts[0].lock_secrets).toEqual(['seller-secret'])
		expect(manifest.payouts[0].proof_ys).toEqual([PROOF_SELLER])
		expect([secretPropertyReads, proofPropertyReads, secretIndexReads, proofIndexReads]).toEqual([1, 1, 1, 1])
	})

	test('normalizes caller getter failures without rereading successful observations', () => {
		const input = buildInput()
		const selected = { ...input }
		Object.defineProperty(selected, 'selected_mint', {
			get: () => {
				throw new Error('caller getter failed')
			},
		})
		expectCode('manifest_selected_mint_not_authorized', () => buildMultipartyManifestProjection(selected))

		let tokenReads = 0
		const sellerAfterFirst = { ...input.seller }
		Object.defineProperty(sellerAfterFirst, 'cashu_token', {
			get: () => {
				tokenReads += 1
				if (tokenReads > 1) throw new Error('forbidden reread')
				return 'seller-token'
			},
		})
		expect(buildMultipartyManifestProjection({ ...input, seller: sellerAfterFirst }).payouts[0].cashu_token_sha256).toBe(
			'8a434b7a4ad70d78fa4372bcc028eb94d7aba4cc359972d11310337c31cf64a9',
		)
		expect(tokenReads).toBe(1)

		const sellerBeforeFirst = { ...input.seller }
		Object.defineProperty(sellerBeforeFirst, 'cashu_token', {
			get: () => {
				throw new Error('first read failed')
			},
		})
		expectCode('manifest_construction_observation_invalid', () =>
			buildMultipartyManifestProjection({ ...input, seller: sellerBeforeFirst }),
		)
	})

	test('normalizes canonical-byte copy failures at the schedule boundary', () => {
		const input = buildInput()
		const hostileBytes = new Proxy(input.schedule.canonical_bytes, {})

		expectCode('manifest_schedule_canonical_bytes_invalid', () =>
			buildMultipartyManifestProjection({
				...input,
				schedule: { ...input.schedule, canonical_bytes: hostileBytes },
			}),
		)
	})

	test('normalizes construction-array allocation failures before indexed traversal', () => {
		const input = buildInput()
		let lengthReads = 0
		let indexReads = 0
		const lockSecrets = new Proxy([], {
			get: (target, property, receiver) => {
				if (property === 'length') {
					lengthReads += 1
					return Number.MAX_SAFE_INTEGER
				}
				if (typeof property === 'string' && /^\d+$/.test(property)) indexReads += 1
				return Reflect.get(target, property, receiver)
			},
		})

		expectCode('manifest_proof_arrays_invalid', () =>
			buildMultipartyManifestProjection({
				...input,
				seller: { ...input.seller, lock_secrets: lockSecrets },
			} as never),
		)
		expect(lengthReads).toBe(1)
		expect(indexReads).toBe(0)
	})

	test('rejects binding count mismatch before indexed traversal', () => {
		const input = buildInput()
		let lengthReads = 0
		let indexReads = 0
		const bindings = new Proxy([], {
			get: (target, property, receiver) => {
				if (property === 'length') {
					lengthReads += 1
					return 100_000
				}
				if (typeof property === 'string' && /^\d+$/.test(property)) indexReads += 1
				return Reflect.get(target, property, receiver)
			},
		})

		expectCode('manifest_binding_count_mismatch', () =>
			buildMultipartyManifestProjection({
				...input,
				relations: { ...input.relations, bindings },
			} as never),
		)
		expect(lengthReads).toBe(1)
		expect(indexReads).toBe(0)
	})

	test('rejects auxiliary count mismatch before indexed traversal', () => {
		const input = buildInput()
		let lengthReads = 0
		let indexReads = 0
		const auxiliary = new Proxy([], {
			get: (target, property, receiver) => {
				if (property === 'length') {
					lengthReads += 1
					return 100_000
				}
				if (typeof property === 'string' && /^\d+$/.test(property)) indexReads += 1
				return Reflect.get(target, property, receiver)
			},
		})

		expectCode('manifest_auxiliary_construction_count_mismatch', () => buildMultipartyManifestProjection({ ...input, auxiliary } as never))
		expect(lengthReads).toBe(1)
		expect(indexReads).toBe(0)
	})

	for (const reportedLength of [AUCTION_MULTIPARTY_MAX_MINTS + 1, 100_000]) {
		test(`rejects relation mint length ${reportedLength} before indexed traversal`, () => {
			const input = buildInput()
			let lengthReads = 0
			let indexReads = 0
			const mints = new Proxy([], {
				get: (target, property, receiver) => {
					if (property === 'length') {
						lengthReads += 1
						return reportedLength
					}
					if (typeof property === 'string' && /^\d+$/.test(property)) indexReads += 1
					return Reflect.get(target, property, receiver)
				},
			})

			expectCode('manifest_mint_count_exceeds_limit', () =>
				buildMultipartyManifestProjection({
					...input,
					relations: { ...input.relations, mints },
				} as never),
			)
			expect(lengthReads).toBe(1)
			expect(indexReads).toBe(0)
		})
	}

	test('accepts the frozen C1 maximum of 16 relation mint strings', () => {
		const input = buildInput()
		const mints = [MINT, ...Array.from({ length: AUCTION_MULTIPARTY_MAX_MINTS - 1 }, (_, index) => `https://mint-${index}.example`)]
		const manifest = buildMultipartyManifestProjection({
			...input,
			relations: { ...input.relations, mints },
		})

		expect(mints).toHaveLength(16)
		expect(manifest.selected_mint).toBe(MINT)
	})

	test('rejects an inspected relation mint above the frozen C1 byte ceiling', () => {
		const input = buildInput()
		const oversizedMint = 'm'.repeat(AUCTION_MULTIPARTY_MAX_MINT_BYTES + 1)

		expectCode('manifest_mint_bytes_exceeds_limit', () =>
			buildMultipartyManifestProjection({
				...input,
				relations: { ...input.relations, mints: [oversizedMint, MINT] },
			}),
		)
	})

	test('rejects malformed root identity before later relation mismatches', () => {
		const input = buildInput()

		expectCode('manifest_root_event_id_invalid', () =>
			buildMultipartyManifestProjection({
				...input,
				relations: {
					...input.relations,
					root_event_id: input.relations.root_event_id.toUpperCase(),
					payout_schedule_commitment: '99'.repeat(32),
				},
			}),
		)
	})

	test('requires genuine bid-leg provenance for first bids and rebids', () => {
		const firstBid = buildInput()
		const rebid = buildInput(buildSchedule(), { currentGrossSats: 1_025n, predecessorGrossSats: 1_024n })

		expect(buildMultipartyManifestProjection(firstBid).principal_sats).toBe(1_024n)
		expect(
			buildMultipartyManifestProjection({
				...rebid,
				seller: positive(CHILD_SELLER, 'rebid-seller', PROOF_SELLER, 'rebid-seller-token'),
				auxiliary: [
					{ schedule_index: 0, ...zero() },
					{ schedule_index: 1, ...zero() },
				],
			}).principal_sats,
		).toBe(1n)
	})

	test('rejects structural, serialized, and legacy predecessor lookalikes', () => {
		const input = buildInput()
		const structuralClone = { ...input.bid_leg_context }
		const serializedCopy = JSON.parse(
			JSON.stringify(input.bid_leg_context, (_, value) => (typeof value === 'bigint' ? value.toString() : value)),
		)
		const legacy = { event_id: '55'.repeat(32), gross_sats: 1n }

		for (const bidLegContext of [structuralClone, serializedCopy, legacy]) {
			expectBidLegCode('bid_leg_context_provenance_invalid', () =>
				buildMultipartyManifestProjection({ ...input, bid_leg_context: bidLegContext } as never),
			)
		}
	})

	test('rejects context from another auction root before construction semantics', () => {
		const input = buildInput()

		expectCode('manifest_bid_leg_root_mismatch', () =>
			buildMultipartyManifestProjection({
				...input,
				relations: { ...input.relations, root_event_id: 'ff'.repeat(32) },
				seller: null as never,
			}),
		)
	})

	test('a profile-mutated context clone fails provenance admission', () => {
		const input = buildInput()

		expectBidLegCode('bid_leg_context_provenance_invalid', () =>
			buildMultipartyManifestProjection({
				...input,
				bid_leg_context: { ...input.bid_leg_context, profile: 'cashu_p2pk_bidder_path_v1' },
			} as never),
		)
	})

	test('malformed D1 containers fail with deterministic domain errors', () => {
		const input = buildInput()

		expectCode('manifest_input_invalid', () => buildMultipartyManifestProjection(null as never))
		expectCode('manifest_input_invalid', () => buildMultipartyManifestProjection([] as never))
		expectCode('manifest_schedule_container_invalid', () => buildMultipartyManifestProjection({ ...input, schedule: null } as never))
		expectCode('manifest_relations_container_invalid', () => buildMultipartyManifestProjection({ ...input, relations: null } as never))
		expectCode('manifest_bindings_container_invalid', () =>
			buildMultipartyManifestProjection({
				...input,
				relations: { ...input.relations, bindings: null },
			} as never),
		)
		expectCode('manifest_authorization_binding_invalid', () =>
			buildMultipartyManifestProjection({
				...input,
				relations: { ...input.relations, bindings: [null, input.relations.bindings[1]] },
			} as never),
		)
		expectCode('manifest_seller_construction_invalid', () => buildMultipartyManifestProjection({ ...input, seller: null } as never))
		expectCode('manifest_auxiliary_container_invalid', () => buildMultipartyManifestProjection({ ...input, auxiliary: null } as never))
		expectCode('manifest_auxiliary_container_invalid', () => buildMultipartyManifestProjection({ ...input, auxiliary: {} } as never))
		expectCode('manifest_proof_arrays_invalid', () =>
			buildMultipartyManifestProjection({
				...input,
				seller: { ...input.seller, lock_secrets: null },
			} as never),
		)
		expectCode('manifest_auxiliary_construction_invalid', () =>
			buildMultipartyManifestProjection({ ...input, auxiliary: [null, input.auxiliary[1]] } as never),
		)
	})

	test('compound-invalid inputs follow the frozen validation precedence', () => {
		const input = buildInput()

		expectBidLegCode('bid_leg_context_provenance_invalid', () =>
			buildMultipartyManifestProjection({ ...input, bid_leg_context: {}, schedule: null } as never),
		)
		expectScheduleCode('schedule_commitment_mismatch', () =>
			buildMultipartyManifestProjection({
				...input,
				schedule: { ...input.schedule, schedule_commitment: '99'.repeat(32) },
				relations: null,
			} as never),
		)
		expectCode('manifest_bindings_container_invalid', () =>
			buildMultipartyManifestProjection({
				...input,
				relations: { ...input.relations, root_event_id: 'ff'.repeat(32), bindings: null },
				seller: null,
			} as never),
		)
		expectCode('manifest_seller_construction_invalid', () =>
			buildMultipartyManifestProjection({ ...input, seller: null, selected_mint: 'https://wrong.example' } as never),
		)
	})

	test('projects exactly one seller plus the maximum 16 canonical auxiliary rows', () => {
		const maximumSchedule = compileSourceSchedule([
			{
				role: 'validator',
				recipient_pubkey: VALIDATOR,
				payout_capability_event_id: 'a0'.repeat(32),
				allocation_bps: 1,
				validator_offer_event_id: 'b0'.repeat(32),
			},
			...Array.from({ length: 15 }, (_, index) => ({
				role: 'v4v' as const,
				recipient_pubkey: (index + 1).toString(16).padStart(64, '0'),
				payout_capability_event_id: (index + 101).toString(16).padStart(64, '0'),
				allocation_bps: 1,
			})),
		])
		const input = buildInput(maximumSchedule, { currentGrossSats: 160_000n })
		const auxiliary = maximumSchedule.entries.map((entry, index) => ({
			schedule_index: entry.schedule_index,
			...positive(
				`02${(index + 100).toString(16).padStart(64, '0')}`,
				`maximum-secret-${index}`,
				`03${(index + 1_000).toString(16).padStart(64, '0')}`,
				`maximum-token-${index}`,
			),
		}))
		const manifest = buildMultipartyManifestProjection({ ...input, auxiliary })

		expect(manifest.payouts).toHaveLength(17)
		expect(manifest.payouts[0].role).toBe('seller')
		expect(manifest.payouts.slice(1).map((payout) => payout.schedule_index)).toEqual(
			maximumSchedule.entries.map((entry) => entry.schedule_index),
		)
		expect(manifest.payouts.reduce((sum, payout) => sum + payout.amount_sats, 0n)).toBe(160_000n)
	})

	test('conserves the frozen maximum gross amount without number coercion', () => {
		const maximumGrossSats = 2_100_000_000_000_000n
		const input = buildInput(buildSchedule(), { currentGrossSats: maximumGrossSats })
		const manifest = buildMultipartyManifestProjection(input)

		expect(manifest.gross_sats).toBe(maximumGrossSats)
		expect(manifest.principal_sats).toBe(maximumGrossSats)
		expect(manifest.payouts.reduce((sum, payout) => sum + payout.amount_sats, 0n)).toBe(maximumGrossSats)
	})

	test('structural clone is not a genuine in-process projection', () => {
		const manifest = buildMultipartyManifestProjection(buildInput())

		expect(
			isMultipartyManifestProjection({
				...manifest,
			}),
		).toBe(false)
	})

	test('serialized projection is not a genuine in-process projection', () => {
		const manifest = buildMultipartyManifestProjection(buildInput())
		const serialized = JSON.parse(JSON.stringify(manifest, (_, value) => (typeof value === 'bigint' ? value.toString() : value)))

		expect(isMultipartyManifestProjection(serialized)).toBe(false)
	})
})
