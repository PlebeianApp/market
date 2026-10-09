import { describe, expect, test } from 'bun:test'
import {
	AUCTION_MULTIPARTY_LEG_FLOOR_SATS,
	AuctionMultipartyLegFloorError,
	computeMultipartyLegFloor,
	computeMultipartyLegFloorFromCanonicalSchedule,
	computeMultipartyLegFloorFromSchedule,
	isLegLockedAmountAboveFloor,
} from '../auction/multipartyLegFloor'
import type { AuctionMultipartyCanonicalSchedule, AuctionMultipartyCanonicalScheduleEntry } from '../auction/multipartySchedule'

describe('Auction multiparty leg floor', () => {
	test('single-party auctions keep the historical per-bid floor', () => {
		const floor = computeMultipartyLegFloor({ auxiliaryEntryCount: 0 })
		expect(floor.payoutLegCount).toBe(1)
		expect(floor.legFloorSats).toBe(AUCTION_MULTIPARTY_LEG_FLOOR_SATS)
		expect(floor.floorTotalSats).toBe(10)
		expect(floor.feeReserveSats).toBe(0)
		expect(floor.minimumBidSats).toBe(10)
	})

	test('the floor applies per payout leg, not once per bid', () => {
		expect(computeMultipartyLegFloor({ auxiliaryEntryCount: 1 }).minimumBidSats).toBe(20)
		expect(computeMultipartyLegFloor({ auxiliaryEntryCount: 3 }).minimumBidSats).toBe(40)
		// The maintainer's example: five recipients require 60 sats before fees.
		expect(computeMultipartyLegFloor({ auxiliaryEntryCount: 5 }).minimumBidSats).toBe(60)
		expect(computeMultipartyLegFloor({ auxiliaryEntryCount: 5 }).payoutLegCount).toBe(6)
		expect(computeMultipartyLegFloor({ auxiliaryEntryCount: 16 }).minimumBidSats).toBe(170)
	})

	test('fees are reserved on top of the floors, per payout leg for swap fees', () => {
		const floor = computeMultipartyLegFloor({
			auxiliaryEntryCount: 5,
			estimatedInboundFeeSats: 5,
			estimatedSwapFeeSatsPerPayout: 1,
		})
		expect(floor.floorTotalSats).toBe(60)
		expect(floor.feeReserveSats).toBe(11)
		expect(floor.minimumBidSats).toBe(71)
	})

	test('a caller may lower or raise the per-leg floor', () => {
		expect(computeMultipartyLegFloor({ auxiliaryEntryCount: 4, legFloorSats: 5 }).minimumBidSats).toBe(25)
		expect(computeMultipartyLegFloor({ auxiliaryEntryCount: 4, legFloorSats: 1_000 }).minimumBidSats).toBe(5_000)
	})

	test('a leg at or above the minimum satisfies the policy', () => {
		const floor = computeMultipartyLegFloor({ auxiliaryEntryCount: 2 })
		expect(isLegLockedAmountAboveFloor(30, floor)).toBe(true)
		expect(isLegLockedAmountAboveFloor(31, floor)).toBe(true)
		expect(isLegLockedAmountAboveFloor(29, floor)).toBe(false)
		expect(isLegLockedAmountAboveFloor(-1, floor)).toBe(false)
		expect(isLegLockedAmountAboveFloor(1.5, floor)).toBe(false)
	})

	test('invalid inputs fail closed with named codes', () => {
		const codes = (fn: () => unknown): string => {
			try {
				fn()
			} catch (error) {
				return error instanceof AuctionMultipartyLegFloorError ? error.code : 'not_our_error'
			}
			return 'no_error'
		}
		expect(codes(() => computeMultipartyLegFloor({ auxiliaryEntryCount: -1 }))).toBe('leg_floor_entry_count_invalid')
		expect(codes(() => computeMultipartyLegFloor({ auxiliaryEntryCount: 1.5 }))).toBe('leg_floor_entry_count_invalid')
		expect(codes(() => computeMultipartyLegFloor({ auxiliaryEntryCount: 17 }))).toBe('leg_floor_entry_count_exceeds_limit')
		expect(codes(() => computeMultipartyLegFloor({ auxiliaryEntryCount: 1, legFloorSats: 0 }))).toBe('leg_floor_value_invalid')
		expect(codes(() => computeMultipartyLegFloor({ auxiliaryEntryCount: 1, estimatedInboundFeeSats: -1 }))).toBe('leg_floor_fee_invalid')
	})

	test('the projection is frozen and schedule-derived calls delegate', () => {
		const floor = computeMultipartyLegFloor({ auxiliaryEntryCount: 2 })
		expect(Object.isFrozen(floor)).toBe(true)
		expect(computeMultipartyLegFloorFromSchedule(2)).toEqual(floor)
		expect(computeMultipartyLegFloorFromSchedule(2, { legFloorSats: 5 }).minimumBidSats).toBe(15)
	})

	test('a parsed canonical schedule counts its entries as the auxiliary entries, seller excluded', () => {
		// D1: the seller is implicit, so the schedule holds auxiliary entries only — counting the
		// seller here as well would inflate the minimum by one leg.
		const schedule = (entryCount: number): AuctionMultipartyCanonicalSchedule => ({
			entries: Array.from(
				{ length: entryCount },
				(_, index): AuctionMultipartyCanonicalScheduleEntry => ({
					schedule_index: index,
					role: index % 2 === 0 ? 'validator' : 'v4v',
					recipient_pubkey: `0${(index % 2) + 2}${index.toString(16).padStart(2, '0')}${'a'.repeat(60)}`,
					payout_capability_event_id: 'p'.repeat(64),
					allocation_bps: 100,
				}),
			),
			auxiliary_allocation_bps: entryCount * 100,
			seller_remainder_bps: 10_000 - entryCount * 100,
			canonical_bytes: new Uint8Array(),
			commitment_preimage: new Uint8Array(),
			schedule_commitment: '0'.repeat(64),
		})

		expect(computeMultipartyLegFloorFromCanonicalSchedule(schedule(0))).toEqual(computeMultipartyLegFloor({ auxiliaryEntryCount: 0 }))
		expect(computeMultipartyLegFloorFromCanonicalSchedule(schedule(3)).payoutLegCount).toBe(4)
		expect(computeMultipartyLegFloorFromCanonicalSchedule(schedule(5)).minimumBidSats).toBe(60)
		expect(computeMultipartyLegFloorFromCanonicalSchedule(schedule(5), { legFloorSats: 5 }).minimumBidSats).toBe(30)
		// The wire limit still applies: 17 auxiliary entries is past the schedule's own bound.
		expect(() => computeMultipartyLegFloorFromCanonicalSchedule(schedule(17))).toThrow(AuctionMultipartyLegFloorError)
	})
})
