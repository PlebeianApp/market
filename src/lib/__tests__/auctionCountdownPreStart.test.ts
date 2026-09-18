import { describe, expect, test } from 'bun:test'
import { formatAuctionStartsIn } from '../auctionCountdownLabels'
import { computePreStartProgress } from '@/components/AuctionCountdown'

// ---------------------------------------------------------------------------
// formatAuctionStartsIn
// ---------------------------------------------------------------------------

describe('formatAuctionStartsIn', () => {
	test('zero or negative seconds → "Starting now"', () => {
		expect(formatAuctionStartsIn(0)).toBe('Starting now')
		expect(formatAuctionStartsIn(-5)).toBe('Starting now')
	})

	test('under 60 seconds → singular and plural second labels', () => {
		expect(formatAuctionStartsIn(1)).toBe('Starts in 1s')
		expect(formatAuctionStartsIn(59)).toBe('Starts in 59s')
	})

	test('under 1 hour → MM:SS format', () => {
		expect(formatAuctionStartsIn(65)).toBe('Starts in 01:05')
		expect(formatAuctionStartsIn(3599)).toBe('Starts in 59:59')
	})

	test('under 1 day → X Hour(s) MM:SS format', () => {
		expect(formatAuctionStartsIn(3600)).toBe('Starts in 1 Hour 00:00')
		expect(formatAuctionStartsIn(7325)).toBe('Starts in 2 Hours 02:05')
		expect(formatAuctionStartsIn(86399)).toBe('Starts in 23 Hours 59:59')
	})

	test('1 day or more → X Day(s) Y Hour(s) MM:SS format', () => {
		expect(formatAuctionStartsIn(86400)).toBe('Starts in 1 Day 0 Hours 00:00')
		expect(formatAuctionStartsIn(90000)).toBe('Starts in 1 Day 1 Hour 00:00')
		expect(formatAuctionStartsIn(172800)).toBe('Starts in 2 Days 0 Hours 00:00')
		expect(formatAuctionStartsIn(180065)).toBe('Starts in 2 Days 2 Hours 01:05')
	})
})

// ---------------------------------------------------------------------------
// computePreStartProgress
// ---------------------------------------------------------------------------

describe('computePreStartProgress', () => {
	test('returns 0 when startAt is 0 (no scheduled start)', () => {
		expect(computePreStartProgress(1_000_100, 0, 1_000_000)).toBe(0)
	})

	test('returns 0 when createdAt is 0 (missing creation time)', () => {
		expect(computePreStartProgress(1_000_100, 1_001_000, 0)).toBe(0)
	})

	test('returns 0 when now is at or before createdAt', () => {
		expect(computePreStartProgress(1_000_000, 1_001_000, 1_000_000)).toBe(0)
		expect(computePreStartProgress(999_999, 1_001_000, 1_000_000)).toBe(0)
	})

	test('returns 1 when now has reached or passed startAt', () => {
		expect(computePreStartProgress(1_001_000, 1_001_000, 1_000_000)).toBe(1)
		expect(computePreStartProgress(1_002_000, 1_001_000, 1_000_000)).toBe(1)
	})

	test('returns fractional progress between createdAt and startAt', () => {
		// total wait = 1000s, elapsed = 500s → 50%
		const result = computePreStartProgress(1_000_500, 1_001_000, 1_000_000)
		expect(result).toBeCloseTo(0.5)
	})

	test('returns near-zero when auction was just published', () => {
		// total wait = 86400s, elapsed = 1s → ~0.001%
		const result = computePreStartProgress(1_000_001, 1_086_400, 1_000_000)
		expect(result).toBeCloseTo(1 / 86400)
	})

	test('returns near-full when only seconds remain before start', () => {
		// total wait = 3600s, elapsed = 3599s → ~99.97%
		const result = computePreStartProgress(1_003_599, 1_003_600, 1_000_000)
		expect(result).toBeCloseTo(3599 / 3600)
	})

	test('is always clamped to [0, 1]', () => {
		// all edge variants
		const cases: [number, number, number][] = [
			[0, 100, 50], // now before createdAt
			[200, 100, 50], // now past startAt
			[75, 100, 50], // normal midpoint
		]
		for (const [now, startAt, createdAt] of cases) {
			const result = computePreStartProgress(now, startAt, createdAt)
			expect(result).toBeGreaterThanOrEqual(0)
			expect(result).toBeLessThanOrEqual(1)
		}
	})
})
