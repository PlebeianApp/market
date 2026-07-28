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
					const kind = filters[0]?.kinds?.[0]
					if (kind !== undefined) {
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
