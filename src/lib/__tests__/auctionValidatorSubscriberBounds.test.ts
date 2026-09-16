/**
 * Reviewer-finding coverage for the validator subscriber's relay-facing
 * boundary (PlebeianApp/market#1285, review 5645059400). The
 * subscriber's own test file covers signature + authorization; this
 * file covers the admission bounds on the buffers it feeds from the
 * relay.
 */

import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate, type NostrEvent } from 'nostr-tools'
import { AUCTION_BID_KIND, AUCTION_KIND, AUCTION_PATH_RELEASE_KIND, AUCTION_SETTLEMENT_KIND } from '../auction/constants'
import { createValidatorState, type ValidatorState } from '../../server/auction-validator/state'
import { createValidatorSubscriber } from '../../server/auction-validator/subscriber'
import { checkEventEnvelope } from '../../server/auction-validator/spamPolicy'
import type { BidSpamPolicy } from '../../server/auction-validator/spamPolicy'

const VALIDATOR_PUBKEY = 'a'.repeat(64)

/**
 * A non-https mint URL so the reachability probe is rejected by the
 * destination policy without any network contact (offline test).
 */
const MINT_URL = 'http://mint.test'

interface Harness {
	state: ValidatorState
	publishCalls: string[]
	warnings: string[]
	clock: { value: number }
	dispatch: (event: NostrEvent) => void
	subscriptions: Array<Array<{ kinds?: number[]; '#a'?: string[]; since?: number }>>
	settle: () => Promise<void>
	subscriber: ReturnType<typeof createValidatorSubscriber>
}

const createHarness = (options: { spamPolicy?: Partial<BidSpamPolicy> } = {}): Harness => {
	const state = createValidatorState(VALIDATOR_PUBKEY)
	const publishCalls: string[] = []
	const warnings: string[] = []
	const clock = { value: 5_000 }
	const subscriptions: Array<Array<{ kinds?: number[]; '#a'?: string[]; since?: number }>> = []
	const history: NostrEvent[] = []
	const matchesFilter = (event: NostrEvent, filter: { kinds?: number[]; '#a'?: string[]; since?: number }): boolean => {
		if (filter.kinds && !filter.kinds.includes(event.kind)) return false
		if (filter.since !== undefined && event.created_at < filter.since) return false
		if (filter['#a']) {
			const aTags = event.tags.filter((tag) => tag[0] === 'a').map((tag) => tag[1] ?? '')
			if (!aTags.some((tag) => filter['#a']?.includes(tag))) return false
		}
		return true
	}
	const relayPool = {
		handlers: new Map<number, (event: NostrEvent) => void>(),
		subscribe: async (filters: Array<{ kinds?: number[]; '#a'?: string[]; since?: number }>, handler: (event: NostrEvent) => void) => {
			subscriptions.push(filters)
			for (const kind of filters[0]?.kinds ?? []) {
				;(relayPool as any).handlers.set(kind, handler)
			}
			for (const event of history) {
				if (filters.some((filter) => matchesFilter(event, filter))) {
					handler(event)
				}
			}
			return () => undefined
		},
		publish: async () => undefined,
	}
	const subscriber = createValidatorSubscriber({
		state,
		relayPool: relayPool as any,
		publisher: {
			publishIfChanged: async (input: { bidState: { bid: { id: string } } }) => {
				publishCalls.push(input.bidState.bid.id)
				return { verdict: { claim: 'valid_bid_placed', reason: undefined }, published: true }
			},
		} as any,
		now: () => clock.value,
		logger: {
			info: () => undefined,
			warn: (...args: unknown[]) => warnings.push(args.join(' ')),
			error: () => undefined,
		},
		spamPolicy: options.spamPolicy,
	})

	const dispatch = (event: NostrEvent): void => {
		history.push(event)
		const handler = (relayPool as any).handlers.get(event.kind) as ((event: NostrEvent) => void) | undefined
		if (handler) handler(event)
	}

	return {
		state,
		publishCalls,
		warnings,
		clock,
		dispatch,
		subscriptions,
		subscriber,
		settle: () => new Promise((resolve) => setTimeout(resolve, 20)),
	}
}

const junkTags = (count: number): string[][] => Array.from({ length: count }, (_, index) => ['junk', `${index}`])

