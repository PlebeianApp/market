import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate, type NostrEvent } from 'nostr-tools'
import { AUCTION_BID_KIND, AUCTION_PATH_RELEASE_KIND, AUCTION_SETTLEMENT_KIND, AUCTION_KIND } from '../auction/constants'
import { createValidatorState, setAuctionMintReachability, upsertAuction, type ValidatorState } from '../../server/auction-validator/state'
import { createValidatorSubscriber } from '../../server/auction-validator/subscriber'

const VALIDATOR_PUBKEY = 'a'.repeat(64)
const SELLER_PUBKEY = 'b'.repeat(64)
const BIDDER_PUBKEY = 'c'.repeat(64)
const AUCTION_ROOT_EVENT_ID = 'd'.repeat(64)
const BID_EVENT_ID = 'e'.repeat(64)

const createSignedEvent = (secretKey: Uint8Array, template: EventTemplate): NostrEvent => finalizeEvent(template, secretKey)

const buildAuctionState = (state: ValidatorState) => {
	const auction = {
		id: AUCTION_ROOT_EVENT_ID,
		kind: AUCTION_KIND,
		pubkey: SELLER_PUBKEY,
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
	const signed = createSignedEvent(generateSecretKey(), auction as EventTemplate)
	const parsedAuction = {
		rawEvent: signed,
		dTag: 'auction-test',
		sellerPubkey: SELLER_PUBKEY,
		coordinate: `30408:${SELLER_PUBKEY}:auction-test`,
		rootEventId: AUCTION_ROOT_EVENT_ID,
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
		fallbackDelaySec: 1_800,
		vadiumRatioBps: 10_000,
		schema: 'auction_v1' as const,
	}
	const result = upsertAuction(state, parsedAuction as any)
	setAuctionMintReachability(result.auctionState, [['https://mint.test', true]])
	return result.auctionState
}

describe('auction validator subscriber signature checks', () => {
	test('drops bid, path release, and settlement events with invalid signatures', async () => {
		type Case = {
			name: string
			buildEvent: (secretKey: Uint8Array) => NostrEvent
			assert: (state: ValidatorState, auctionState: any) => void
		}

		const cases: Case[] = [
			{
				name: 'bid',
				buildEvent: (secretKey) =>
					createSignedEvent(secretKey, {
						kind: AUCTION_BID_KIND,
						pubkey: BIDDER_PUBKEY,
						created_at: 1_500,
						content: '',
						tags: [
							['e', AUCTION_ROOT_EVENT_ID],
							['a', `30408:${SELLER_PUBKEY}:auction-test`],
							['p', SELLER_PUBKEY],
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
					} as EventTemplate),
				assert: (state, auctionState) => {
					expect(auctionState.bids.size).toBe(0)
					expect(state.auctions.get(AUCTION_ROOT_EVENT_ID)?.bids.size).toBe(0)
				},
			},
			{
				name: 'path release',
				buildEvent: (secretKey) =>
					createSignedEvent(secretKey, {
						kind: AUCTION_PATH_RELEASE_KIND,
						pubkey: BIDDER_PUBKEY,
						created_at: 1_600,
						content: '',
						tags: [
							['e', BID_EVENT_ID],
							['a', `30408:${SELLER_PUBKEY}:auction-test`],
							['p', SELLER_PUBKEY],
							['derivation_path', 'm/0/0'],
							['child_pubkey', '02' + 'c'.repeat(64)],
							['release_reason', 'settlement'],
						],
					} as EventTemplate),
				assert: (state, auctionState) => {
					expect(auctionState.pathReleases.size).toBe(0)
					expect(state.auctions.get(AUCTION_ROOT_EVENT_ID)?.pathReleases.size).toBe(0)
				},
			},
			{
				name: 'settlement',
				buildEvent: (secretKey) =>
					createSignedEvent(secretKey, {
						kind: AUCTION_SETTLEMENT_KIND,
						pubkey: SELLER_PUBKEY,
						created_at: 1_700,
						content: '',
						tags: [
							['e', AUCTION_ROOT_EVENT_ID],
							['a', `30408:${SELLER_PUBKEY}:auction-test`],
							['status', 'settled'],
							['close_at', '2100'],
							['winning_bid', BID_EVENT_ID],
							['winner', BIDDER_PUBKEY],
							['final_amount', '1200'],
							['path_release', 'path-release-event-id'],
							['payout', BID_EVENT_ID, '1200', 'settled'],
						],
					} as EventTemplate),
				assert: (state, auctionState) => {
					expect(auctionState.settlement).toBeNull()
					expect(state.auctions.get(AUCTION_ROOT_EVENT_ID)?.settlement).toBeNull()
				},
			},
		]

		for (const testCase of cases) {
			const state = createValidatorState(VALIDATOR_PUBKEY)
			const auctionState = buildAuctionState(state)
			let publishCalls = 0
			const relayPool = {
				handlers: new Map<number, (event: NostrEvent) => void>(),
				subscribe: async (filters: Array<{ kinds?: number[] }>, handler: (event: NostrEvent) => void) => {
					for (const kind of filters[0]?.kinds ?? []) {
						;(relayPool as any).handlers.set(kind, handler)
					}
					return () => undefined
				},
				publish: async () => undefined,
			}
			const publisher = {
				publishIfChanged: async () => {
					publishCalls += 1
					return { verdict: { claim: 'bid_invalid', reason: 'test' }, published: true }
				},
			}
			const subscriber = createValidatorSubscriber({ state, relayPool: relayPool as any, publisher: publisher as any })
			await subscriber.start()

			const secretKey = generateSecretKey()
			const invalidSigEvent = testCase.buildEvent(secretKey)
			const tampered = { ...invalidSigEvent, sig: '0'.repeat(128) }
			const kind = tampered.kind
			const handler = (relayPool as any).handlers.get(kind) as ((event: NostrEvent) => void) | undefined
			if (!handler) throw new Error(`subscriber did not register a handler for kind ${kind}`)
			handler(tampered)
			await Promise.resolve()
			await Promise.resolve()

			testCase.assert(state, auctionState)
			expect(publishCalls).toBe(0)
			await subscriber.stop()
		}
	})
})

/**
 * Authorization-before-mutation coverage (review 4800100458, blocking 1
 * + inlines 4800101759 / 4800105709). A correctly-signed event from the
 * wrong author must not overwrite the single path-release slot, must
 * not be buffered, and must not trigger a verdict publish.
 */
describe('auction validator subscriber authorizes before mutation', () => {
	const buildHarness = (opts: { now?: () => number } = {}) => {
		const state = createValidatorState(VALIDATOR_PUBKEY)
		const auctionState = buildAuctionState(state)
		const publishCalls: string[] = []
		const relayPool = {
			handlers: new Map<number, (event: NostrEvent) => void>(),
			subscribe: async (filters: Array<{ kinds?: number[] }>, handler: (event: NostrEvent) => void) => {
				for (const kind of filters[0]?.kinds ?? []) {
					;(relayPool as any).handlers.set(kind, handler)
				}
				return () => undefined
			},
			publish: async () => undefined,
		}
		const publisher = {
			publishIfChanged: async (input: { bidState: { bid: { id: string }; observedAt: number } }) => {
				publishCalls.push(input.bidState.bid.id)
				return { verdict: { claim: 'bid_invalid', reason: 'test' }, published: true }
			},
		}
		const subscriber = createValidatorSubscriber({ state, relayPool: relayPool as any, publisher: publisher as any, now: opts.now })
		return { state, auctionState, relayPool, publishCalls, subscriber }
	}

	const dispatch = (relayPool: any, event: NostrEvent) => {
		const handler = relayPool.handlers.get(event.kind) as ((event: NostrEvent) => void) | undefined
		if (!handler) throw new Error(`no handler for kind ${event.kind}`)
		handler(event)
	}
	const flush = async () => {
		await Promise.resolve()
		await Promise.resolve()
		await Promise.resolve()
	}

	const buildSignedBid = (bidderSk: Uint8Array): NostrEvent =>
		createSignedEvent(bidderSk, {
			kind: AUCTION_BID_KIND,
			created_at: 1_500,
			content: '',
			tags: [
				['e', AUCTION_ROOT_EVENT_ID],
				['a', `30408:${SELLER_PUBKEY}:auction-test`],
				['p', SELLER_PUBKEY],
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
		} as unknown as EventTemplate)

	test('a validly-signed kind-1025 from a non-bidder does not overwrite the release slot or publish', async () => {
		const { state, auctionState, relayPool, publishCalls, subscriber } = buildHarness()
		await subscriber.start()

		const bidderSk = generateSecretKey()
		const attackerSk = generateSecretKey()
		const bidEvent = buildSignedBid(bidderSk)
		dispatch(relayPool, bidEvent)
		await flush()
		// The bid itself triggered one publish.
		expect(publishCalls).toEqual([bidEvent.id])

		// Valid release authored by the bidder → recorded + published.
		const validRelease = createSignedEvent(bidderSk, {
			kind: AUCTION_PATH_RELEASE_KIND,
			created_at: 1_600,
			content: '',
			tags: [
				['e', bidEvent.id],
				['a', `30408:${SELLER_PUBKEY}:auction-test`],
				['p', SELLER_PUBKEY],
				['derivation_path', 'm/0/0'],
				['child_pubkey', '02' + 'a'.repeat(64)],
				['release_reason', 'settlement'],
			],
		} as unknown as EventTemplate)
		dispatch(relayPool, validRelease)
		await flush()
		expect(auctionState.pathReleases.get(bidEvent.id)?.[0]?.id).toBe(validRelease.id)
		expect(publishCalls).toEqual([bidEvent.id, bidEvent.id])

		// Correctly-signed release from a different author → dropped,
		// not buffered, and not published.
		const wrongAuthorRelease = createSignedEvent(attackerSk, {
			kind: AUCTION_PATH_RELEASE_KIND,
			created_at: 1_700,
			content: '',
			tags: [
				['e', bidEvent.id],
				['a', `30408:${SELLER_PUBKEY}:auction-test`],
				['p', SELLER_PUBKEY],
				['derivation_path', 'm/0/0'],
				['child_pubkey', '02' + 'a'.repeat(64)],
				['release_reason', 'settlement'],
			],
		} as unknown as EventTemplate)
		dispatch(relayPool, wrongAuthorRelease)
		await flush()

		// The honest bidder's release is still pinned; no new publish.
		expect(auctionState.pathReleases.get(bidEvent.id)?.[0]?.id).toBe(validRelease.id)
		expect(state.auctions.get(AUCTION_ROOT_EVENT_ID)?.pathReleases.size).toBe(1)
		expect(publishCalls).toEqual([bidEvent.id, bidEvent.id])
		await subscriber.stop()
	})

	test('a validly-signed kind-1024 from a non-seller does not replace the settlement slot', async () => {
		const { state, auctionState, relayPool, subscriber } = buildHarness()
		await subscriber.start()

		// The auction's pinned seller is SELLER_PUBKEY ('b'.repeat(64)).
		// A settlement authored by any other signer must be rejected.
		const attackerSk = generateSecretKey()
		const imposterSettlement = createSignedEvent(attackerSk, {
			kind: AUCTION_SETTLEMENT_KIND,
			created_at: 1_800,
			content: '',
			tags: [
				['e', AUCTION_ROOT_EVENT_ID],
				['a', `30408:${SELLER_PUBKEY}:auction-test`],
				['status', 'settled'],
				['close_at', '2100'],
				['winning_bid', 'e'.repeat(64)],
				['winner', 'c'.repeat(64)],
				['final_amount', '1200'],
				['path_release', 'path-release-event-id'],
				['payout', 'e'.repeat(64), '1200', 'settled'],
			],
		} as unknown as EventTemplate)
		dispatch(relayPool, imposterSettlement)
		await flush()

		// The single settlement slot stays empty; the imposter did not
		// overwrite it and no settled_* verdict was derived from it.
		expect(auctionState.settlement).toBeNull()
		expect(state.auctions.get(AUCTION_ROOT_EVENT_ID)?.settlement).toBeNull()
		await subscriber.stop()
	})

	test('startup child replay preserves first-observed time for later auction discovery', async () => {
		// Historical child events already on the relay at startup are
		// captured with the startup observation time, so a later auction
		// discovery does not re-stamp them to replay-time now().
		const sellerSk = generateSecretKey()
		const sellerPub = getPublicKey(sellerSk)
		const bidderSk = generateSecretKey()
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
		let t = 5_000
		const now = () => t

		const state = createValidatorState(VALIDATOR_PUBKEY)
		const relayPool = {
			handlers: new Map<number, (event: NostrEvent) => void>(),
			subscribe: async (filters: Array<{ kinds?: number[]; '#a'?: string[]; since?: number }>, handler: (event: NostrEvent) => void) => {
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
			publisher: { publishIfChanged: async () => ({ verdict: { claim: 'bid_invalid', reason: 'test' }, published: true }) } as any,
			now,
		})

		// A non-https mint so the reachability probe is rejected by the
		// destination policy without any network contact (offline test).
		const mintUrl = 'http://mint.test'

		// Auction event signed by the seller. Its rootEventId is its own id.
		const auctionEvent = createSignedEvent(sellerSk, {
			kind: AUCTION_KIND,
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
				['mint', mintUrl],
			],
		} as unknown as EventTemplate)
		const auctionRootId = auctionEvent.id
		const coordinate = `30408:${sellerPub}:auction-test`

		// Bid references the auction root id.
		const bidEvent = createSignedEvent(bidderSk, {
			kind: AUCTION_BID_KIND,
			created_at: 1_500,
			content: '',
			tags: [
				['e', auctionRootId],
				['a', coordinate],
				['p', sellerPub],
				['amount', '1200'],
				['currency', 'SAT'],
				['mint', mintUrl],
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
		} as unknown as EventTemplate)

		// Release references the bid id.
		const releaseEvent = createSignedEvent(bidderSk, {
			kind: AUCTION_PATH_RELEASE_KIND,
			created_at: 1_600,
			content: '',
			tags: [
				['e', bidEvent.id],
				['a', coordinate],
				['p', sellerPub],
				['derivation_path', 'm/0/0'],
				['child_pubkey', '02' + 'a'.repeat(64)],
				['release_reason', 'settlement'],
			],
		} as unknown as EventTemplate)

		// 1. Release then bid are already on relay history when the
		// subscriber starts; startup replay stamps both at t=5000.
		history.push(releaseEvent)
		history.push(bidEvent)
		await subscriber.start()
		// 2. Clock advances; the auction is only discovered later.
		t = 9_000
		dispatch(relayPool, auctionEvent)
		await new Promise((resolve) => setTimeout(resolve, 20))

		// The later auction discovery must preserve the startup observation
		// time rather than re-stamp the bid/release to 9000.
		const auctionState = state.auctions.get(auctionRootId)!
		const bidState = auctionState.bids.get(bidEvent.id)!
		expect(bidState.observedAt).toBe(5_000)
		expect(auctionState.pathReleaseObservedAt.get(releaseEvent.id)).toBe(5_000)
		await subscriber.stop()
	})
})

describe('auction validator subscriber subscription contract', () => {
	const flush = async () => {
		await Promise.resolve()
		await Promise.resolve()
		await Promise.resolve()
	}

	test('opens one child REQ per tracked auction using the shared #a filter', async () => {
		const sellerSk = generateSecretKey()
		const sellerPubkey = getPublicKey(sellerSk)
		const subscriptions: Array<Array<Record<string, unknown>>> = []
		const relayPool = {
			handlers: new Map<number, (event: NostrEvent) => void>(),
			subscribe: async (filters: Array<Record<string, unknown>>, handler: (event: NostrEvent) => void) => {
				subscriptions.push(filters)
				for (const kind of (filters[0]?.kinds as number[] | undefined) ?? []) {
					;(relayPool as any).handlers.set(kind, handler)
				}
				return () => undefined
			},
			publish: async () => undefined,
		}
		const subscriber = createValidatorSubscriber({
			state: createValidatorState(VALIDATOR_PUBKEY),
			relayPool: relayPool as any,
			publisher: { publishIfChanged: async () => ({ verdict: { claim: 'bid_invalid', reason: 'test' }, published: true }) } as any,
		})

		await subscriber.start()
		expect(subscriptions).toHaveLength(2)
		expect(subscriptions[0]?.[0]).toMatchObject({ kinds: [AUCTION_BID_KIND, AUCTION_PATH_RELEASE_KIND, AUCTION_SETTLEMENT_KIND] })
		expect(subscriptions[0]?.[0]).toHaveProperty('since')
		expect(subscriptions[1]?.[0]).toMatchObject({ kinds: [AUCTION_KIND] })
		expect(subscriptions[1]?.[0]).toHaveProperty('since')

		const auctionEvent = createSignedEvent(sellerSk, {
			kind: AUCTION_KIND,
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
				['mint', 'http://mint.test'],
			],
		} as unknown as EventTemplate)

		const auctionHandler = relayPool.handlers.get(AUCTION_KIND) as ((event: NostrEvent) => void) | undefined
		if (!auctionHandler) throw new Error('subscriber did not register an auction handler')
		auctionHandler(auctionEvent)
		await flush()

		expect(subscriptions).toHaveLength(3)
		expect(subscriptions[2]).toEqual([
			{
				kinds: [AUCTION_BID_KIND, AUCTION_PATH_RELEASE_KIND, AUCTION_SETTLEMENT_KIND],
				'#a': [`30408:${sellerPubkey}:auction-test`],
			},
		])

		await subscriber.stop()
	})

	test('keeps a child REQ through settlement grace and retires it afterward when no verdict work remains', async () => {
		const state = createValidatorState(VALIDATOR_PUBKEY)
		buildAuctionState(state)
		let t = 2_161
		let childUnsubscribeCalls = 0
		const relayPool = {
			handlers: new Map<number, (event: NostrEvent) => void>(),
			subscribe: async (filters: Array<{ kinds?: number[] }>, handler: (event: NostrEvent) => void) => {
				for (const kind of filters[0]?.kinds ?? []) {
					;(relayPool as any).handlers.set(kind, handler)
				}
				const isChildSubscription = (filters[0]?.kinds?.length ?? 0) > 1
				return () => {
					if (isChildSubscription) childUnsubscribeCalls += 1
				}
			},
			publish: async () => undefined,
		}
		const subscriber = createValidatorSubscriber({
			state,
			relayPool: relayPool as any,
			publisher: { publishIfChanged: async () => ({ verdict: { claim: 'bid_invalid', reason: 'test' }, published: false }) } as any,
			now: () => t,
		})

		await subscriber.start()
		await subscriber.republishAll()

		expect(childUnsubscribeCalls).toBe(0)
		t = 5_701
		await subscriber.republishAll()

		expect(childUnsubscribeCalls).toBe(1)
		await subscriber.stop()
	})
})
