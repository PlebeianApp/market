import { describe, expect, test } from 'bun:test'
import {
	AUCTION_MULTIPARTY_MAX_GROSS_SATS,
	AuctionMultipartyAllocatorError,
	allocateMultipartySats,
	type AuctionMultipartySatAllocation,
} from '../auction/multipartyAllocator'
import {
	compileSourceSchedule,
	type AuctionMultipartyCanonicalSchedule,
	type AuctionMultipartySourceScheduleEntry,
} from '../auction/multipartySchedule'

const validatorEntry = (allocationBps: number): AuctionMultipartySourceScheduleEntry => ({
	role: 'validator',
	recipient_pubkey: '11'.repeat(32),
	payout_capability_event_id: '33'.repeat(32),
	allocation_bps: allocationBps,
	validator_offer_event_id: '44'.repeat(32),
})

const v4vEntry = (
	allocationBps: number,
	recipient = '22'.repeat(32),
	capability = '55'.repeat(32),
): AuctionMultipartySourceScheduleEntry => ({
	role: 'v4v',
	recipient_pubkey: recipient,
	payout_capability_event_id: capability,
	allocation_bps: allocationBps,
})

const scheduleFrom = (entries: AuctionMultipartySourceScheduleEntry[]): AuctionMultipartyCanonicalSchedule => compileSourceSchedule(entries)

const totalAllocated = (allocation: AuctionMultipartySatAllocation): bigint =>
	allocation.seller_sats + allocation.auxiliary.reduce((sum, entry) => sum + entry.sats, 0n)

const expectAllocatorError = (expectedCode: string, operation: () => unknown): void => {
	try {
		operation()
		throw new Error(`Expected ${expectedCode}, but operation succeeded`)
	} catch (error) {
		expect(error).toBeInstanceOf(AuctionMultipartyAllocatorError)
		expect((error as AuctionMultipartyAllocatorError).code).toBe(expectedCode)
	}
}