const buildAuctionEvent = (sellerSk: Uint8Array, dTag = 'auction-test', extraTags: string[][] = []): NostrEvent =>
	finalizeEvent(
		{
			kind: AUCTION_KIND,
			created_at: 1_000,
			content: '',
			tags: [
				['d', dTag],
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
				['mint', MINT_URL],
				...extraTags,
			],
		} as unknown as EventTemplate,
		sellerSk,
	)

const buildBidEvent = (input: {
	bidderSk: Uint8Array
	sellerPubkey: string
	auctionRootEventId: string
	auctionDTag?: string
	bidNonce: string
}): NostrEvent =>
	finalizeEvent(
		{
			kind: AUCTION_BID_KIND,
			created_at: 1_500,
			content: '',
			tags: [
				['e', input.auctionRootEventId],
				['a', `30408:${input.sellerPubkey}:${input.auctionDTag}`],
				['p', input.sellerPubkey],
				['amount', '1200'],
				['currency', 'SAT'],
				['mint', MINT_URL],
				['locktime', '5700'],
				['refund_pubkey', '03' + 'f'.repeat(64)],
				['child_pubkey', '02' + 'a'.repeat(64)],
				['lock_secret', 'secret-1'],
				['proof_y', '02' + 'b'.repeat(64)],
				['created_for_end_at', '2100'],
				['bid_nonce', input.bidNonce],
				['key_scheme', 'hd_p2pk'],
				['status', 'locked'],
			],
		} as unknown as EventTemplate,
		input.bidderSk,
	)

/**
 * Review R1 — the subscriber no longer keeps a broad live bid REQ.
 * Unknown-auction child events stay in relay history until the matching
 * auction lands and opens a narrow child REQ on the shared `a` tag.
 */
describe('validator subscriber replays child history only for tracked auctions', () => {
	test('replays stored bids only after the matching auction opens a child REQ', async () => {
		const harness = createHarness()
		await harness.subscriber.start()

		const sellerSk = generateSecretKey()
		const sellerPubkey = getPublicKey(sellerSk)
		const bidderSk = generateSecretKey()

		const auctionA = buildAuctionEvent(sellerSk)
		const auctionB = buildAuctionEvent(sellerSk, 'auction-test-b')
		const bidA = buildBidEvent({ bidderSk, sellerPubkey, auctionRootEventId: auctionA.id, auctionDTag: 'auction-test', bidNonce: 'nonce-a' })
		const bidB = buildBidEvent({
			bidderSk,
			sellerPubkey,
			auctionRootEventId: auctionB.id,
			auctionDTag: 'auction-test-b',
			bidNonce: 'nonce-b',
		})

		harness.dispatch(bidA)
		harness.dispatch(bidB)
		await harness.settle()

		expect(harness.state.auctions.size).toBe(0)
		expect(harness.publishCalls).toEqual([])

		harness.dispatch(auctionA)
		await harness.settle()

		expect(harness.subscriptions[1]).toEqual([
			{ kinds: [AUCTION_BID_KIND, AUCTION_PATH_RELEASE_KIND, AUCTION_SETTLEMENT_KIND], '#a': [`30408:${sellerPubkey}:auction-test`] },
		])
		expect(harness.state.auctions.get(auctionA.id)?.bids.has(bidA.id)).toBe(true)
		expect(harness.state.auctions.get(auctionB.id)).toBeUndefined()
		expect(harness.publishCalls).toEqual([bidA.id])

		await harness.subscriber.stop()
	})
})

const buildPathReleaseEvent = (input: {
	bidderSk: Uint8Array
	sellerPubkey: string
	bidEventId: string
	auctionDTag?: string
	extraTags?: string[][]
}): NostrEvent =>
	finalizeEvent(
		{
			kind: AUCTION_PATH_RELEASE_KIND,
			created_at: 1_600,
			content: '',
			tags: [
				['e', input.bidEventId],
				['a', `30408:${input.sellerPubkey}:${input.auctionDTag ?? 'auction-test'}`],
				['p', input.sellerPubkey],
				['derivation_path', 'm/0/0'],
				['child_pubkey', '02' + 'a'.repeat(64)],
				['release_reason', 'settlement'],
				...(input.extraTags ?? []),
			],
		} as unknown as EventTemplate,
		input.bidderSk,
	)

