import { describe, expect, test } from 'bun:test'
import { formatAuctionCountdownDetailed, formatAuctionTimeLeft, getAuctionCountdownLabels } from '../auctionCountdownLabels'

describe('auction countdown labels', () => {
	test('ended countdowns render an explicit label instead of a placeholder', () => {
		const labels = getAuctionCountdownLabels(1_700_000_000, 1_700_000_001, { showSeconds: true })

		expect(labels.isEnded).toBe(true)
		expect(labels.displayLabel).toBe('Ended')
		expect(labels.detailedLabel).toBe('Ended')
		expect(formatAuctionCountdownDetailed(0)).toBe('Ended')
	})

	test('live countdowns keep the detailed compact label', () => {
		const labels = getAuctionCountdownLabels(1_700_000_065, 1_700_000_000, { showSeconds: true })

		expect(labels.isEnded).toBe(false)
		expect(labels.displayLabel).toBe('01:05')
		expect(labels.detailedLabel).toBe('01:05')
	})

	test('non-compact display labels use a human-readable time left', () => {
		const labels = getAuctionCountdownLabels(1_700_000_125, 1_700_000_000)

		expect(labels.displayLabel).toBe('2 minutes left')
		expect(formatAuctionTimeLeft(1)).toBe('1 second left')
	})

	test('missing end time renders no end date', () => {
		const labels = getAuctionCountdownLabels(0, 1_700_000_000, { showSeconds: true })

		expect(labels.isEnded).toBe(false)
		expect(labels.displayLabel).toBe('No end date')
		expect(labels.detailedLabel).toBe('No end date')
		expect(labels.absoluteLabel).toBe('No end date')
	})
})