describe('Auction Multiparty deterministic sat allocator', () => {
	test('preserves the 1024-sat seller-validator-V4V regression vector', () => {
		const schedule = scheduleFrom([v4vEntry(313), validatorEntry(625)])

		expect(schedule.entries.map((entry) => entry.allocation_bps)).toEqual([625, 313])
		expect(schedule.seller_remainder_bps).toBe(9062)

		const allocation = allocateMultipartySats(1024n, schedule)

		expect(allocation.auxiliary).toEqual([
			{ schedule_index: 0, sats: 64n },
			{ schedule_index: 1, sats: 32n },
		])
		expect(allocation.seller_sats).toBe(928n)
		expect(totalAllocated(allocation)).toBe(1024n)
	})

	test('one complete 10000-sat cycle exactly equals the BPS weights', () => {
		const schedule = scheduleFrom([validatorEntry(625), v4vEntry(313)])
		const allocation = allocateMultipartySats(10_000n, schedule)

		expect(allocation.auxiliary[0].sats).toBe(625n)
		expect(allocation.auxiliary[1].sats).toBe(313n)
		expect(allocation.seller_sats).toBe(9062n)
		expect(totalAllocated(allocation)).toBe(10_000n)
	})

	test('source ordering cannot change the allocation', () => {
		const first = scheduleFrom([validatorEntry(625), v4vEntry(313)])
		const second = scheduleFrom([v4vEntry(313), validatorEntry(625)])

		expect(first.entries).toEqual(second.entries)

		expect(allocateMultipartySats(9876n, first)).toEqual(allocateMultipartySats(9876n, second))
	})

	test('exact auxiliary-versus-seller ties prefer the auxiliary schedule entry', () => {
		const schedule = scheduleFrom([v4vEntry(5000)])

		const one = allocateMultipartySats(1n, schedule)
		expect(one.auxiliary[0].sats).toBe(1n)
		expect(one.seller_sats).toBe(0n)

		const two = allocateMultipartySats(2n, schedule)
		expect(two.auxiliary[0].sats).toBe(1n)
		expect(two.seller_sats).toBe(1n)
	})

	test('exact auxiliary ties prefer lower canonical schedule_index', () => {
		const lowerPubkey = '22'.repeat(32)
		const higherPubkey = '66'.repeat(32)

		const schedule = scheduleFrom([v4vEntry(5000, higherPubkey, '77'.repeat(32)), v4vEntry(5000, lowerPubkey, '55'.repeat(32))])

		expect(schedule.entries[0].recipient_pubkey).toBe(lowerPubkey)
		expect(schedule.entries[1].recipient_pubkey).toBe(higherPubkey)

		const allocation = allocateMultipartySats(1n, schedule)

		expect(allocation.auxiliary[0].sats).toBe(1n)
		expect(allocation.auxiliary[1].sats).toBe(0n)
		expect(allocation.seller_sats).toBe(0n)
	})

	test('zero-BPS validators remain contracted but never receive sats', () => {
		const schedule = scheduleFrom([validatorEntry(0)])

		for (const gross of [0n, 1n, 17n, 9999n, 10_000n, 123_456n]) {
			const allocation = allocateMultipartySats(gross, schedule)

			expect(allocation.auxiliary[0].sats).toBe(0n)
			expect(allocation.seller_sats).toBe(gross)
		}
	})

	test('exact 10000 auxiliary BPS leaves seller at zero', () => {
		const schedule = scheduleFrom([v4vEntry(10_000)])

		for (const gross of [0n, 1n, 1024n, 9999n, 10_000n, 123_456n]) {
			const allocation = allocateMultipartySats(gross, schedule)

			expect(allocation.auxiliary[0].sats).toBe(gross)
			expect(allocation.seller_sats).toBe(0n)
		}
	})

	test('implements exact 10000-period decomposition', () => {
		const schedule = scheduleFrom([validatorEntry(625), v4vEntry(313)])

		for (const gross of [0n, 1n, 9999n, 10_000n, 10_001n, 1_000_123n, 12_345_678_901_234n]) {
			const q = gross / 10_000n
			const r = gross % 10_000n

			const full = allocateMultipartySats(gross, schedule)
			const prefix = allocateMultipartySats(r, schedule)

			for (let index = 0; index < schedule.entries.length; index++) {
				expect(full.auxiliary[index].sats).toBe(q * BigInt(schedule.entries[index].allocation_bps) + prefix.auxiliary[index].sats)
			}

			expect(full.seller_sats).toBe(q * BigInt(schedule.seller_remainder_bps) + prefix.seller_sats)
		}
	})

	test('is conservative, monotone, and quota-bounded over exhaustive small G', () => {
		const schedules = [
			scheduleFrom([validatorEntry(625), v4vEntry(313)]),
			scheduleFrom([v4vEntry(5000)]),
			scheduleFrom([validatorEntry(0)]),
		]

		for (const schedule of schedules) {
			let previous = allocateMultipartySats(0n, schedule)

			for (let gross = 0n; gross <= 1000n; gross += 1n) {
				const allocation = allocateMultipartySats(gross, schedule)

				expect(totalAllocated(allocation)).toBe(gross)

				const weights = [...schedule.entries.map((entry) => BigInt(entry.allocation_bps)), BigInt(schedule.seller_remainder_bps)]

				const amounts = [...allocation.auxiliary.map((entry) => entry.sats), allocation.seller_sats]

				for (let index = 0; index < weights.length; index++) {
					const floorQuota = (gross * weights[index]) / 10_000n
					const ceilQuota = (gross * weights[index] + 9999n) / 10_000n

					expect(amounts[index] >= floorQuota).toBe(true)
					expect(amounts[index] <= ceilQuota).toBe(true)
				}

				if (gross > 0n) {
					for (let index = 0; index < allocation.auxiliary.length; index++) {
						expect(allocation.auxiliary[index].sats >= previous.auxiliary[index].sats).toBe(true)
					}

					expect(allocation.seller_sats >= previous.seller_sats).toBe(true)
				}

				previous = allocation
			}
		}
	})

	test('accepts the Demo-V1 maximum gross sat bound without precision loss', () => {
		const schedule = scheduleFrom([validatorEntry(625), v4vEntry(313)])
		const allocation = allocateMultipartySats(AUCTION_MULTIPARTY_MAX_GROSS_SATS, schedule)

		expect(totalAllocated(allocation)).toBe(AUCTION_MULTIPARTY_MAX_GROSS_SATS)

		expect(allocation.auxiliary[0].sats).toBe((AUCTION_MULTIPARTY_MAX_GROSS_SATS / 10_000n) * 625n)
		expect(allocation.auxiliary[1].sats).toBe((AUCTION_MULTIPARTY_MAX_GROSS_SATS / 10_000n) * 313n)
		expect(allocation.seller_sats).toBe((AUCTION_MULTIPARTY_MAX_GROSS_SATS / 10_000n) * 9062n)
	})

	test('rejects non-BigInt, negative, and above-bound gross amounts', () => {
		const schedule = scheduleFrom([v4vEntry(5000)])

		expectAllocatorError('allocator_gross_not_bigint', () => allocateMultipartySats(1 as unknown as bigint, schedule))

		expectAllocatorError('allocator_gross_out_of_range', () => allocateMultipartySats(-1n, schedule))

		expectAllocatorError('allocator_gross_out_of_range', () => allocateMultipartySats(AUCTION_MULTIPARTY_MAX_GROSS_SATS + 1n, schedule))
	})

	test('fails closed when arithmetic schedule invariants are corrupted', () => {
		const schedule = scheduleFrom([validatorEntry(625), v4vEntry(313)])

		expectAllocatorError('allocator_schedule_invalid', () =>
			allocateMultipartySats(1024n, {
				entries: schedule.entries,
				seller_remainder_bps: schedule.seller_remainder_bps + 1,
			}),
		)

		expectAllocatorError('allocator_schedule_invalid', () =>
			allocateMultipartySats(1024n, {
				entries: schedule.entries.map((entry, index) => ({
					...entry,
					schedule_index: index + 1,
				})),
				seller_remainder_bps: schedule.seller_remainder_bps,
			}),
		)
	})
})
