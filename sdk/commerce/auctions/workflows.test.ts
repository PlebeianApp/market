import { describe, expect, test } from 'bun:test'
import type { ParsedAuctionEvent } from './events'
import {
	createAuctionBidTemplate,
	executeAuctionBidReclaimWorkflow,
	executeAuctionPathReleaseWorkflow,
	executeAuctionListingWorkflow,
	executeAuctionListingTemplateWorkflow,
	executeAuctionSettlementWorkflow,
	executeAuctionWinnerClaimWorkflow,
	executeFundedAuctionBidWorkflow,
	planAuctionBid,
	planAuctionBidRecovery,
	planAuctionBidReclaimTiming,
	planAuctionSettlement,
	prepareAuctionListing,
	prepareAuctionWinnerClaim,
	retryAuctionBidPublish,
	type AuctionBidPlan,
	type AuctionSettlementPlan,
} from './workflows'

const auction = {
	rawEvent: {} as ParsedAuctionEvent['rawEvent'],
	dTag: 'lot-1',
	sellerPubkey: 'a'.repeat(64),
	coordinate: `30408:${'a'.repeat(64)}:lot-1`,
	rootEventId: 'b'.repeat(64),
	title: 'Lot',
	content: '',
	auctionType: 'english',
	startAt: 100,
	endAt: 200,
	maxEndAt: 210,
	settlementGrace: 300,
	currency: 'SAT',
	reserve: 0,
	startingBid: 20,
	bidIncrement: 5,
	minBidCurve: { shape: 'none', peakMultiplier: 1, raw: '' },
	settlementPolicy: 'cashu_p2pk_bidder_path_v1',
	keyScheme: 'hd_p2pk',
	mints: ['https://mint.example'],
	p2pkXpub: 'xpub',
	auditors: ['c'.repeat(64)],
	auditorQuorum: 1,
	maxSkewSec: 120,
	fallbackDelaySec: 150,
	schema: 'auction_v1',
} as ParsedAuctionEvent

const listingInput = {
	auction: {
		dTag: 'lot-1',
		title: 'Lot',
		startAt: 100,
		endAt: 200,
		maxEndAt: 210,
		settlementGrace: 300,
		reserve: 20,
		startingBid: 10,
		bidIncrement: 5,
		mints: ['https://mint.example'],
		p2pkXpub: 'xpub',
		auditors: ['c'.repeat(64)],
	},
	content: 'Details',
	createdAt: 99,
}

