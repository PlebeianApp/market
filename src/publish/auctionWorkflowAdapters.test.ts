import { describe, expect, test } from 'bun:test'
import type { ParsedAuctionEvent } from '@sdk/commerce/auctions'
import {
	runAuctionListingAppAdapter,
	runAuctionPathReleaseAppAdapter,
	runAuctionSettlementAppAdapter,
	runAuctionWinnerClaimAppAdapter,
} from './auctionWorkflowAdapters'

const auction = {
	rawEvent: {} as ParsedAuctionEvent['rawEvent'],
	dTag: 'lot',
	sellerPubkey: 'a'.repeat(64),
	coordinate: `30408:${'a'.repeat(64)}:lot`,
	rootEventId: 'b'.repeat(64),
	title: 'Lot',
	content: '',
	auctionType: 'english',
	startAt: 10,
	endAt: 100,
	maxEndAt: 100,
	settlementGrace: 300,
	currency: 'SAT',
	reserve: 10,
	startingBid: 5,
	bidIncrement: 1,
	minBidCurve: { shape: 'none', peakMultiplier: 1, raw: '' },
	settlementPolicy: 'cashu_p2pk_bidder_path_v1',
	keyScheme: 'hd_p2pk',
	mints: ['https://mint.invalid'],
	p2pkXpub: 'xpub',
	auditors: ['c'.repeat(64)],
	auditorQuorum: 1,
	maxSkewSec: 120,
	fallbackDelaySec: 150,
	schema: 'auction_v1',
} as ParsedAuctionEvent

describe('auction app workflow adapters', () => {
	test('listing adapter performs mint preflight before preparing, signing, and publishing the app template', async () => {
		const calls: string[] = []
		const template = { kind: 30408, created_at: 50, content: '', tags: [['custom', 'preserved']] }
		const outcome = await runAuctionListingAppAdapter({
			mints: ['https://mint.invalid'],
			prepareTemplate: () => {
				calls.push('prepare')
				return template
			},
			ports: {
				assertMintsSupported: async () => {
					calls.push('mint-check')
				},
				sign: async (received) => {
					calls.push('sign')
					expect(received).toEqual(template)
					return { id: 'listing-id' }
				},
				publish: async () => {
					calls.push('publish')
				},
			},
		})

		expect(calls).toEqual(['mint-check', 'prepare', 'sign', 'publish'])
		expect(outcome).toEqual({ status: 'published', eventId: 'listing-id' })
	})

	test('path-release adapter preserves acknowledged prior legs if a later relay publish is uncertain', async () => {
		const outcome = await runAuctionPathReleaseAppAdapter({
			legs: [
				{ bidEventId: 'bid-1', amount: 5, template: 'release-1' },
				{ bidEventId: 'bid-2', amount: 7, template: 'release-2' },
			],
			ports: {
				sign: async (template) => ({ id: `${template}-signed` }),
				publish: async (event) => {
					if (event.id === 'release-2-signed') throw new Error('relay timeout')
				},
				markReleased: async () => {},
			},
		})

		expect(outcome).toMatchObject({
			status: 'publish_uncertain',
			pathReleaseEventId: 'release-1-signed',
			attemptedEventId: 'release-2-signed',
			legsReleased: 1,
		})
	})

	test('settlement adapter reports already-redeemed legs when a later redemption fails', async () => {
		const outcome = await runAuctionSettlementAppAdapter({
			plan: {
				status: 'settled',
				auction,
				closeAt: 110,
				createdAt: 111,
				winningBidId: 'bid-2',
				winnerPubkey: 'd'.repeat(64),
				finalAmount: 20,
				pathReleaseEventId: 'release-2',
				legs: [
					{ bidEventId: 'bid-1', amount: 10, locktime: 400, redemptionData: 'first-token' },
					{ bidEventId: 'bid-2', amount: 10, locktime: 400, redemptionData: 'second-token' },
				],
			},
			ports: {
				preflightAll: async () => {},
				inspectLeg: async (leg) => (leg.bidEventId === 'bid-1' ? 'redeemed_by_seller' : 'unspent'),
				redeemLeg: async () => {
					throw new Error('mint unavailable')
				},
				assertReserveNotMet: async () => {},
				publish: async () => ({ eventId: 'settlement-id' }),
			},
		})

		expect(outcome).toEqual({ status: 'failed', phase: 'redemption', error: 'mint unavailable', redeemedBidIds: ['bid-1'] })
	})

	test('claim adapter publishes private delivery before the marker and retains partial evidence', async () => {
		const calls: string[] = []
		const outcome = await runAuctionWinnerClaimAppAdapter({
			claim: {
				orderId: 'order-1',
				auctionCoordinate: auction.coordinate,
				auctionEventId: 'e'.repeat(64),
				settlementEventId: 'f'.repeat(64),
				buyerPubkey: 'd'.repeat(64),
				sellerPubkey: auction.sellerPubkey,
				finalAmount: 25,
				shippingAddress: {
					name: 'Buyer',
					firstLineOfAddress: 'Private Street',
					city: 'City',
					zipPostcode: '12345',
					country: 'XX',
				},
				createdAt: 120,
			},
			ports: {
				createPrivateDelivery: async (payload) => {
					calls.push('create-private')
					return payload
				},
				publishPrivateDelivery: async () => {
					calls.push('publish-private')
					return { eventId: 'private-id', acceptedRelays: ['wss://relay.test'] }
				},
				signMarker: async () => {
					calls.push('sign-marker')
					return { id: 'marker-id' }
				},
				publishMarker: async (_marker, relays) => {
					calls.push('publish-marker')
					expect(relays).toEqual(['wss://relay.test'])
					throw new Error('marker timeout')
				},
			},
		})

		expect(calls).toEqual(['create-private', 'publish-private', 'sign-marker', 'publish-marker'])
		expect(outcome).toMatchObject({
			status: 'partial',
			phase: 'marker_publish',
			privateDeliveryEventId: 'private-id',
			acceptedRelays: ['wss://relay.test'],
		})
	})
})