const buildSettlementEvent = (input: {
	sellerSk: Uint8Array
	sellerPubkey: string
	auctionRootEventId: string
	bidEventId: string
	bidderPubkey: string
	auctionDTag?: string
	pathReleaseEventId?: string
	extraTags?: string[][]
}): NostrEvent =>
	finalizeEvent(
		{
			kind: AUCTION_SETTLEMENT_KIND,
			created_at: 1_700,
			content: '',
			tags: [
				['e', input.auctionRootEventId],
				['a', `30408:${input.sellerPubkey}:${input.auctionDTag ?? 'auction-test'}`],
				['status', 'settled'],
				['close_at', '2100'],
				['winning_bid', input.bidEventId],
				['winner', input.bidderPubkey],
				['final_amount', '1200'],
				// Must be a 64-character hex event id: the schema rejects
				// anything else, and parseSettlementEvent drops the whole
				// event *before* recordSettlement — which is why every
				// kind-1024 in this harness used to vanish silently
				// (review at 4c665564).
				['path_release', input.pathReleaseEventId ?? 'b'.repeat(64)],
				['payout', input.bidEventId, '1200', 'settled'],
				...(input.extraTags ?? []),
			],
		} as unknown as EventTemplate,
		input.sellerSk,
	)

/**
 * Review 5645059400 finding 3 — the envelope check only guarded the
 * kind-1023 path. `checkBidEnvelope` is kind-agnostic, so an oversized
 * or tag-flooded kind 30408 / 1024 / 1025 was still admitted into state
 * and could be buffered without limit.
 */
describe('validator subscriber event envelope on every ingestion path (finding 3)', () => {
	test('drops a kind-30408 whose tag count exceeds the envelope', async () => {
		const harness = createHarness()
		await harness.subscriber.start()

		const sellerSk = generateSecretKey()
		const oversized = buildAuctionEvent(sellerSk, 'auction-test', junkTags(200))
		harness.dispatch(oversized)
		await harness.settle()

		expect(harness.state.auctions.get(oversized.id)).toBeUndefined()
		expect(harness.warnings.join('\n')).toContain('too_many_tags')

		// Control: an envelope-compliant auction is still tracked.
		const compliant = buildAuctionEvent(sellerSk)
		harness.dispatch(compliant)
		await harness.settle()
		expect(harness.state.auctions.get(compliant.id)).toBeDefined()

		await harness.subscriber.stop()
	})

	test('drops a kind-1025 whose tag count exceeds the envelope', async () => {
		const harness = createHarness()
		await harness.subscriber.start()

		const sellerSk = generateSecretKey()
		const sellerPubkey = getPublicKey(sellerSk)
		const bidderSk = generateSecretKey()
		const bidderPubkey = getPublicKey(bidderSk)
		const auction = buildAuctionEvent(sellerSk)
		const bid = buildBidEvent({ bidderSk, sellerPubkey, auctionRootEventId: auction.id, bidNonce: 'nonce-a' })

		harness.dispatch(auction)
		await harness.settle()
		harness.dispatch(bid)
		await harness.settle()

		const oversized = buildPathReleaseEvent({
			bidderSk,
			sellerPubkey,
			bidEventId: bid.id,
			extraTags: junkTags(200),
		})
		harness.dispatch(oversized)
		await harness.settle()

		const auctionState = harness.state.auctions.get(auction.id)
		expect(auctionState?.pathReleases.get(bid.id) ?? []).toEqual([])
		expect(harness.warnings.join('\n')).toContain('too_many_tags')

		// Control: an envelope-compliant release is still recorded.
		const compliant = buildPathReleaseEvent({ bidderSk, sellerPubkey, bidEventId: bid.id })
		harness.dispatch(compliant)
		await harness.settle()
		expect(harness.state.auctions.get(auction.id)?.pathReleases.get(bid.id)?.[0]?.id).toBe(compliant.id)
		expect(bidderPubkey).toHaveLength(64)

		await harness.subscriber.stop()
	})

	test('drops a kind-1024 whose tag count exceeds the envelope', async () => {
		const harness = createHarness()
		await harness.subscriber.start()

		const sellerSk = generateSecretKey()
		const sellerPubkey = getPublicKey(sellerSk)
		const bidderSk = generateSecretKey()
		const bidderPubkey = getPublicKey(bidderSk)
		const auction = buildAuctionEvent(sellerSk)
		const bid = buildBidEvent({ bidderSk, sellerPubkey, auctionRootEventId: auction.id, bidNonce: 'nonce-a' })

		harness.dispatch(auction)
		await harness.settle()
		harness.dispatch(bid)
		await harness.settle()

		const oversized = buildSettlementEvent({
			sellerSk,
			sellerPubkey,
			auctionRootEventId: auction.id,
			bidEventId: bid.id,
			bidderPubkey,
			extraTags: junkTags(200),
		})
		harness.dispatch(oversized)
		await harness.settle()

		expect(harness.state.auctions.get(auction.id)?.settlement).toBeNull()
		expect(harness.warnings.join('\n')).toContain('too_many_tags')

		// Control: an envelope-compliant settlement is still recorded, end
		// to end. An earlier revision of this control was re-scoped to the
		// gate alone, on the belief that the harness could not get a
		// kind-1024 recorded. The real cause was this builder emitting a
		// non-hex `path_release` value, so parseSettlementEvent dropped
		// every settlement here before recordSettlement ran (review at
		// 4c665564). With the tag well-formed the recording path is
		// reachable, so the differential is asserted again.
		const compliant = buildSettlementEvent({
			sellerSk,
			sellerPubkey,
			auctionRootEventId: auction.id,
			bidEventId: bid.id,
			bidderPubkey,
		})
		expect(checkEventEnvelope(compliant).ok).toBe(true)
		harness.dispatch(compliant)
		await harness.settle()
		expect(harness.state.auctions.get(auction.id)?.settlement?.id).toBe(compliant.id)

		await harness.subscriber.stop()
	})
})

