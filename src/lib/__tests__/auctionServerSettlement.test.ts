import { describe, expect, test } from 'bun:test'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { buildAuctionSettlementPlan } from '@/server/auction/settlement'
import type { AuctionContext } from '@/server/auction/context'

const makeAuction = (): NDKEvent =>
	({
		id: 'auction-root',
		pubkey: 'seller',
		created_at: 100,
		content: 'Auction',
		tags: [
			['d', 'auction-1'],
			['title', 'Auction'],
			['auction_type', 'english'],
			['start_at', '100'],
			['end_at', '200'],
			['max_end_at', '200'],
			['settlement_grace', '300'],
			['currency', 'SAT'],
			['price', '333', 'SAT'],
			['starting_bid', '333', 'SAT'],
			['bid_increment', '13'],
			['reserve', '0'],
			['mint', 'https://testnut.cashu.space'],
			['path_issuer', 'issuer'],
			['key_scheme', 'hd_p2pk'],
			['p2pk_xpub', 'xpub-placeholder'],
			['settlement_policy', 'cashu_p2pk_path_oracle_v1'],
			['schema', 'auction_v1'],
		],
	}) as NDKEvent

const makeBid = (): NDKEvent =>
	({
		id: 'bid-1',
		pubkey: 'bidder',
		created_at: 150,
		content: JSON.stringify({ amount: 346 }),
		tags: [
			['e', 'auction-root'],
			['a', '30408:seller:auction-1'],
			['p', 'seller'],
			['amount', '346', 'SAT'],
			['delta_amount', '346', 'SAT'],
			['currency', 'SAT'],
			['mint', 'https://testnut.cashu.space'],
			['commitment', 'token-commitment'],
			['locktime', '500'],
			['refund_pubkey', '02'.padEnd(66, '1')],
			['status', 'locked'],
			['schema', 'auction_bid_v1'],
			['child_pubkey', '02'.padEnd(66, '2')],
			['path_issuer', 'issuer'],
			['path_grant_id', 'grant-1'],
		],
	}) as NDKEvent

const makeContext = (auction: NDKEvent, bid: NDKEvent): AuctionContext =>
	({
		issuerPubkey: 'issuer',
		signer: {} as AuctionContext['signer'],
		stateStore: {} as AuctionContext['stateStore'],
		ndk: {
			fetchEvent: async () => auction,
			fetchEvents: async (filter: any) => {
				if (Array.isArray(filter)) return new Set([bid])
				const kind = filter?.kinds?.[0]
				if (kind === 30408) return new Set([auction])
				if (kind === 1023) return new Set([bid])
				return new Set()
			},
		} as AuctionContext['ndk'],
	}) as AuctionContext

describe('server auction settlement', () => {
	test('refuses reserve_not_met when a reserve-meeting public bid has no locked registry payload', async () => {
		const auction = makeAuction()
		const bid = makeBid()

		await expect(
			buildAuctionSettlementPlan(makeContext(auction, bid), {
				auctionEventId: auction.id,
				auctionCoordinates: '30408:seller:auction-1',
			}),
		).rejects.toThrow('reserve-meeting bid exists')
	})
})