describe('auction lifecycle SDK workflows', () => {
	test('prepares a listing and runs mint preflight before signing and publishing', async () => {
		const template = prepareAuctionListing(listingInput)
		expect(template.kind).toBe(30408)
		expect(template.tags).toContainEqual(['starting_bid', '10'])
		const order: string[] = []
		const outcome = await executeAuctionListingWorkflow(listingInput, {
			assertMintsSupported: async () => {
				order.push('mint')
			},
			sign: async () => {
				order.push('sign')
				return { id: 'listing-id' }
			},
			publish: async () => {
				order.push('publish')
			},
		})
		expect(outcome).toEqual({ status: 'published', eventId: 'listing-id' })
		expect(order).toEqual(['mint', 'sign', 'publish'])
	})

	test('publishes a host-prepared listing template without altering its tags', async () => {
		const template = {
			kind: 30408,
			created_at: 99,
			content: 'host listing',
			tags: [
				['price', '100', 'SAT'],
				['custom', 'kept'],
			],
		}
		const calls: string[] = []
		const outcome = await executeAuctionListingTemplateWorkflow(
			async () => {
				calls.push('prepare')
				return template
			},
			['https://mint.example'],
			{
				assertMintsSupported: async (mints) => {
					calls.push(`mints:${mints.join(',')}`)
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
		)

		expect(outcome).toEqual({ status: 'published', eventId: 'listing-id' })
		expect(calls).toEqual(['mints:https://mint.example', 'prepare', 'sign', 'publish'])
	})

	test('plans cumulative rebids as delta funding and builds the canonical bid template', () => {
		const plan = planAuctionBid({
			auction,
			bidderPubkey: 'd'.repeat(64),
			amount: 60,
			topBid: 50,
			now: 150,
			previousLeg: {
				id: 'previous-bid',
				bidderPubkey: 'd'.repeat(64),
				auctionRootEventId: auction.rootEventId,
				auctionCoordinate: auction.coordinate,
				amount: 50,
				locktime: 510,
			},
		})
		expect(plan.legAmount).toBe(10)
		expect(plan.locktime).toBe(510)
		expect(plan.previousBidId).toBe('previous-bid')
		const template = createAuctionBidTemplate(plan, {
			mint: 'https://mint.example',
			refundPubkey: 'refund',
			childPubkey: 'child',
			lockSecrets: ['secret'],
			proofYs: ['y'],
			dleqProofs: [{ id: 'keyset', amount: 10, C: 'C', e: 'e', s: 's', r: 'r' }],
			bidNonce: 'nonce',
			createdAt: 151,
		})
		expect(template.kind).toBe(1023)
		expect(template.tags).toContainEqual(['prev_bid', 'previous-bid'])
		expect(template.tags).toContainEqual(['amount', '60'])
	})

	test('reports the anti-snipe floor as advisory without rejecting a valid lower bid', () => {
		const plan = planAuctionBid({
			auction: { ...auction, minBidCurve: { shape: 'linear', peakMultiplier: 2, raw: 'linear:2' } },
			bidderPubkey: 'd'.repeat(64),
			amount: 55,
			topBid: 50,
			now: 205,
		})
		expect(plan.minimumAmount).toBe(20)
		expect(plan.suggestedAmount).toBeGreaterThan(plan.amount)
	})

	test('plans safe retry, exact-event retry, and wallet-owned recovery actions explicitly', () => {
		expect(planAuctionBidRecovery({ status: 'pre_lock_failure' })).toEqual({ action: 'retry_funding' })
		expect(planAuctionBidRecovery({ status: 'publish_retryable', bidEventId: 'bid-event' })).toEqual({
			action: 'retry_publish',
			bidEventId: 'bid-event',
		})
		expect(planAuctionBidRecovery({ status: 'locked_unpublished', tokenId: 'pending-token' })).toEqual({
			action: 'reclaim_from_wallet',
			tokenId: 'pending-token',
		})
		expect(planAuctionBidRecovery({ status: 'lock_outcome_uncertain', pendingTokenPersisted: true }).action).toBe('inspect_wallet')
		expect(planAuctionBidRecovery({ status: 'lock_outcome_uncertain', pendingTokenPersisted: false }).action).toBe('manual_recovery')
		expect(planAuctionBidRecovery({ status: 'published' })).toEqual({ action: 'none' })
		expect(planAuctionBidRecovery({ status: 'reclaimed' })).toEqual({ action: 'none' })
	})

	test('uses the wallet-derived reclaim-ready time and never guesses timelock eligibility', () => {
		expect(planAuctionBidReclaimTiming({ tokenId: 'pending-token', readyAt: 500, now: 499 })).toEqual({
			status: 'waiting',
			tokenId: 'pending-token',
			readyAt: 500,
			waitSeconds: 1,
		})
		expect(planAuctionBidReclaimTiming({ tokenId: 'pending-token', readyAt: 500, now: 500 })).toEqual({
			status: 'ready',
			tokenId: 'pending-token',
		})
		expect(planAuctionBidReclaimTiming({ tokenId: 'ordinary-token', readyAt: 0, now: 500 })).toEqual({
			status: 'ready',
			tokenId: 'ordinary-token',
		})
	})

	test('does not call the wallet before the authoritative reclaim-ready time', async () => {
		let reclaimCalls = 0
		const outcome = await executeAuctionBidReclaimWorkflow(
			{ tokenId: 'pending-token', readyAt: 500, now: 499 },
			{
				reclaim: async () => {
					reclaimCalls++
				},
			},
		)

		expect(outcome).toEqual({ status: 'waiting', tokenId: 'pending-token', readyAt: 500, waitSeconds: 1 })
		expect(reclaimCalls).toBe(0)
	})

	test('reports wallet-confirmed reclaim and wallet failures distinctly', async () => {
		const reclaimed = await executeAuctionBidReclaimWorkflow(
			{ tokenId: 'pending-token', readyAt: 500, now: 500 },
			{ reclaim: async () => {} },
		)
		expect(reclaimed).toEqual({ status: 'reclaimed', tokenId: 'pending-token' })

		const failed = await executeAuctionBidReclaimWorkflow(
			{ tokenId: 'pending-token', readyAt: 500, now: 500 },
			{
				reclaim: async () => {
					throw new Error('refund key unavailable')
				},
			},
		)
		expect(failed).toMatchObject({ status: 'failed', tokenId: 'pending-token', error: 'refund key unavailable' })
	})

	test('does not acquire funding after pre-lock recovery persistence fails', async () => {
		const plan: AuctionBidPlan = {
			auctionRootEventId: auction.rootEventId,
			auctionCoordinate: auction.coordinate,
			sellerPubkey: auction.sellerPubkey,
			amount: 30,
			legAmount: 30,
			minimumAmount: 20,
			suggestedAmount: 20,
			locktime: 510,
			createdForEndAt: 210,
		}
		let lockCalls = 0
		const outcome = await executeFundedAuctionBidWorkflow(plan, {
			prepareLock: async () => ({ intent: {}, preLockRecovery: {} }),
			persistPreLockRecovery: async () => {
				throw new Error('disk unavailable')
			},
			lockFunds: async () => {
				lockCalls++
				return { status: 'locked', funding: {} }
			},
			createPublication: async () => ({ event: 'event', recovery: {} }),
			persistFundedPublication: async () => {},
			sign: async () => ({ id: 'signed' }),
			persistSignedEvent: async () => {},
			publish: async () => {},
		})
		expect(outcome.status).toBe('failed_before_lock')
		expect(lockCalls).toBe(0)
	})

	test('funded bid publication failure is retryable and retry cannot lock again', async () => {
		const plan: AuctionBidPlan = {
			auctionRootEventId: auction.rootEventId,
			auctionCoordinate: auction.coordinate,
			sellerPubkey: auction.sellerPubkey,
			amount: 30,
			legAmount: 30,
			minimumAmount: 20,
			suggestedAmount: 20,
			locktime: 510,
			createdForEndAt: 210,
		}
		const calls: string[] = []
		const outcome = await executeFundedAuctionBidWorkflow(plan, {
			prepareLock: async () => ({ intent: 'intent', preLockRecovery: 'pre' }),
			persistPreLockRecovery: async () => {
				calls.push('persist-pre')
			},
			lockFunds: async () => {
				calls.push('lock')
				return { status: 'locked', funding: 'proofs' }
			},
			createPublication: async () => ({ event: 'exact-event', recovery: 'record' }),
			persistFundedPublication: async () => {
				calls.push('persist-event')
			},
			sign: async () => {
				calls.push('sign')
				return { id: 'bid-id' }
			},
			persistSignedEvent: async () => {
				calls.push('persist-signed')
			},
			publish: async () => {
				calls.push('publish')
				throw new Error('relay timeout')
			},
		})
		expect(outcome).toMatchObject({ status: 'publish_retryable', signedEvent: { id: 'bid-id' } })
		const retry = await retryAuctionBidPublish({
			load: async () => ({ event: 'exact-event', signedEvent: { id: 'bid-id' }, recovery: 'record' }),
			sign: async () => {
				throw new Error('must reuse signed event')
			},
			persistSignedEvent: async () => {
				throw new Error('must already be persisted')
			},
			publish: async (event) => {
				calls.push(`retry:${event.id}`)
			},
		})
		expect(retry).toEqual({ status: 'published', eventId: 'bid-id' })
		expect(calls.filter((call) => call === 'lock')).toHaveLength(1)
		expect(calls.at(-1)).toBe('retry:bid-id')
	})

	test('settlement preflights the full chain, resumes confirmed redeemed legs, then publishes', async () => {
		const plan: AuctionSettlementPlan<string> = planAuctionSettlement({
			status: 'settled',
			auction,
			closeAt: 220,
			createdAt: 221,
			winningBidId: 'bid-2',
			winnerPubkey: 'd'.repeat(64),
			finalAmount: 20,
			pathReleaseEventId: 'release',
			legs: [
				{ bidEventId: 'bid-1', amount: 10, locktime: 510, redemptionData: 'first' },
				{ bidEventId: 'bid-2', amount: 10, locktime: 510, redemptionData: 'second' },
			],
		})
		const calls: string[] = []
		const outcome = await executeAuctionSettlementWorkflow(plan, {
			preflightAll: async () => {
				calls.push('preflight')
			},
			inspectLeg: async (leg) => {
				calls.push(`inspect:${leg.bidEventId}`)
				return leg.bidEventId === 'bid-1' ? 'redeemed_by_seller' : 'unspent'
			},
			redeemLeg: async (leg) => {
				calls.push(`redeem:${leg.bidEventId}`)
			},
			assertReserveNotMet: async () => {},
			publish: async (template) => {
				calls.push('publish')
				expect(template.tags).toContainEqual(['payout', 'bid-1', '10', 'redeemed'])
				return { eventId: 'settlement-id' }
			},
		})
		expect(outcome).toEqual({ status: 'published', eventId: 'settlement-id', redeemedBidIds: ['bid-1', 'bid-2'] })
		expect(calls).toEqual(['preflight', 'inspect:bid-1', 'inspect:bid-2', 'redeem:bid-2', 'publish'])
	})

	test('preserves redeemed leg IDs when a later Cashu redemption fails', async () => {
		const plan = planAuctionSettlement({
			status: 'settled',
			auction,
			closeAt: 220,
			createdAt: 221,
			winningBidId: 'bid-2',
			winnerPubkey: 'd'.repeat(64),
			finalAmount: 20,
			pathReleaseEventId: 'release',
			legs: [
				{ bidEventId: 'bid-1', amount: 10, locktime: 510, redemptionData: 'first' },
				{ bidEventId: 'bid-2', amount: 10, locktime: 510, redemptionData: 'second' },
			],
		})
		const outcome = await executeAuctionSettlementWorkflow(plan, {
			preflightAll: async () => {},
			inspectLeg: async () => 'unspent',
			redeemLeg: async (leg) => {
				if (leg.bidEventId === 'bid-2') throw new Error('mint unavailable')
			},
			assertReserveNotMet: async () => {},
			publish: async () => ({ eventId: 'unused' }),
		})

		expect(outcome).toEqual({ status: 'failed', phase: 'redemption', error: 'mint unavailable', redeemedBidIds: ['bid-1'] })
	})

	test('reports uncertain settlement publication after all legs redeemed', async () => {
		const plan = planAuctionSettlement({
			status: 'settled',
			auction,
			closeAt: 220,
			createdAt: 221,
			winningBidId: 'bid-1',
			winnerPubkey: 'd'.repeat(64),
			finalAmount: 10,
			pathReleaseEventId: 'release',
			legs: [{ bidEventId: 'bid-1', amount: 10, locktime: 510, redemptionData: 'token' }],
		})
		const outcome = await executeAuctionSettlementWorkflow(plan, {
			preflightAll: async () => {},
			inspectLeg: async () => 'unspent',
			redeemLeg: async () => {},
			assertReserveNotMet: async () => {},
			publish: async () => {
				throw new Error('relay timeout')
			},
		})

		expect(outcome).toMatchObject({ status: 'publish_uncertain', redeemedBidIds: ['bid-1'], error: 'relay timeout' })
	})

	test('winner claim marker has no delivery PII and preserves private-first partial progress', async () => {
		const claim = {
			orderId: 'order-1',
			auctionCoordinate: auction.coordinate,
			auctionEventId: 'e'.repeat(64),
			settlementEventId: 'f'.repeat(64),
			buyerPubkey: 'd'.repeat(64),
			sellerPubkey: auction.sellerPubkey,
			finalAmount: 100,
			shippingAddress: {
				name: 'Buyer Name',
				firstLineOfAddress: 'Secret Street',
				city: 'Private City',
				zipPostcode: '12345',
				country: 'XX',
			},
			email: 'buyer@example.test',
			phone: '555-0100',
			notes: 'Leave privately',
			createdAt: 300,
		}
		const prepared = prepareAuctionWinnerClaim(claim)
		expect(JSON.stringify(prepared.marker)).not.toContain('Secret Street')
		expect(JSON.stringify(prepared.marker)).not.toContain('buyer@example.test')
		const outcome = await executeAuctionWinnerClaimWorkflow(claim, {
			createPrivateDelivery: async (payload) => payload,
			publishPrivateDelivery: async () => ({
				eventId: 'gift-wrap-id',
				acceptedRelays: ['wss://private.example'],
			}),
			signMarker: async () => ({ id: 'marker-id' }),
			publishMarker: async (_marker, relays) => {
				expect(relays).toEqual(['wss://private.example'])
				throw new Error('marker relay timeout')
			},
		})
		expect(outcome).toMatchObject({
			status: 'partial',
			privateDeliveryEventId: 'gift-wrap-id',
			acceptedRelays: ['wss://private.example'],
		})
	})

	test('publishes path-release legs in chain order and records each acknowledged leg', async () => {
		const calls: string[] = []
		const outcome = await executeAuctionPathReleaseWorkflow(
			[
				{ bidEventId: 'bid-1', amount: 10, template: 'release-1' },
				{ bidEventId: 'bid-2', amount: 15, template: 'release-2' },
			],
			{
				sign: async (template) => {
					calls.push(`sign:${template}`)
					return { id: `${template}-signed` }
				},
				publish: async (event) => {
					calls.push(`publish:${event.id}`)
				},
				markReleased: async (bidEventId) => {
					calls.push(`record:${bidEventId}`)
				},
			},
		)

		expect(calls).toEqual([
			'sign:release-1',
			'publish:release-1-signed',
			'record:bid-1',
			'sign:release-2',
			'publish:release-2-signed',
			'record:bid-2',
		])
		expect(outcome).toMatchObject({
			status: 'published',
			pathReleaseEventId: 'release-2-signed',
			legsReleased: 2,
			cumulativeBidAmount: 25,
			progress: [
				{ bidEventId: 'bid-1', status: 'published', eventId: 'release-1-signed', recoveryRecorded: true },
				{ bidEventId: 'bid-2', status: 'published', eventId: 'release-2-signed', recoveryRecorded: true },
			],
		})
	})

	test('retains acknowledged release progress when a later leg fails to sign', async () => {
		const outcome = await executeAuctionPathReleaseWorkflow(
			[
				{ bidEventId: 'bid-1', amount: 10, template: 'release-1' },
				{ bidEventId: 'bid-2', amount: 15, template: 'release-2' },
			],
			{
				sign: async (template) => {
					if (template === 'release-2') throw new Error('signer unavailable')
					return { id: 'release-1-signed' }
				},
				publish: async () => {},
				markReleased: async () => {},
			},
		)

		expect(outcome).toMatchObject({
			status: 'partial',
			failedBidEventId: 'bid-2',
			failedPhase: 'sign',
			pathReleaseEventId: 'release-1-signed',
			legsReleased: 1,
			cumulativeBidAmount: 10,
			progress: [
				{ bidEventId: 'bid-1', status: 'published', recoveryRecorded: true },
				{ bidEventId: 'bid-2', status: 'pending', recoveryRecorded: false },
			],
		})
	})

	test('classifies relay exceptions as uncertain and does not mark that leg released', async () => {
		const recorded: string[] = []
		const outcome = await executeAuctionPathReleaseWorkflow(
			[
				{ bidEventId: 'bid-1', amount: 10, template: 'release-1' },
				{ bidEventId: 'bid-2', amount: 15, template: 'release-2' },
			],
			{
				sign: async (template) => ({ id: `${template}-signed` }),
				publish: async (event) => {
					if (event.id === 'release-2-signed') throw new Error('relay timeout')
				},
				markReleased: async (bidEventId) => {
					recorded.push(bidEventId)
				},
			},
		)

		expect(outcome).toMatchObject({
			status: 'publish_uncertain',
			failedBidEventId: 'bid-2',
			attemptedEventId: 'release-2-signed',
			pathReleaseEventId: 'release-1-signed',
			legsReleased: 1,
			progress: [
				{ bidEventId: 'bid-1', status: 'published', recoveryRecorded: true },
				{ bidEventId: 'bid-2', status: 'publish_uncertain', recoveryRecorded: false },
			],
		})
		expect(recorded).toEqual(['bid-1'])
	})

	test('reports partial progress when release publish succeeds but local record update fails', async () => {
		const outcome = await executeAuctionPathReleaseWorkflow([{ bidEventId: 'bid-1', amount: 10, template: 'release-1' }], {
			sign: async () => ({ id: 'release-1-signed' }),
			publish: async () => {},
			markReleased: async () => {
				throw new Error('local record unavailable')
			},
		})

		expect(outcome).toMatchObject({
			status: 'partial',
			failedBidEventId: 'bid-1',
			failedPhase: 'record_release',
			pathReleaseEventId: 'release-1-signed',
			legsReleased: 1,
			progress: [{ bidEventId: 'bid-1', status: 'published', eventId: 'release-1-signed', recoveryRecorded: false }],
		})
	})
})
