import { describe, expect, test } from 'bun:test'
import { base64urlnopad } from '@scure/base'
import { finalizeEvent, getPublicKey, verifyEvent } from 'nostr-tools'
import type { Event } from 'nostr-tools'
import type { NostrEventLike } from '../nostr/eventLike'
import { AUCTION_MULTIPARTY_ROOT_KIND } from '../auction/multipartyAuthorization'
import {
	AUCTION_MULTIPARTY_BID_ENVELOPE_MAX_CONTENT_UTF8_BYTES,
	AUCTION_MULTIPARTY_BID_ENVELOPE_MAX_TAG_ELEMENT_UTF8_BYTES,
	AUCTION_MULTIPARTY_BID_ENVELOPE_MAX_TAG_ELEMENTS,
	AUCTION_MULTIPARTY_BID_ENVELOPE_MAX_TAGS,
	AUCTION_MULTIPARTY_BID_ENVELOPE_MAX_TAGS_UTF8_BYTES,
	AUCTION_MULTIPARTY_MAX_PREDECESSOR_EVENTS,
	AuctionMultipartyBidLegContextError,
	assertValidatedMultipartyBidLegContext,
	buildValidatedMultipartyBidLegContext,
	isValidatedMultipartyBidLegContext,
} from '../auction/multipartyBidLegContext'
import type { AuctionMultipartyBidLegContextErrorCode } from '../auction/multipartyBidLegContext'
import { AUCTION_MULTIPARTY_SETTLEMENT_POLICY, compileSourceSchedule } from '../auction/multipartySchedule'

const CREATED_AT = 1_800_000_000
const MINT = 'https://mint.example'
const XPUB = 'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8'

const fixedSecret = (lastByte: number): Uint8Array => {
	const secret = new Uint8Array(32)
	secret[31] = lastByte
	return secret
}

const SELLER_SECRET = fixedSecret(1)
const BIDDER_SECRET = fixedSecret(2)
const OTHER_BIDDER_SECRET = fixedSecret(3)
const VALIDATOR = getPublicKey(fixedSecret(4))
const SELLER = getPublicKey(SELLER_SECRET)
const BIDDER = getPublicKey(BIDDER_SECRET)
const OTHER_BIDDER = getPublicKey(OTHER_BIDDER_SECRET)

const signEvent = (secretKey: Uint8Array, kind: number, tags: string[][], content = ''): NostrEventLike =>
	finalizeEvent(
		{
			kind,
			created_at: CREATED_AT,
			tags,
			content,
		},
		secretKey,
	)

const schedule = compileSourceSchedule([
	{
		role: 'validator',
		recipient_pubkey: VALIDATOR,
		payout_capability_event_id: 'a'.repeat(64),
		allocation_bps: 100,
		validator_offer_event_id: 'b'.repeat(64),
	},
])