/**
 * Review at 4c665564 — the other two relay-fed buffers on the same
 * boundary, and the ordering the release stash was written for.
 *
 * (a) `pendingReleases` was only ever replayed from the auction-insert
 *     drain (subscriber.ts:410-416 of that revision), which needs the
 *     release to have been stashed *before* the auction was inserted.
 *     In the ordinary order — auction, release, then its bid — the bid
 *     lands after that drain, so `recordPathRelease` returned
 *     `unknown_bid`, the stash was never replayed and the signed
 *     release (plus its first-observed time) was lost for the process
 *     lifetime. The replay trigger has to be the bid landing, not the
 *     auction insert.
 * (b) `pendingReleases` / `pendingSettlements` were plain Maps with no
 *     cap and no TTL: the same attacker-keyed unbounded growth finding
 *     1 closed for `pendingBids`, and what pendingBuffer.ts:13-14
 *     already documents as fixed.
 */
describe('validator subscriber pending release/settlement buffers (review at 4c665564)', () => {
	test('replays a stashed path release when its bid arrives after the auction', async () => {
		const harness = createHarness({ spamPolicy: { pendingTtlSec: 7_200 } })
		await harness.subscriber.start()

		const sellerSk = generateSecretKey()
		const sellerPubkey = getPublicKey(sellerSk)
		const bidderSk = generateSecretKey()
		const auction = buildAuctionEvent(sellerSk)
		const bid = buildBidEvent({ bidderSk, sellerPubkey, auctionRootEventId: auction.id, bidNonce: 'nonce-a' })
		const release = buildPathReleaseEvent({ bidderSk, sellerPubkey, bidEventId: bid.id })

		// Ordinary order: the auction is already tracked when the release
		// arrives (a bidder can only release a path after bidding), and
		// the separate kind-1025 REQ delivers the release before the
		// kind-1023 REQ delivers the bid it references.
		harness.dispatch(auction)
		await harness.settle()
		harness.dispatch(release)
		await harness.settle()
		harness.dispatch(bid)
		await harness.settle()

		const auctionState = harness.state.auctions.get(auction.id)
		expect(auctionState?.bids.has(bid.id)).toBe(true)
		// The stash must be replayed for this bid, carrying the original
		// first-observed time (not replay-time now()).
		expect(auctionState?.pathReleases.get(bid.id)?.map((r) => r.id)).toEqual([release.id])
		expect(auctionState?.pathReleaseObservedAt.get(release.id)).toBe(5_000)

		await harness.subscriber.stop()
	})

	test('drops a stashed settlement whose auction never arrives within the TTL', async () => {
		const harness = createHarness({ spamPolicy: { pendingTtlSec: 60 } })
		await harness.subscriber.start()

		const sellerSk = generateSecretKey()
		const sellerPubkey = getPublicKey(sellerSk)
		const bidderSk = generateSecretKey()
		const bidderPubkey = getPublicKey(bidderSk)
		const auction = buildAuctionEvent(sellerSk)
		const bid = buildBidEvent({ bidderSk, sellerPubkey, auctionRootEventId: auction.id, bidNonce: 'nonce-a' })
		const settlement = buildSettlementEvent({
			sellerSk,
			sellerPubkey,
			auctionRootEventId: auction.id,
			bidEventId: bid.id,
			bidderPubkey,
		})

		// The settlement lands first (auction unknown) → stashed at 5_000.
		harness.dispatch(settlement)
		await harness.settle()

		// The auction only arrives after the buffer's TTL: the stale
		// settlement must already have been released rather than replayed
		// at an unbounded age, where it would overwrite the terminal-state
		// view with arbitrarily old evidence.
		harness.clock.value += 600
		harness.dispatch(auction)
		await harness.settle()
		harness.dispatch(bid)
		await harness.settle()

		const auctionState = harness.state.auctions.get(auction.id)
		expect(auctionState?.bids.has(bid.id)).toBe(true)
		expect(auctionState?.settlements ?? []).toEqual([])
		expect(auctionState?.settlement ?? null).toBeNull()

		await harness.subscriber.stop()
	})

	test('refuses stashed releases and settlements once the distinct-key cap is reached', async () => {
		const harness = createHarness({
			spamPolicy: { maxPendingKeys: 1, maxPendingEventsPerKey: 8, maxPendingEvents: 8, pendingTtlSec: 7_200 },
		})
		await harness.subscriber.start()

		const sellerSk = generateSecretKey()
		const sellerPubkey = getPublicKey(sellerSk)
		const bidderSk = generateSecretKey()
		const bidderPubkey = getPublicKey(bidderSk)
		const auctionA = buildAuctionEvent(sellerSk)
		const auctionB = buildAuctionEvent(sellerSk, 'auction-test-b')
		const bidA = buildBidEvent({ bidderSk, sellerPubkey, auctionRootEventId: auctionA.id, bidNonce: 'nonce-a' })
		const bidB = buildBidEvent({
			bidderSk,
			sellerPubkey,
			auctionRootEventId: auctionB.id,
			auctionDTag: 'auction-test-b',
			bidNonce: 'nonce-b',
		})
		const releaseA = buildPathReleaseEvent({ bidderSk, sellerPubkey, bidEventId: bidA.id })
		const releaseB = buildPathReleaseEvent({
			bidderSk,
			sellerPubkey,
			bidEventId: bidB.id,
			auctionDTag: 'auction-test-b',
		})
		const settlementA = buildSettlementEvent({
			sellerSk,
			sellerPubkey,
			auctionRootEventId: auctionA.id,
			bidEventId: bidA.id,
			bidderPubkey,
		})
		const settlementB = buildSettlementEvent({
			sellerSk,
			sellerPubkey,
			auctionRootEventId: auctionB.id,
			bidEventId: bidB.id,
			bidderPubkey,
			auctionDTag: 'auction-test-b',
		})

		// Two releases for two unknown bids, then two settlements for two
		// unknown auctions: only the first key of each buffer fits.
		harness.dispatch(releaseA)
		await harness.settle()
		harness.dispatch(releaseB)
		await harness.settle()
		harness.dispatch(settlementA)
		await harness.settle()
		harness.dispatch(settlementB)
		await harness.settle()

		const joined = harness.warnings.join('\n')
		expect(joined).toContain('dropping path release')
		expect(joined).toContain('dropping settlement')
		expect(joined).toContain('key_cap_reached')

		// The first key is still replayed when its parent lands: the cap
		// must not break the legitimate ordering-gap path.
		harness.dispatch(auctionA)
		await harness.settle()
		harness.dispatch(bidA)
		await harness.settle()
		expect(
			harness.state.auctions
				.get(auctionA.id)
				?.pathReleases.get(bidA.id)
				?.map((r) => r.id),
		).toEqual([releaseA.id])

		await harness.subscriber.stop()
	})

	test('never replays a stashed release whose bid never arrives', async () => {
		const harness = createHarness({ spamPolicy: { pendingTtlSec: 60 } })
		await harness.subscriber.start()

		const sellerSk = generateSecretKey()
		const sellerPubkey = getPublicKey(sellerSk)
		const bidderSk = generateSecretKey()
		const auction = buildAuctionEvent(sellerSk)
		// A release for a bid event id we never observe: there is nothing
		// that can authorize it, so it must expire unread.
		const orphanRelease = buildPathReleaseEvent({ bidderSk, sellerPubkey, bidEventId: 'f'.repeat(64) })

		harness.dispatch(orphanRelease)
		await harness.settle()
		harness.clock.value += 600
		harness.dispatch(auction)
		await harness.settle()

		expect(harness.state.auctions.get(auction.id)?.pathReleases.size).toBe(0)

		await harness.subscriber.stop()
	})
})
