import { describe, expect, it } from 'bun:test'
import {
	APP_AUCTION_DLEQ_ROLLOUT_START_AT,
	DEFAULT_DLEQ_ROLLOUT_START_AT,
	requiresDleqForAuction,
	resolveDleqRolloutStartAt,
} from '../auction/constants'

describe('DLEQ rollout boundary (ADR-0011 Decision 7)', () => {
	const boundary = APP_AUCTION_DLEQ_ROLLOUT_START_AT

	it('default boundary is a positive whole number of seconds (0 would break grandfathering)', () => {
		expect(DEFAULT_DLEQ_ROLLOUT_START_AT).toBeGreaterThan(0)
		expect(Number.isInteger(DEFAULT_DLEQ_ROLLOUT_START_AT)).toBe(true)
	})

	describe('resolveDleqRolloutStartAt (fail-closed)', () => {
		it('returns the default when the env value is unset', () => {
			expect(resolveDleqRolloutStartAt(undefined)).toBe(DEFAULT_DLEQ_ROLLOUT_START_AT)
		})

		it('returns the default when the env value is empty', () => {
			expect(resolveDleqRolloutStartAt('')).toBe(DEFAULT_DLEQ_ROLLOUT_START_AT)
		})

		it('returns the default when the env value is whitespace-only (must not coerce to 0)', () => {
			expect(resolveDleqRolloutStartAt('   ')).toBe(DEFAULT_DLEQ_ROLLOUT_START_AT)
			expect(resolveDleqRolloutStartAt('\t\n')).toBe(DEFAULT_DLEQ_ROLLOUT_START_AT)
		})

		it('returns the default when the env value is non-numeric', () => {
			expect(resolveDleqRolloutStartAt('not-a-number')).toBe(DEFAULT_DLEQ_ROLLOUT_START_AT)
		})

		it('returns the default for hex (must not coerce to a past epoch)', () => {
			expect(resolveDleqRolloutStartAt('0x12AB')).toBe(DEFAULT_DLEQ_ROLLOUT_START_AT)
		})

		it('returns the default for fractional values', () => {
			expect(resolveDleqRolloutStartAt('1788825600.9')).toBe(DEFAULT_DLEQ_ROLLOUT_START_AT)
		})

		it('returns the default for scientific notation', () => {
			expect(resolveDleqRolloutStartAt('1.79e9')).toBe(DEFAULT_DLEQ_ROLLOUT_START_AT)
		})

		it('returns the default when the env value is negative', () => {
			expect(resolveDleqRolloutStartAt('-123')).toBe(DEFAULT_DLEQ_ROLLOUT_START_AT)
		})

		it('respects an explicit 0 (immediate rollout)', () => {
			expect(resolveDleqRolloutStartAt('0')).toBe(0)
		})

		it('parses a canonical digits-only env value as epoch seconds', () => {
			expect(resolveDleqRolloutStartAt('1788825600')).toBe(1788825600)
		})
	})

	describe('requiresDleqForAuction', () => {
		it('grandfathers auctions starting before the rollout boundary', () => {
			expect(requiresDleqForAuction(boundary - 1)).toBe(false)
		})

		it('requires DLEQ for auctions starting exactly at the boundary', () => {
			expect(requiresDleqForAuction(boundary)).toBe(true)
		})

		it('requires DLEQ for auctions starting after the boundary', () => {
			expect(requiresDleqForAuction(boundary + 1)).toBe(true)
		})

		it('grandfathers a start_at of 0 (unset / epoch 0 sentinel)', () => {
			expect(requiresDleqForAuction(0)).toBe(false)
		})

		it('is monotonic and inclusive across the boundary', () => {
			expect(requiresDleqForAuction(boundary - 1)).toBe(false)
			expect(requiresDleqForAuction(boundary)).toBe(true)
			expect(requiresDleqForAuction(boundary + 1)).toBe(true)
		})
	})
})
