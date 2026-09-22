/**
 * Auction multiparty leg floor — client policy.
 *
 * Under `cashu_p2pk_bidder_path_multiparty_v1` a single bid increment is locked
 * across **one leg per payout entry** (the seller plus every scheduled auxiliary
 * entry), not one leg per bid. A per-bid floor is therefore wrong: with five
 * recipients a 10-sat bid produces six legs of less than two sats each, which is
 * below mint and proof edge cases.
 *
 * Policy (maintainer direction 2026-09-21, see
 * `docs/adr/proposals/auction-v4v-participation.md` D9):
 *
 *   payout_legs      = 1 (seller) + scheduled auxiliary entries
 *   fee_reserve_sats = estimated inbound fee + payout_legs x estimated swap fee
 *   minimum_bid_sats = payout_legs x leg_floor_sats + fee_reserve_sats
 *
 * The floor is deliberately **not** proportional to the split: it exists to keep
 * every leg viable, and the excess sats remain with the seller as the residual.
 * The same rule governs rebid deltas, because a rebid locks a new leg.
 *
 * This module is pure: no relay, wallet, Cashu or persistence I/O, and no
 * floating-point arithmetic.
 */

import { AUCTION_MULTIPARTY_SCHEDULE_MAX_ENTRIES } from './multipartySchedule'

/** Default floor for a single payout leg, in sats. */
export const AUCTION_MULTIPARTY_LEG_FLOOR_SATS = 10

export const AUCTION_MULTIPARTY_LEG_FLOOR_ERROR_CODES = [
	'leg_floor_entry_count_invalid',
	'leg_floor_entry_count_exceeds_limit',
	'leg_floor_value_invalid',
	'leg_floor_fee_invalid',
] as const

export type AuctionMultipartyLegFloorErrorCode = (typeof AUCTION_MULTIPARTY_LEG_FLOOR_ERROR_CODES)[number]

export class AuctionMultipartyLegFloorError extends Error {
	readonly code: AuctionMultipartyLegFloorErrorCode

	constructor(code: AuctionMultipartyLegFloorErrorCode, message?: string) {
		super(message ?? code)
		this.name = 'AuctionMultipartyLegFloorError'
		this.code = code
	}
}

const fail = (code: AuctionMultipartyLegFloorErrorCode, message?: string): never => {
	throw new AuctionMultipartyLegFloorError(code, message)
}

const isNonNegativeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const isPositiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

export interface MultipartyLegFloorInput {
	/** Scheduled auxiliary entries, excluding the seller. 0 = single-party. */
	readonly auxiliaryEntryCount: number
	/** Floor applied to each payout leg. Defaults to the policy constant. */
	readonly legFloorSats?: number
	/** One-off cost of bringing funds into the wallet, in sats. */
	readonly estimatedInboundFeeSats?: number
	/** Estimated mint fee for one extra payout output, in sats. */
	readonly estimatedSwapFeeSatsPerPayout?: number
}

export interface MultipartyLegFloor {
	/** Seller plus every scheduled auxiliary entry. */
	readonly payoutLegCount: number
	readonly legFloorSats: number
	/** `payoutLegCount x legFloorSats` — the leg floors alone. */
	readonly floorTotalSats: number
	/** Fee reserve added on top of the floors. */
	readonly feeReserveSats: number
	/** Smallest amount a single bid increment may lock. */
	readonly minimumBidSats: number
}

/**
 * Compute the floor and the resulting minimum bid increment.
 *
 * A single-party auction (`auxiliaryEntryCount === 0`) reduces to one leg, so the
 * result equals the historical per-bid floor and no existing auction changes
 * behaviour.
 */
export const computeMultipartyLegFloor = (input: MultipartyLegFloorInput): MultipartyLegFloor => {
	if (!isNonNegativeInteger(input.auxiliaryEntryCount)) {
		return fail('leg_floor_entry_count_invalid')
	}
	if (input.auxiliaryEntryCount > AUCTION_MULTIPARTY_SCHEDULE_MAX_ENTRIES) {
		return fail('leg_floor_entry_count_exceeds_limit')
	}

	const legFloorSats = input.legFloorSats ?? AUCTION_MULTIPARTY_LEG_FLOOR_SATS
	if (!isPositiveInteger(legFloorSats)) {
		return fail('leg_floor_value_invalid')
	}

	const inboundFeeSats = input.estimatedInboundFeeSats ?? 0
	const swapFeeSatsPerPayout = input.estimatedSwapFeeSatsPerPayout ?? 0
	if (!isNonNegativeInteger(inboundFeeSats) || !isNonNegativeInteger(swapFeeSatsPerPayout)) {
		return fail('leg_floor_fee_invalid')
	}

	const payoutLegCount = 1 + input.auxiliaryEntryCount
	const floorTotalSats = payoutLegCount * legFloorSats
	const feeReserveSats = inboundFeeSats + payoutLegCount * swapFeeSatsPerPayout

	return Object.freeze({
		payoutLegCount,
		legFloorSats,
		floorTotalSats,
		feeReserveSats,
		minimumBidSats: floorTotalSats + feeReserveSats,
	})
}

/**
 * Whether a single locked leg (a bid, or a rebid delta) satisfies the policy.
 *
 * `legLockedAmount` is the amount this specific increment locks, never the
 * cumulative bid value — see the handover's economic semantics for Gate D.
 */
export const isLegLockedAmountAboveFloor = (legLockedAmountSats: number, floor: MultipartyLegFloor): boolean =>
	isNonNegativeInteger(legLockedAmountSats) && legLockedAmountSats >= floor.minimumBidSats

/**
 * Project the floor from a canonical schedule's auxiliary entry count.
 * Kept separate so callers holding a parsed schedule do not re-derive the count.
 */
export const computeMultipartyLegFloorFromSchedule = (
	auxiliaryEntryCount: number,
	options: Omit<MultipartyLegFloorInput, 'auxiliaryEntryCount'> = {},
): MultipartyLegFloor => computeMultipartyLegFloor({ auxiliaryEntryCount, ...options })
