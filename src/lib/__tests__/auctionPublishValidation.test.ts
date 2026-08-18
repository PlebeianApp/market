import { describe, expect, test } from 'bun:test'
import { AUCTION_MIN_DURATION_SECONDS, validateAuctionPublishInput } from '@/lib/auctionPublishValidation'
import { AUCTION_MIN_BID_LEG_SATS, AUCTION_MIN_BID_SATS } from '@/lib/auction/constants'

const NOW_SECONDS = 1_800_000_000

const at = (seconds: number): string => new Date(seconds * 1000).toISOString()

const baseInput = {
	title: 'Auction title',
	summary: 'Short summary',
	description: 'Auction description',
	startingBid: '100',
	bidIncrement: '10',
	reserve: '100',
	startAt: at(NOW_SECONDS + 60),
	endAt: at(NOW_SECONDS + 3_600),
	antiSnipeWindowMinutes: 0 as number,
	minBidCurveShape: 'none' as 'none' | 'linear' | 'exponential',
	minBidCurvePeakMultiplier: 2 as number,
	settlementGracePreset: '1h' as '5min' | '1h' | '3h',
	imageUrls: ['https://example.com/auction.png'],
	shippings: [{ shippingRef: '30406:seller:standard', extraCost: '' }],
	trustedMints: ['https://mint.example'],
}

const validate = (input: Partial<typeof baseInput> = {}) =>
	validateAuctionPublishInput(
		{
			...baseInput,
			...input,
		},
		{ nowSeconds: NOW_SECONDS, minDurationSeconds: AUCTION_MIN_DURATION_SECONDS },
	)

describe('auction publish validation', () => {
	test('reserve lower than starting bid is rejected', () => {
		expect(() => validate({ reserve: '99' })).toThrow('Reserve must be greater than or equal to the starting bid')
	})

	test('starting bid below auction minimum is rejected', () => {
		expect(() => validate({ startingBid: String(AUCTION_MIN_BID_SATS - 1) })).toThrow(
			`Starting bid must be at least ${AUCTION_MIN_BID_SATS} sats`,
		)
	})

	test('bid increment below bid-leg minimum is rejected', () => {
		expect(() => validate({ bidIncrement: String(AUCTION_MIN_BID_LEG_SATS - 1) })).toThrow(
			`Bid increment must be at least ${AUCTION_MIN_BID_LEG_SATS} sats`,
		)
	})

	test('end time at or before max start/current time is rejected', () => {
		expect(() => validate({ startAt: at(NOW_SECONDS + 600), endAt: at(NOW_SECONDS + 600) })).toThrow(
			'Auction end time must be after the start time and current time',
		)
	})

	test('duration under the configured minimum is rejected', () => {
		// Asserts against the message the validator builds from
		// `AUCTION_MIN_DURATION_SECONDS` rather than a hard-coded "30
		// minutes" string — the constant was lowered from 30 min to 1
		// min in commit a15f7934, and the test silently flipped from
		// "passes" to "fails on stale message". Tracking the constant
		// here keeps this test in sync with future tweaks too.
		const minMinutes = AUCTION_MIN_DURATION_SECONDS / 60
		const expectedMessage = `Auction duration must be at least ${minMinutes} minute${minMinutes === 1 ? '' : 's'}`
		expect(() => validate({ startAt: '', endAt: at(NOW_SECONDS + AUCTION_MIN_DURATION_SECONDS - 1) })).toThrow(expectedMessage)
	})

	test('negative shipping extra cost is rejected', () => {
		expect(() => validate({ shippings: [{ shippingRef: '30406:seller:standard', extraCost: '-1' }] })).toThrow(
			'Shipping extra cost must be an integer greater than or equal to 0',
		)
	})

	test('duplicate shipping refs are deduped with first occurrence winning', () => {
		const validated = validate({
			shippings: [
				{ shippingRef: '30406:seller:standard', extraCost: '5' },
				{ shippingRef: '30406:seller:standard', extraCost: '10' },
				{ shippingRef: '30406:seller:pickup', extraCost: '' },
			],
		})

		expect(validated.shippings).toEqual([
			{ shippingRef: '30406:seller:standard', extraCost: '5' },
			{ shippingRef: '30406:seller:pickup', extraCost: '' },
		])
	})

	test('valid input returns normalized values', () => {
		const validated = validate({
			title: '  Auction title  ',
			description: '  Auction description  ',
			startingBid: '00100',
			bidIncrement: '0010',
			reserve: '00120',
			antiSnipeWindowMinutes: 15,
			minBidCurveShape: 'exponential',
			minBidCurvePeakMultiplier: 5,
			settlementGracePreset: '1h',
			imageUrls: ['  https://example.com/auction.png  '],
			shippings: [{ shippingRef: ' 30406:seller:standard ', extraCost: '0005' }],
			trustedMints: ['  https://mint.example  '],
		})

		expect(validated.title).toBe('Auction title')
		expect(validated.description).toBe('Auction description')
		expect(validated.startingBid).toBe(100)
		expect(validated.bidIncrement).toBe(10)
		expect(validated.reserve).toBe(120)
		expect(validated.antiSnipeWindowSeconds).toBe(15 * 60)
		expect(validated.minBidCurveShape).toBe('exponential')
		expect(validated.minBidCurvePeakMultiplier).toBe(5)
		expect(validated.settlementGracePreset).toBe('1h')
		expect(validated.imageUrls).toEqual(['https://example.com/auction.png'])
		expect(validated.shippings).toEqual([{ shippingRef: '30406:seller:standard', extraCost: '5' }])
		expect(validated.trustedMints).toEqual(['https://mint.example'])
		expect(validated.maxEndAt).toBe(validated.endAt + 15 * 60)
	})
})