const makeRoot = (profile = AUCTION_MULTIPARTY_SETTLEMENT_POLICY): NostrEventLike =>
	signEvent(
		SELLER_SECRET,
		AUCTION_MULTIPARTY_ROOT_KIND,
		[
			['d', 'bid-leg-context'],
			['settlement_policy', profile],
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

const ROOT = makeRoot()
const COORDINATE = `${AUCTION_MULTIPARTY_ROOT_KIND}:${SELLER}:bid-leg-context`

interface MakeBidOptions {
	readonly amount: string
	readonly previous?: NostrEventLike
	readonly rootEventId?: string
	readonly coordinate?: string
	readonly sellerPubkey?: string
	readonly bidderSecret?: Uint8Array
}

const makeBid = ({
	amount,
	previous,
	rootEventId = ROOT.id,
	coordinate = COORDINATE,
	sellerPubkey = SELLER,
	bidderSecret = BIDDER_SECRET,
}: MakeBidOptions): NostrEventLike =>
	signEvent(bidderSecret, 1023, [
		['e', rootEventId],
		['a', coordinate],
		['p', sellerPubkey],
		['amount', amount],
		['currency', 'SAT'],
		['mint', MINT],
		['locktime', String(CREATED_AT + 7_200)],
		['refund_pubkey', `02${'1'.repeat(64)}`],
		['child_pubkey', `03${'2'.repeat(64)}`],
		['lock_secret', `secret-${amount}`],
		['proof_y', `02${'3'.repeat(64)}`],
		['created_for_end_at', String(CREATED_AT + 3_600)],
		['bid_nonce', `nonce-${amount}`],
		['key_scheme', 'hd_p2pk'],
		['status', 'locked'],
		...(previous ? [['prev_bid', previous.id]] : []),
	])

const inputFor = (
	currentGrossSats: bigint,
	predecessorEvents: readonly NostrEventLike[] = [],
	predecessorEventId: string | null = predecessorEvents.at(-1)?.id ?? null,
) => ({
	rootEvent: ROOT,
	bidderPubkey: BIDDER,
	currentGrossSats,
	predecessorEventId,
	predecessorEvents,
})

const expectBidLegError = (expectedCode: AuctionMultipartyBidLegContextErrorCode, operation: () => unknown): void => {
	try {
		operation()
		throw new Error(`Expected ${expectedCode}, but operation succeeded`)
	} catch (error) {
		expect(error).toBeInstanceOf(AuctionMultipartyBidLegContextError)
		expect((error as AuctionMultipartyBidLegContextError).code).toBe(expectedCode)
	}
}

const replacePrevBid = (event: NostrEventLike, id: string, prevBidId: string): NostrEventLike => ({
	...event,
	id,
	tags: [...event.tags.filter((tag) => tag[0] !== 'prev_bid'), ['prev_bid', prevBidId]],
})

const replaceTagValue = (tags: readonly string[][], name: string, value: string): string[][] =>
	tags.map((tag) => (tag[0] === name ? [name, value] : [...tag]))

const aggregateTagUtf8Bytes = (tags: readonly string[][]): number => {
	const encoder = new TextEncoder()
	return tags.reduce((total, tag) => total + tag.reduce((tagTotal, element) => tagTotal + encoder.encode(element).byteLength, 0), 0)
}

const padTagsToAggregateUtf8Bytes = (source: readonly string[][], targetBytes: number): string[][] => {
	const tags = source.map((tag) => [...tag])
	let remaining = targetBytes - aggregateTagUtf8Bytes(tags)

	while (remaining > 0) {
		const elementBytes = Math.min(remaining, AUCTION_MULTIPARTY_BID_ENVELOPE_MAX_TAG_ELEMENT_UTF8_BYTES)
		tags.push(['x'.repeat(elementBytes)])
		remaining -= elementBytes
	}

	return tags
}

const resignBidTags = (event: NostrEventLike, tags: string[][]): NostrEventLike => signEvent(BIDDER_SECRET, event.kind, tags, event.content)

const makeSplitEnvelope = (signedEvent: NostrEventLike, semanticTags: string[][]): NostrEventLike => {
	const splitEvent = { ...signedEvent }

	Object.defineProperty(splitEvent, 'tags', {
		enumerable: true,
		get: () => (new Error().stack?.includes('verifySignature') ? signedEvent.tags : semanticTags),
	})

	return splitEvent
}

describe('validated multiparty bid-leg context', () => {
	test('builds a first-bid context with principal equal to current gross', () => {
		const context = buildValidatedMultipartyBidLegContext(inputFor(1_000n))

		expect(context).toMatchObject({
			profile: AUCTION_MULTIPARTY_SETTLEMENT_POLICY,
			auctionRootEventId: ROOT.id,
			auctionCoordinate: COORDINATE,
			bidderPubkey: BIDDER,
			currentGrossSats: 1_000n,
			predecessorEventId: null,
			predecessorGrossSats: null,
			principalSats: 1_000n,
		})
		expect(isValidatedMultipartyBidLegContext(context)).toBe(true)
	})

	test('authenticates one predecessor and derives the rebid principal', () => {
		const first = makeBid({ amount: '1000' })
		const context = buildValidatedMultipartyBidLegContext(inputFor(1_250n, [first]))

		expect(context.predecessorEventId).toBe(first.id)
		expect(context.predecessorGrossSats).toBe(1_000n)
		expect(context.principalSats).toBe(250n)
	})

	test('rejects split-envelope amount semantics reproduced from the previous candidate', () => {
		const signed = makeBid({ amount: '1000' })
		const semanticTags = replaceTagValue(signed.tags, 'amount', '900')
		const split = makeSplitEnvelope(signed, semanticTags)

		expectBidLegError('bid_leg_predecessor_signature_invalid', () =>
			buildValidatedMultipartyBidLegContext(inputFor(1_100n, [split], signed.id)),
		)
	})

	for (const split of [
		{ name: 'e', signed: makeBid({ amount: '1000', rootEventId: 'f'.repeat(64) }), semanticValue: ROOT.id },
		{
			name: 'a',
			signed: makeBid({ amount: '1000', coordinate: `${AUCTION_MULTIPARTY_ROOT_KIND}:${SELLER}:other` }),
			semanticValue: COORDINATE,
		},
		{ name: 'p', signed: makeBid({ amount: '1000', sellerPubkey: OTHER_BIDDER }), semanticValue: SELLER },
	] as const) {
		test(`rejects split-envelope ${split.name} semantics`, () => {
			const semanticTags = replaceTagValue(split.signed.tags, split.name, split.semanticValue)
			const splitEvent = makeSplitEnvelope(split.signed, semanticTags)

			expectBidLegError('bid_leg_predecessor_signature_invalid', () =>
				buildValidatedMultipartyBidLegContext(inputFor(1_200n, [splitEvent], split.signed.id)),
			)
		})
	}

	test('rejects split-envelope prev_bid chain semantics', () => {
		const first = makeBid({ amount: '1000' })
		const unrelatedParent = { id: 'f'.repeat(64) } as NostrEventLike
		const signed = makeBid({ amount: '1200', previous: unrelatedParent })
		const semanticTags = replaceTagValue(signed.tags, 'prev_bid', first.id)
		const split = makeSplitEnvelope(signed, semanticTags)

		expectBidLegError('bid_leg_predecessor_signature_invalid', () =>
			buildValidatedMultipartyBidLegContext(inputFor(1_400n, [first, split], signed.id)),
		)
	})

	test('accepts a shuffled multi-rebid set only with its exact direct head selected', () => {
		const first = makeBid({ amount: '1000' })
		const second = makeBid({ amount: '1250', previous: first })
		const third = makeBid({ amount: '1500', previous: second })

		const context = buildValidatedMultipartyBidLegContext(inputFor(1_900n, [second, first, third], third.id))

		expect(context.predecessorEventId).toBe(third.id)
		expect(context.predecessorGrossSats).toBe(1_500n)
		expect(context.principalSats).toBe(400n)
	})

	test('rejects a predecessor from the wrong root', () => {
		const bid = makeBid({ amount: '1000', rootEventId: 'f'.repeat(64) })
		expectBidLegError('bid_leg_predecessor_root_mismatch', () => buildValidatedMultipartyBidLegContext(inputFor(1_200n, [bid])))
	})

	test('rejects a predecessor from the wrong coordinate', () => {
		const bid = makeBid({ amount: '1000', coordinate: `${AUCTION_MULTIPARTY_ROOT_KIND}:${SELLER}:other` })
		expectBidLegError('bid_leg_predecessor_coordinate_mismatch', () => buildValidatedMultipartyBidLegContext(inputFor(1_200n, [bid])))
	})

	test('rejects a predecessor signed by another bidder', () => {
		const bid = makeBid({ amount: '1000', bidderSecret: OTHER_BIDDER_SECRET })
		expectBidLegError('bid_leg_predecessor_bidder_mismatch', () => buildValidatedMultipartyBidLegContext(inputFor(1_200n, [bid])))
	})

	for (const singleton of [
		{ name: 'e', conflictingValue: 'f'.repeat(64) },
		{ name: 'a', conflictingValue: `${AUCTION_MULTIPARTY_ROOT_KIND}:${SELLER}:other` },
		{ name: 'p', conflictingValue: OTHER_BIDDER },
	] as const) {
		test(`rejects equal and conflicting duplicate ${singleton.name} tags`, () => {
			const base = makeBid({ amount: '1000' })
			const original = base.tags.find((tag) => tag[0] === singleton.name)!
			const equal = resignBidTags(base, [...base.tags.map((tag) => [...tag]), [...original]])
			const conflicting = resignBidTags(base, [...base.tags.map((tag) => [...tag]), [singleton.name, singleton.conflictingValue]])

			expectBidLegError('bid_leg_predecessor_event_invalid', () => buildValidatedMultipartyBidLegContext(inputFor(1_200n, [equal])))
			expectBidLegError('bid_leg_predecessor_event_invalid', () => buildValidatedMultipartyBidLegContext(inputFor(1_200n, [conflicting])))
		})
	}

	test('rejects equal and conflicting duplicate amount tags', () => {
		const base = makeBid({ amount: '1000' })
		const equal = resignBidTags(base, [...base.tags.map((tag) => [...tag]), ['amount', '1000']])
		const conflicting = resignBidTags(base, [...base.tags.map((tag) => [...tag]), ['amount', '999']])

		expectBidLegError('bid_leg_predecessor_amount_invalid', () => buildValidatedMultipartyBidLegContext(inputFor(1_200n, [equal])))
		expectBidLegError('bid_leg_predecessor_amount_invalid', () => buildValidatedMultipartyBidLegContext(inputFor(1_200n, [conflicting])))
	})

	test('rejects equal and conflicting duplicate prev_bid tags', () => {
		const first = makeBid({ amount: '1000' })
		const base = makeBid({ amount: '1200', previous: first })
		const equal = resignBidTags(base, [...base.tags.map((tag) => [...tag]), ['prev_bid', first.id]])
		const conflicting = resignBidTags(base, [...base.tags.map((tag) => [...tag]), ['prev_bid', 'f'.repeat(64)]])

		expectBidLegError('bid_leg_predecessor_event_invalid', () =>
			buildValidatedMultipartyBidLegContext(inputFor(1_400n, [first, equal], equal.id)),
		)
		expectBidLegError('bid_leg_predecessor_event_invalid', () =>
			buildValidatedMultipartyBidLegContext(inputFor(1_400n, [first, conflicting], conflicting.id)),
		)
	})

	test('requires exact two-element tuples for security-critical singleton tags', () => {
		for (const name of ['e', 'a', 'p', 'amount', 'prev_bid']) {
			const first = makeBid({ amount: '1000' })
			const base = name === 'prev_bid' ? makeBid({ amount: '1200', previous: first }) : first
			const malformedTags = base.tags.map((tag) => (tag[0] === name ? [...tag, 'extra'] : [...tag]))
			const malformed = resignBidTags(base, malformedTags)
			const expected = name === 'amount' ? 'bid_leg_predecessor_amount_invalid' : 'bid_leg_predecessor_event_invalid'

			expectBidLegError(expected, () =>
				buildValidatedMultipartyBidLegContext(inputFor(1_400n, name === 'prev_bid' ? [first, malformed] : [malformed], malformed.id)),
			)
		}
	})

	test('accepts additive dleq_proof and unrelated profile-like tags without granting them authority', () => {
		const base = makeBid({ amount: '1000' })
		const dleqProof = JSON.stringify({ id: '00', amount: 1000, C: `02${'4'.repeat(64)}`, e: '00', s: '00', r: '00' })
		const bid = resignBidTags(base, [
			...base.tags.map((tag) => [...tag]),
			['dleq_proof', dleqProof],
			['settlement_policy', 'attacker_supplied_profile'],
		])

		const context = buildValidatedMultipartyBidLegContext(inputFor(1_200n, [bid], bid.id))
		expect(context.profile).toBe(AUCTION_MULTIPARTY_SETTLEMENT_POLICY)
		expect(context.predecessorGrossSats).toBe(1_000n)
	})

	test('rejects a root carrying a different settlement profile', () => {
		expectBidLegError('bid_leg_root_profile_unsupported', () =>
			buildValidatedMultipartyBidLegContext({ ...inputFor(1_000n), rootEvent: makeRoot('cashu_p2pk_bidder_path_v1') }),
		)
	})

	test('rejects an unrelated selected predecessor event id', () => {
		const first = makeBid({ amount: '1000' })
		expectBidLegError('bid_leg_predecessor_event_unavailable', () =>
			buildValidatedMultipartyBidLegContext(inputFor(1_200n, [first], 'f'.repeat(64))),
		)
	})

	test('rejects duplicate event identities before signature or graph processing', () => {
		const bid = makeBid({ amount: '1000' })
		expectBidLegError('bid_leg_predecessor_event_duplicate', () =>
			buildValidatedMultipartyBidLegContext(inputFor(1_200n, [bid, bid], bid.id)),
		)
	})

	test('rejects a signed predecessor whose parent is missing from the exact supplied set', () => {
		const missing = { id: 'f'.repeat(64) } as NostrEventLike
		const bid = makeBid({ amount: '1000', previous: missing })
		expectBidLegError('bid_leg_predecessor_parent_unavailable', () =>
			buildValidatedMultipartyBidLegContext(inputFor(1_200n, [bid], bid.id)),
		)
	})

	test('rejects signed sibling heads', () => {
		const first = makeBid({ amount: '1000' })
		const left = makeBid({ amount: '1200', previous: first })
		const right = makeBid({ amount: '1300', previous: first })
		expectBidLegError('bid_leg_predecessor_chain_disconnected', () =>
			buildValidatedMultipartyBidLegContext(inputFor(1_500n, [right, first, left], left.id)),
		)
	})

	test('rejects signed disconnected chains', () => {
		const first = makeBid({ amount: '1000' })
		const head = makeBid({ amount: '1200', previous: first })
		const disconnected = makeBid({ amount: '1100' })
		expectBidLegError('bid_leg_predecessor_chain_disconnected', () =>
			buildValidatedMultipartyBidLegContext(inputFor(1_500n, [head, disconnected, first], head.id)),
		)
	})

	test('rejects an ancestor selected instead of the direct supplied chain head', () => {
		const first = makeBid({ amount: '1000' })
		const second = makeBid({ amount: '1200', previous: first })
		expectBidLegError('bid_leg_predecessor_not_chain_head', () =>
			buildValidatedMultipartyBidLegContext(inputFor(1_400n, [first, second], first.id)),
		)
	})

	test('rejects unauthenticated self-reference before graph conclusions', () => {
		const bid = replacePrevBid(makeBid({ amount: '1000' }), 'a'.repeat(64), 'a'.repeat(64))
		expectBidLegError('bid_leg_predecessor_signature_invalid', () => buildValidatedMultipartyBidLegContext(inputFor(1_200n, [bid], bid.id)))
	})

	test('rejects a compound-invalid cycle before graph conclusions with permutation-stable failure', () => {
		const firstId = 'a'.repeat(64)
		const secondId = 'b'.repeat(64)
		const first = replacePrevBid(makeBid({ amount: '1000' }), firstId, secondId)
		const second = replacePrevBid(makeBid({ amount: '1200' }), secondId, firstId)
		expectBidLegError('bid_leg_predecessor_signature_invalid', () =>
			buildValidatedMultipartyBidLegContext(inputFor(1_400n, [first, second], second.id)),
		)
		expectBidLegError('bid_leg_predecessor_signature_invalid', () =>
			buildValidatedMultipartyBidLegContext(inputFor(1_400n, [second, first], second.id)),
		)
	})

	test('rejects equal and decreasing current cumulative amounts', () => {
		const first = makeBid({ amount: '1000' })
		expectBidLegError('bid_leg_current_amount_not_increasing', () => buildValidatedMultipartyBidLegContext(inputFor(1_000n, [first])))
		expectBidLegError('bid_leg_current_amount_not_increasing', () => buildValidatedMultipartyBidLegContext(inputFor(999n, [first])))
	})

	test('accepts an exact one-sat increment', () => {
		const first = makeBid({ amount: '1000' })
		const context = buildValidatedMultipartyBidLegContext(inputFor(1_001n, [first]))

		expect(context.predecessorGrossSats).toBe(1_000n)
		expect(context.principalSats).toBe(1n)
	})

	test('accepts the maximum current gross and rejects one sat above it', () => {
		const maximum = 2_100_000_000_000_000n
		expect(buildValidatedMultipartyBidLegContext(inputFor(maximum)).currentGrossSats).toBe(maximum)
		expectBidLegError('bid_leg_current_gross_sats_invalid', () => buildValidatedMultipartyBidLegContext(inputFor(maximum + 1n)))

		const predecessor = makeBid({ amount: String(maximum - 1n) })
		expect(buildValidatedMultipartyBidLegContext(inputFor(maximum, [predecessor], predecessor.id)).principalSats).toBe(1n)
	})

	test('rejects a non-increasing amount inside the supplied chain', () => {
		const first = makeBid({ amount: '1000' })
		const second = makeBid({ amount: '1000', previous: first })
		expectBidLegError('bid_leg_predecessor_amount_not_increasing', () =>
			buildValidatedMultipartyBidLegContext(inputFor(1_200n, [first, second], second.id)),
		)
	})

	test('rejects malformed and noncanonical predecessor amounts at the admission boundary', () => {
		for (const amount of ['1000x', '+1000', '01000', '0', '-1']) {
			const bid = makeBid({ amount })
			expectBidLegError('bid_leg_predecessor_amount_invalid', () => buildValidatedMultipartyBidLegContext(inputFor(1_200n, [bid])))
		}
	})

	test('does not accept caller-selected predecessor gross or principal values', () => {
		const first = makeBid({ amount: '1000' })
		const context = buildValidatedMultipartyBidLegContext({
			...inputFor(1_250n, [first]),
			predecessorGrossSats: 1n,
			principalSats: 1n,
		} as Parameters<typeof buildValidatedMultipartyBidLegContext>[0])

		expect(context.predecessorGrossSats).toBe(1_000n)
		expect(context.principalSats).toBe(250n)
	})

	test('rejects a structural clone of a genuine branded context', () => {
		const context = buildValidatedMultipartyBidLegContext(inputFor(1_000n))
		const clone = { ...context }
		const serialized = JSON.parse(JSON.stringify(context, (_, value) => (typeof value === 'bigint' ? value.toString() : value)))

		expect(isValidatedMultipartyBidLegContext(clone)).toBe(false)
		expect(isValidatedMultipartyBidLegContext(serialized)).toBe(false)
		expectBidLegError('bid_leg_context_provenance_invalid', () => assertValidatedMultipartyBidLegContext(clone))
		expectBidLegError('bid_leg_context_provenance_invalid', () => assertValidatedMultipartyBidLegContext(serialized))
		assertValidatedMultipartyBidLegContext(context)
	})

	test('isolates the immutable result from later input mutation', () => {
		const first = makeBid({ amount: '1000' })
		const predecessorEvents = [first]
		const input = inputFor(1_250n, predecessorEvents)
		const context = buildValidatedMultipartyBidLegContext(input)

		predecessorEvents.length = 0
		first.tags[3][1] = '1'

		expect(context.predecessorEventId).toBe(first.id)
		expect(context.predecessorGrossSats).toBe(1_000n)
		expect(context.principalSats).toBe(250n)
		expect(Object.isFrozen(context)).toBe(true)
	})

	test('reads each caller-owned predecessor envelope field once', () => {
		const signed = makeBid({ amount: '1000' })
		const reads = new Map<string, number>()
		const event = {} as NostrEventLike

		for (const field of ['id', 'pubkey', 'kind', 'created_at', 'tags', 'content', 'sig'] as const) {
			Object.defineProperty(event, field, {
				enumerable: true,
				get: () => {
					reads.set(field, (reads.get(field) ?? 0) + 1)
					return signed[field]
				},
			})
		}

		expect(buildValidatedMultipartyBidLegContext(inputFor(1_200n, [event], signed.id)).principalSats).toBe(200n)
		for (const field of ['id', 'pubkey', 'kind', 'created_at', 'tags', 'content', 'sig']) {
			expect(reads.get(field)).toBe(1)
		}
	})

	test('rejects a million-character signature before traversing tags or invoking verification', () => {
		const signed = makeBid({ amount: '1000' })
		let tagIndexReads = 0
		const tags = new Proxy(
			signed.tags.map((tag) => [...tag]),
			{
				get: (target, property, receiver) => {
					if (typeof property === 'string' && /^\d+$/.test(property)) tagIndexReads += 1
					return Reflect.get(target, property, receiver)
				},
			},
		)
		const hostile = { ...signed, tags, sig: 'a'.repeat(1_000_000) }

		let error: unknown
		try {
			buildValidatedMultipartyBidLegContext(inputFor(1_200n, [hostile], signed.id))
		} catch (caught) {
			error = caught
		}

		expect(tagIndexReads).toBe(0)
		expect(error).toBeInstanceOf(AuctionMultipartyBidLegContextError)
		expect((error as AuctionMultipartyBidLegContextError).code).toBe('bid_leg_predecessor_event_shape_invalid')
	})

	test('admits exactly 128 hexadecimal signature characters to normal verification', () => {
		const valid = makeBid({ amount: '1000' })
		const invalidButShapeValid = { ...valid, sig: 'A'.repeat(128) }

		expect(buildValidatedMultipartyBidLegContext(inputFor(1_200n, [valid], valid.id)).principalSats).toBe(200n)
		expectBidLegError('bid_leg_predecessor_signature_invalid', () =>
			buildValidatedMultipartyBidLegContext(inputFor(1_200n, [invalidButShapeValid], valid.id)),
		)
	})

	test('rejects malformed signature shapes before tag traversal', () => {
		const signed = makeBid({ amount: '1000' })
		for (const signature of [
			'0'.repeat(127),
			'0'.repeat(129),
			'g'.repeat(128),
			`${'0'.repeat(127)} `,
			`0x${'0'.repeat(126)}`,
			'',
			1,
		] as unknown[]) {
			let tagIndexReads = 0
			const tags = new Proxy(
				signed.tags.map((tag) => [...tag]),
				{
					get: (target, property, receiver) => {
						if (typeof property === 'string' && /^\d+$/.test(property)) tagIndexReads += 1
						return Reflect.get(target, property, receiver)
					},
				},
			)

			expectBidLegError('bid_leg_predecessor_event_shape_invalid', () =>
				buildValidatedMultipartyBidLegContext(inputFor(1_200n, [{ ...signed, tags, sig: signature } as never], signed.id)),
			)
			expect(tagIndexReads).toBe(0)
		}
	})

	test('admits mixed-case fixed-width event ids and pubkeys to normal verification', () => {
		const signed = makeBid({ amount: '1000' })
		const mixedCaseId = { ...signed, id: 'A'.repeat(64) }
		const mixedCasePubkey = { ...signed, pubkey: 'A'.repeat(64) }

		expectBidLegError('bid_leg_predecessor_signature_invalid', () =>
			buildValidatedMultipartyBidLegContext(inputFor(1_200n, [mixedCaseId], signed.id)),
		)
		expectBidLegError('bid_leg_predecessor_signature_invalid', () =>
			buildValidatedMultipartyBidLegContext(inputFor(1_200n, [mixedCasePubkey], signed.id)),
		)
	})

	test('rejects malformed event ids before tag traversal or canonical sorting', () => {
		const signed = makeBid({ amount: '1000' })
		for (const id of ['a'.repeat(65), 'g'.repeat(64), 1] as unknown[]) {
			let tagIndexReads = 0
			const tags = new Proxy(
				signed.tags.map((tag) => [...tag]),
				{
					get: (target, property, receiver) => {
						if (typeof property === 'string' && /^\d+$/.test(property)) tagIndexReads += 1
						return Reflect.get(target, property, receiver)
					},
				},
			)
			let secondEnvelopeReads = 0
			const second = new Proxy(signed, {
				get: (target, property, receiver) => {
					secondEnvelopeReads += 1
					return Reflect.get(target, property, receiver)
				},
			})

			expectBidLegError('bid_leg_predecessor_event_shape_invalid', () =>
				buildValidatedMultipartyBidLegContext(inputFor(1_200n, [{ ...signed, id, tags } as never, second], signed.id)),
			)
			expect(tagIndexReads).toBe(0)
			expect(secondEnvelopeReads).toBe(0)
		}
	})

	test('rejects malformed pubkeys before tag traversal, parsing, or cryptography', () => {
		const signed = makeBid({ amount: '1000' })
		for (const pubkey of ['a'.repeat(65), 'g'.repeat(64), 1] as unknown[]) {
			let tagIndexReads = 0
			const tags = new Proxy(
				signed.tags.map((tag) => [...tag]),
				{
					get: (target, property, receiver) => {
						if (typeof property === 'string' && /^\d+$/.test(property)) tagIndexReads += 1
						return Reflect.get(target, property, receiver)
					},
				},
			)

			expectBidLegError('bid_leg_predecessor_event_shape_invalid', () =>
				buildValidatedMultipartyBidLegContext(inputFor(1_200n, [{ ...signed, pubkey, tags } as never], signed.id)),
			)
			expect(tagIndexReads).toBe(0)
		}
	})

	test('rejects a NaN predecessor collection length with a domain error before allocation', () => {
		let predecessorEntryReads = 0
		const predecessorEvents = new Proxy([] as NostrEventLike[], {
			get: (target, property, receiver) => {
				if (property === 'length') return Number.NaN
				if (typeof property === 'string' && /^\d+$/.test(property)) predecessorEntryReads += 1
				return Reflect.get(target, property, receiver)
			},
		})

		let error: unknown
		try {
			buildValidatedMultipartyBidLegContext({ ...inputFor(1_000n), predecessorEvents })
		} catch (caught) {
			error = caught
		}

		expect(predecessorEntryReads).toBe(0)
		expect(error).toBeInstanceOf(AuctionMultipartyBidLegContextError)
		expect((error as AuctionMultipartyBidLegContextError).code).toBe('bid_leg_predecessor_events_invalid')
	})

	test('normalizes other malformed predecessor collection lengths before allocation or root crypto', () => {
		for (const reportedLength of [0.5, -1, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '1'] as unknown[]) {
			let rootFieldReads = 0
			const rootEvent = new Proxy(ROOT, {
				get: (target, property, receiver) => {
					rootFieldReads += 1
					return Reflect.get(target, property, receiver)
				},
			})
			let predecessorEntryReads = 0
			const predecessorEvents = new Proxy([] as NostrEventLike[], {
				get: (target, property, receiver) => {
					if (property === 'length') return reportedLength
					if (typeof property === 'string' && /^\d+$/.test(property)) predecessorEntryReads += 1
					return Reflect.get(target, property, receiver)
				},
			})

			expectBidLegError('bid_leg_predecessor_events_invalid', () =>
				buildValidatedMultipartyBidLegContext({ ...inputFor(1_000n), rootEvent, predecessorEvents }),
			)
			expect(rootFieldReads).toBe(0)
			expect(predecessorEntryReads).toBe(0)
		}
	})

	test('rejects an oversized predecessor tag collection before reading attacker-controlled entries', () => {
		const signed = makeBid({ amount: '1000' })
		let indexReads = 0
		const hostileTags = new Proxy([] as string[][], {
			get: (target, property, receiver) => {
				if (property === 'length') return 100_000
				if (typeof property === 'string' && /^\d+$/.test(property)) {
					indexReads += 1
					return ['unknown', 'value']
				}
				return Reflect.get(target, property, receiver)
			},
		})
		const hostile = { ...signed, tags: hostileTags }

		let error: unknown
		try {
			buildValidatedMultipartyBidLegContext(inputFor(1_200n, [hostile], signed.id))
		} catch (caught) {
			error = caught
		}

		expect(indexReads).toBe(0)
		expect(error).toBeInstanceOf(AuctionMultipartyBidLegContextError)
		expect((error as AuctionMultipartyBidLegContextError).code).toBe('bid_leg_predecessor_event_shape_invalid')
	})

	test('rejects a present empty prev_bid instead of treating it as absent', () => {
		const base = makeBid({ amount: '1000' })
		const malformed = resignBidTags(base, [...base.tags.map((tag) => [...tag]), ['prev_bid', '']])

		expectBidLegError('bid_leg_predecessor_event_invalid', () =>
			buildValidatedMultipartyBidLegContext(inputFor(1_200n, [malformed], malformed.id)),
		)
	})

	test('accepts 256 tags and rejects larger reported tag counts without indexed reads', () => {
		expect(AUCTION_MULTIPARTY_BID_ENVELOPE_MAX_TAGS).toBe(256)
		const base = makeBid({ amount: '1000' })
		const atLimitTags = [
			...base.tags.map((tag) => [...tag]),
			...new Array(AUCTION_MULTIPARTY_BID_ENVELOPE_MAX_TAGS - base.tags.length).fill(null).map(() => ['unknown']),
		]
		const atLimit = resignBidTags(base, atLimitTags)

		expect(buildValidatedMultipartyBidLegContext(inputFor(1_200n, [atLimit], atLimit.id)).principalSats).toBe(200n)

		for (const reportedLength of [AUCTION_MULTIPARTY_BID_ENVELOPE_MAX_TAGS + 1, 1_000_000_000]) {
			let indexReads = 0
			const tags = new Proxy([] as string[][], {
				get: (target, property, receiver) => {
					if (property === 'length') return reportedLength
					if (typeof property === 'string' && /^\d+$/.test(property)) indexReads += 1
					return Reflect.get(target, property, receiver)
				},
			})

			expectBidLegError('bid_leg_predecessor_event_shape_invalid', () =>
				buildValidatedMultipartyBidLegContext(inputFor(1_200n, [{ ...base, tags }], base.id)),
			)
			expect(indexReads).toBe(0)
		}
	})

	test('accepts 16 tuple elements and rejects 17 before reading tuple entries', () => {
		expect(AUCTION_MULTIPARTY_BID_ENVELOPE_MAX_TAG_ELEMENTS).toBe(16)
		const base = makeBid({ amount: '1000' })
		const atLimitTuple = ['unknown', ...new Array(AUCTION_MULTIPARTY_BID_ENVELOPE_MAX_TAG_ELEMENTS - 1).fill('x')]
		const atLimit = resignBidTags(base, [...base.tags.map((tag) => [...tag]), atLimitTuple])

		expect(buildValidatedMultipartyBidLegContext(inputFor(1_200n, [atLimit], atLimit.id)).principalSats).toBe(200n)

		let elementReads = 0
		const oversizedTuple = new Proxy(new Array<string>(AUCTION_MULTIPARTY_BID_ENVELOPE_MAX_TAG_ELEMENTS + 1).fill('x'), {
			get: (target, property, receiver) => {
				if (typeof property === 'string' && /^\d+$/.test(property)) elementReads += 1
				return Reflect.get(target, property, receiver)
			},
		})

		expectBidLegError('bid_leg_predecessor_event_shape_invalid', () =>
			buildValidatedMultipartyBidLegContext(inputFor(1_200n, [{ ...base, tags: [oversizedTuple] }], base.id)),
		)
		expect(elementReads).toBe(0)
	})

	test('enforces per-element UTF-8 bytes at 4096 without normalizing or truncating', () => {
		expect(AUCTION_MULTIPARTY_BID_ENVELOPE_MAX_TAG_ELEMENT_UTF8_BYTES).toBe(4_096)
		const base = makeBid({ amount: '1000' })
		const exactAscii = resignBidTags(base, [...base.tags.map((tag) => [...tag]), ['unknown', 'x'.repeat(4_096)]])
		const exactMultibyte = resignBidTags(base, [...base.tags.map((tag) => [...tag]), ['unknown', 'é'.repeat(2_048)]])
		const overAscii = resignBidTags(base, [...base.tags.map((tag) => [...tag]), ['unknown', 'x'.repeat(4_097)]])
		const overMultibyte = resignBidTags(base, [...base.tags.map((tag) => [...tag]), ['unknown', 'é'.repeat(2_049)]])

		expect(buildValidatedMultipartyBidLegContext(inputFor(1_200n, [exactAscii], exactAscii.id)).principalSats).toBe(200n)
		expect(buildValidatedMultipartyBidLegContext(inputFor(1_200n, [exactMultibyte], exactMultibyte.id)).principalSats).toBe(200n)
		expectBidLegError('bid_leg_predecessor_event_shape_invalid', () =>
			buildValidatedMultipartyBidLegContext(inputFor(1_200n, [overAscii], overAscii.id)),
		)
		expectBidLegError('bid_leg_predecessor_event_shape_invalid', () =>
			buildValidatedMultipartyBidLegContext(inputFor(1_200n, [overMultibyte], overMultibyte.id)),
		)
	})

	test('accepts exactly 65536 aggregate tag bytes and stops at byte 65537', () => {
		expect(AUCTION_MULTIPARTY_BID_ENVELOPE_MAX_TAGS_UTF8_BYTES).toBe(65_536)
		const base = makeBid({ amount: '1000' })
		const exactTags = padTagsToAggregateUtf8Bytes(base.tags, AUCTION_MULTIPARTY_BID_ENVELOPE_MAX_TAGS_UTF8_BYTES)
		expect(aggregateTagUtf8Bytes(exactTags)).toBe(AUCTION_MULTIPARTY_BID_ENVELOPE_MAX_TAGS_UTF8_BYTES)
		const exact = resignBidTags(base, exactTags)
		expect(buildValidatedMultipartyBidLegContext(inputFor(1_200n, [exact], exact.id)).principalSats).toBe(200n)

		let sentinelReads = 0
		const sentinel = new Proxy(['unreached'], {
			get: (target, property, receiver) => {
				if (typeof property === 'string' && /^\d+$/.test(property)) sentinelReads += 1
				return Reflect.get(target, property, receiver)
			},
		})
		const overLimit = { ...exact, tags: [...exactTags, ['x'], sentinel] }

		expectBidLegError('bid_leg_predecessor_event_shape_invalid', () =>
			buildValidatedMultipartyBidLegContext(inputFor(1_200n, [overLimit], exact.id)),
		)
		expect(sentinelReads).toBe(0)
	})

	test('enforces content UTF-8 bytes at 4096 and accepts the #1235 JSON shape', () => {
		expect(AUCTION_MULTIPARTY_BID_ENVELOPE_MAX_CONTENT_UTF8_BYTES).toBe(4_096)
		const base = makeBid({ amount: '1000' })
		const exact = signEvent(BIDDER_SECRET, base.kind, base.tags, 'x'.repeat(4_096))
		const over = signEvent(BIDDER_SECRET, base.kind, base.tags, 'x'.repeat(4_097))
		const exactMultibyte = signEvent(BIDDER_SECRET, base.kind, base.tags, 'é'.repeat(2_048))
		const overMultibyte = signEvent(BIDDER_SECRET, base.kind, base.tags, 'é'.repeat(2_049))
		const directLightningContent = JSON.stringify({ type: 'auction_bid_v1', amount: 1000, mint: MINT })
		const directLightning = signEvent(BIDDER_SECRET, base.kind, base.tags, directLightningContent)

		expect(buildValidatedMultipartyBidLegContext(inputFor(1_200n, [exact], exact.id)).principalSats).toBe(200n)
		expect(buildValidatedMultipartyBidLegContext(inputFor(1_200n, [exactMultibyte], exactMultibyte.id)).principalSats).toBe(200n)
		expect(buildValidatedMultipartyBidLegContext(inputFor(1_200n, [directLightning], directLightning.id)).principalSats).toBe(200n)
		expectBidLegError('bid_leg_predecessor_event_shape_invalid', () =>
			buildValidatedMultipartyBidLegContext(inputFor(1_200n, [over], over.id)),
		)
		expectBidLegError('bid_leg_predecessor_event_shape_invalid', () =>
			buildValidatedMultipartyBidLegContext(inputFor(1_200n, [overMultibyte], overMultibyte.id)),
		)
	})

	test('rejects revoked and throwing outer or inner tag containers with domain errors', () => {
		const signed = makeBid({ amount: '1000' })
		const revokedOuter = Proxy.revocable(
			signed.tags.map((tag) => [...tag]),
			{},
		)
		revokedOuter.revoke()
		const throwingOuter = new Proxy(
			signed.tags.map((tag) => [...tag]),
			{
				get: (target, property, receiver) => {
					if (property === 'length') throw new Error('hostile outer length')
					return Reflect.get(target, property, receiver)
				},
			},
		)
		const revokedInner = Proxy.revocable(['unknown'], {})
		revokedInner.revoke()
		const throwingInner = new Proxy(['unknown'], {
			get: (target, property, receiver) => {
				if (property === 'length') throw new Error('hostile inner length')
				return Reflect.get(target, property, receiver)
			},
		})

		for (const tags of [revokedOuter.proxy, throwingOuter, [revokedInner.proxy], [throwingInner]]) {
			expectBidLegError('bid_leg_predecessor_event_shape_invalid', () =>
				buildValidatedMultipartyBidLegContext(inputFor(1_200n, [{ ...signed, tags }], signed.id)),
			)
		}
	})

	test('rejects empty, sparse, non-array, and non-string tag structures', () => {
		const base = makeBid({ amount: '1000' })
		const sparseOuter = new Array<string[]>(1)
		const sparseInner = new Array<string>(2)
		sparseInner[0] = 'unknown'

		for (const tags of [[[]], [sparseInner], sparseOuter, [['unknown', 1]], {}] as unknown[]) {
			expectBidLegError('bid_leg_predecessor_event_shape_invalid', () =>
				buildValidatedMultipartyBidLegContext(inputFor(1_200n, [{ ...base, tags } as never], base.id)),
			)
		}
	})

	test('snapshots outer and inner tag lengths once despite caller-side growth', () => {
		const signed = makeBid({ amount: '1000' })
		const growingOuterTarget = signed.tags.map((tag) => [...tag])
		let outerGrew = false
		const growingOuter = new Proxy(growingOuterTarget, {
			get: (target, property, receiver) => {
				if (property === '0' && !outerGrew) {
					outerGrew = true
					target.push(['late', 'ignored'])
				}
				return Reflect.get(target, property, receiver)
			},
		})
		expect(buildValidatedMultipartyBidLegContext(inputFor(1_200n, [{ ...signed, tags: growingOuter }], signed.id)).principalSats).toBe(200n)
		expect(growingOuterTarget).toHaveLength(signed.tags.length + 1)

		const growingInnerTags = signed.tags.map((tag) => [...tag])
		const firstTag = growingInnerTags[0]
		let innerGrew = false
		growingInnerTags[0] = new Proxy(firstTag, {
			get: (target, property, receiver) => {
				if (property === '0' && !innerGrew) {
					innerGrew = true
					target.push('late')
				}
				return Reflect.get(target, property, receiver)
			},
		})
		expect(buildValidatedMultipartyBidLegContext(inputFor(1_200n, [{ ...signed, tags: growingInnerTags }], signed.id)).principalSats).toBe(
			200n,
		)
		expect(firstTag).toHaveLength(3)
	})

	test('requires a present prev_bid to be canonical lowercase 64-hex', () => {
		const first = makeBid({ amount: '1000' })
		const valid = makeBid({ amount: '1200', previous: first })
		const uppercase = resignBidTags(valid, replaceTagValue(valid.tags, 'prev_bid', first.id.toUpperCase()))
		const wrongLength = resignBidTags(valid, replaceTagValue(valid.tags, 'prev_bid', first.id.slice(1)))
		const tooLong = resignBidTags(valid, replaceTagValue(valid.tags, 'prev_bid', `${first.id}a`))
		const nonHex = resignBidTags(valid, replaceTagValue(valid.tags, 'prev_bid', 'g'.repeat(64)))
		const whitespace = resignBidTags(valid, replaceTagValue(valid.tags, 'prev_bid', `${first.id.slice(1)} `))

		expect(buildValidatedMultipartyBidLegContext(inputFor(1_400n, [first, valid], valid.id)).principalSats).toBe(200n)
		expect(buildValidatedMultipartyBidLegContext(inputFor(1_200n, [first], first.id)).principalSats).toBe(200n)
		expectBidLegError('bid_leg_predecessor_event_invalid', () =>
			buildValidatedMultipartyBidLegContext(inputFor(1_400n, [first, uppercase], uppercase.id)),
		)
		expectBidLegError('bid_leg_predecessor_event_invalid', () =>
			buildValidatedMultipartyBidLegContext(inputFor(1_400n, [first, wrongLength], wrongLength.id)),
		)
		for (const malformed of [tooLong, nonHex, whitespace]) {
			expectBidLegError('bid_leg_predecessor_event_invalid', () =>
				buildValidatedMultipartyBidLegContext(inputFor(1_400n, [first, malformed], malformed.id)),
			)
		}
	})

	test('keeps lock_secret, proof_y, dleq_proof, and unknown tags repeatable and non-authoritative', () => {
		const base = makeBid({ amount: '1000' })
		const dleqProof = JSON.stringify({ id: '00', amount: 1000, C: `02${'4'.repeat(64)}`, e: '00', s: '00', r: '00' })
		const bid = resignBidTags(base, [
			...base.tags.map((tag) => [...tag]),
			['lock_secret', 'second-secret'],
			['proof_y', `03${'4'.repeat(64)}`],
			['dleq_proof', dleqProof],
			['dleq_proof', dleqProof],
			['unknown', 'first'],
			['unknown', 'second'],
		])

		const context = buildValidatedMultipartyBidLegContext(inputFor(1_200n, [bid], bid.id))
		expect(context.predecessorGrossSats).toBe(1_000n)
		expect(context.principalSats).toBe(200n)
	})

	test('rejects 64 and very large predecessor counts before root authentication or entry reads', () => {
		for (const reportedLength of [AUCTION_MULTIPARTY_MAX_PREDECESSOR_EVENTS + 1, Number.MAX_SAFE_INTEGER]) {
			let rootFieldReads = 0
			const root = new Proxy(ROOT, {
				get: (target, property, receiver) => {
					rootFieldReads += 1
					return Reflect.get(target, property, receiver)
				},
			})
			let predecessorEntryReads = 0
			const predecessors = new Proxy([] as NostrEventLike[], {
				get: (target, property, receiver) => {
					if (property === 'length') return reportedLength
					if (typeof property === 'string' && /^\d+$/.test(property)) predecessorEntryReads += 1
					return Reflect.get(target, property, receiver)
				},
			})

			expectBidLegError('bid_leg_predecessor_chain_too_long', () =>
				buildValidatedMultipartyBidLegContext({
					...inputFor(65n),
					rootEvent: root,
					predecessorEventId: 'f'.repeat(64),
					predecessorEvents: predecessors,
				}),
			)
			expect(rootFieldReads).toBe(0)
			expect(predecessorEntryReads).toBe(0)
		}
	})

	test('captures predecessor collection length once despite caller-side growth', () => {
		const first = makeBid({ amount: '1000' })
		const callerEvents: NostrEventLike[] = [first]
		const growingEvents = new Proxy(callerEvents, {
			get: (target, property, receiver) => {
				if (property === '0') target.push(null as never)
				return Reflect.get(target, property, receiver)
			},
		})

		const context = buildValidatedMultipartyBidLegContext(inputFor(1_200n, growingEvents, first.id))
		expect(context.predecessorEventId).toBe(first.id)
		expect(context.principalSats).toBe(200n)
		expect(callerEvents).toHaveLength(2)
	})

	test('fails closed on null containers and wrong runtime object types without leaking TypeError', () => {
		expectBidLegError('bid_leg_input_invalid', () => buildValidatedMultipartyBidLegContext(null as never))
		expectBidLegError('bid_leg_input_invalid', () => buildValidatedMultipartyBidLegContext([] as never))
		expectBidLegError('bid_leg_predecessor_events_invalid', () =>
			buildValidatedMultipartyBidLegContext({ ...inputFor(1_000n), predecessorEvents: null } as never),
		)
		expectBidLegError('bid_leg_predecessor_event_shape_invalid', () =>
			buildValidatedMultipartyBidLegContext(inputFor(1_200n, [null as never], 'a'.repeat(64))),
		)
	})

	test('checks predecessor collection shape before root cryptography and scalar fields', () => {
		expectBidLegError('bid_leg_predecessor_events_invalid', () =>
			buildValidatedMultipartyBidLegContext({
				rootEvent: ROOT,
				bidderPubkey: 'bad',
				currentGrossSats: 0n,
				predecessorEventId: 'bad',
				predecessorEvents: null,
			} as never),
		)
	})

	test('rejects an invalid predecessor signature and accepts a valid signature', () => {
		const valid = makeBid({ amount: '1000' })
		const invalid = { ...valid, sig: '0'.repeat(128) }

		expect(buildValidatedMultipartyBidLegContext(inputFor(1_200n, [valid])).principalSats).toBe(200n)
		expectBidLegError('bid_leg_predecessor_signature_invalid', () => buildValidatedMultipartyBidLegContext(inputFor(1_200n, [invalid])))
	})

	test('does not inherit a caller-owned nostr-tools verification cache marker', () => {
		const cached = makeBid({ amount: '1000' }) as Event
		expect(verifyEvent(cached)).toBe(true)

		cached.tags = replaceTagValue(cached.tags, 'amount', '900')
		expect(verifyEvent(cached)).toBe(true)
		expectBidLegError('bid_leg_predecessor_signature_invalid', () =>
			buildValidatedMultipartyBidLegContext(inputFor(1_100n, [cached], cached.id)),
		)
	})

	test('rejects an invalid root signature', () => {
		expectBidLegError('bid_leg_root_signature_invalid', () =>
			buildValidatedMultipartyBidLegContext({ ...inputFor(1_000n), rootEvent: { ...ROOT, sig: '0'.repeat(128) } }),
		)
	})

	test('applies 62, 63, 64, and greater-than-64 predecessor collection boundaries', () => {
		expect(AUCTION_MULTIPARTY_MAX_PREDECESSOR_EVENTS).toBe(63)

		const chain: NostrEventLike[] = []
		for (let index = 0; index < AUCTION_MULTIPARTY_MAX_PREDECESSOR_EVENTS; index++) {
			chain.push(makeBid({ amount: String(index + 1), previous: chain.at(-1) }))
		}

		const at62 = buildValidatedMultipartyBidLegContext(inputFor(63n, chain.slice(0, 62)))
		expect(at62.predecessorGrossSats).toBe(62n)
		expect(at62.principalSats).toBe(1n)

		const at63 = buildValidatedMultipartyBidLegContext(inputFor(64n, chain))
		expect(at63.predecessorGrossSats).toBe(63n)
		expect(at63.principalSats).toBe(1n)

		expectBidLegError('bid_leg_predecessor_chain_too_long', () =>
			buildValidatedMultipartyBidLegContext(inputFor(65n, [...chain, null as never], chain.at(-1)!.id)),
		)
		expectBidLegError('bid_leg_predecessor_chain_too_long', () =>
			buildValidatedMultipartyBidLegContext(inputFor(66n, [...chain, null as never, null as never], chain.at(-1)!.id)),
		)
	})

	test('rejects an oversized predecessor collection before authenticating an invalid root', () => {
		const oversized = new Array<null>(AUCTION_MULTIPARTY_MAX_PREDECESSOR_EVENTS + 1).fill(null)
		expectBidLegError('bid_leg_predecessor_chain_too_long', () =>
			buildValidatedMultipartyBidLegContext({
				...inputFor(65n),
				rootEvent: { ...ROOT, sig: '0'.repeat(128) },
				predecessorEventId: 'f'.repeat(64),
				predecessorEvents: oversized as never,
			}),
		)
	})
})
