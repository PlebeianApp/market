import { AUCTION_MULTIPARTY_SCHEDULE_MAX_ENTRIES, type AuctionMultipartyCanonicalSchedule } from './multipartySchedule'

export const AUCTION_MULTIPARTY_TOTAL_BPS = 10_000n

// Demo-V1 bound: the maximum nominal Bitcoin supply expressed in satoshis.
export const AUCTION_MULTIPARTY_MAX_GROSS_SATS = 2_100_000_000_000_000n

export type AuctionMultipartyAllocationSchedule = Pick<AuctionMultipartyCanonicalSchedule, 'entries' | 'seller_remainder_bps'>

export interface AuctionMultipartySatAllocationEntry {
	schedule_index: number
	sats: bigint
}

export interface AuctionMultipartySatAllocation {
	gross_sats: bigint
	auxiliary: AuctionMultipartySatAllocationEntry[]
	seller_sats: bigint
}

export class AuctionMultipartyAllocatorError extends Error {
	readonly code: string

	constructor(code: string) {
		super(code)
		this.name = 'AuctionMultipartyAllocatorError'
		this.code = code
	}
}

const fail = (code: string): never => {
	throw new AuctionMultipartyAllocatorError(code)
}

/**
 * Gate B consumes a Gate-A canonical schedule.
 *
 * Identity and wire canonicalization remain Gate A's responsibility.
 * This layer revalidates only the arithmetic shape required to make
 * sat allocation fail closed if an accidental malformed object crosses
 * the layer boundary.
 */
const validateArithmeticSchedule = (schedule: AuctionMultipartyAllocationSchedule): void => {
	if (schedule.entries.length === 0 || schedule.entries.length > AUCTION_MULTIPARTY_SCHEDULE_MAX_ENTRIES) {
		fail('allocator_schedule_invalid')
	}

	let auxiliaryBps = 0

	for (let index = 0; index < schedule.entries.length; index++) {
		const entry = schedule.entries[index]

		if (
			entry.schedule_index !== index ||
			!Number.isInteger(entry.allocation_bps) ||
			entry.allocation_bps < 0 ||
			entry.allocation_bps > 10_000
		) {
			fail('allocator_schedule_invalid')
		}

		auxiliaryBps += entry.allocation_bps
	}

	if (
		!Number.isInteger(schedule.seller_remainder_bps) ||
		schedule.seller_remainder_bps < 0 ||
		schedule.seller_remainder_bps > 10_000 ||
		auxiliaryBps + schedule.seller_remainder_bps !== 10_000
	) {
		fail('allocator_schedule_invalid')
	}
}

/**
 * Allocate the first r sats of one 10,000-sat allocation cycle.
 *
 * Tie rank is intentionally the vector order:
 * canonical schedule_index order first, then seller last.
 *
 * No floating-point arithmetic is used.
 */
const allocateCyclePrefix = (weights: readonly bigint[], remainder: bigint): bigint[] => {
	const allocated = weights.map(() => 0n)

	for (let h = 1n; h <= remainder; h += 1n) {
		let bestIndex = -1

		for (let index = 0; index < weights.length; index++) {
			const weight = weights[index]

			if (weight === 0n) continue

			// Eligible iff a_i * 10000 < h * w_i.
			if (allocated[index] * AUCTION_MULTIPARTY_TOTAL_BPS >= h * weight) {
				continue
			}

			if (bestIndex === -1) {
				bestIndex = index
				continue
			}

			// Compare:
			//
			//     w_i / (a_i + 1)
			//
			// without division or floating point:
			//
			//     w_i * (a_best + 1)
			//       >
			//     w_best * (a_i + 1)
			//
			// Equality deliberately keeps the existing bestIndex,
			// implementing canonical schedule-index order then seller.
			const candidateLeft = weight * (allocated[bestIndex] + 1n)
			const bestRight = weights[bestIndex] * (allocated[index] + 1n)

			if (candidateLeft > bestRight) {
				bestIndex = index
			}
		}

		if (bestIndex === -1) {
			fail('allocator_internal_no_eligible_recipient')
		}

		allocated[bestIndex] += 1n
	}

	return allocated
}

export const allocateMultipartySats = (
	grossSats: bigint,
	schedule: AuctionMultipartyAllocationSchedule,
): AuctionMultipartySatAllocation => {
	if (typeof grossSats !== 'bigint') {
		fail('allocator_gross_not_bigint')
	}

	if (grossSats < 0n || grossSats > AUCTION_MULTIPARTY_MAX_GROSS_SATS) {
		fail('allocator_gross_out_of_range')
	}

	validateArithmeticSchedule(schedule)

	// Vector order is the Demo-V1 deterministic tie rank:
	// schedule_index 0..N-1, then seller.
	const weights = [...schedule.entries.map((entry) => BigInt(entry.allocation_bps)), BigInt(schedule.seller_remainder_bps)]

	const completeCycles = grossSats / AUCTION_MULTIPARTY_TOTAL_BPS
	const remainder = grossSats % AUCTION_MULTIPARTY_TOTAL_BPS

	const prefixAllocation = allocateCyclePrefix(weights, remainder)

	const finalAllocation = weights.map((weight, index) => completeCycles * weight + prefixAllocation[index])

	const sellerIndex = finalAllocation.length - 1

	const auxiliary = schedule.entries.map((entry, index) => ({
		schedule_index: entry.schedule_index,
		sats: finalAllocation[index],
	}))

	const sellerSats = finalAllocation[sellerIndex]

	const conserved = auxiliary.reduce((sum, entry) => sum + entry.sats, sellerSats)
	if (conserved !== grossSats) {
		fail('allocator_internal_conservation_failure')
	}

	return {
		gross_sats: grossSats,
		auxiliary,
		seller_sats: sellerSats,
	}
}
