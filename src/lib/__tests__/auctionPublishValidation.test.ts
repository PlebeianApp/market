import { describe, expect, test } from 'bun:test'
import { AUCTION_MIN_DURATION_SECONDS, validateAuctionPublishInput } from '@/lib/auctionPublishValidation'

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
	antiSnipingEnabled: false,
	antiSnipingWindowSeconds: '300',
	antiSnipingExtensionSeconds: '300',
	antiSnipingMaxExtensions: '12',
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

	test('invalid bid increment is rejected', () => {
		expect(() => validate({ bidIncrement: '0' })).toThrow('Bid increment must be greater than 0')
	})

	test('end time at or before max start/current time is rejected', () => {
		expect(() => validate({ startAt: at(NOW_SECONDS + 600), endAt: at(NOW_SECONDS + 600) })).toThrow(
			'Auction end time must be after the start time and current time',
		)
	})

	test('duration under 30 minutes is rejected when a minimum duration is set', () => {
		expect(() => validate({ startAt: '', endAt: at(NOW_SECONDS + AUCTION_MIN_DURATION_SECONDS - 1) })).toThrow(
			'Auction duration must be at least 30 minutes',
		)
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
			antiSnipingEnabled: true,
			antiSnipingWindowSeconds: '0300',
			antiSnipingExtensionSeconds: '0600',
			antiSnipingMaxExtensions: '02',
			imageUrls: ['  https://example.com/auction.png  '],
			shippings: [{ shippingRef: ' 30406:seller:standard ', extraCost: '0005' }],
			trustedMints: ['  https://mint.example  '],
		})

		expect(validated.title).toBe('Auction title')
		expect(validated.description).toBe('Auction description')
		expect(validated.startingBid).toBe(100)
		expect(validated.bidIncrement).toBe(10)
		expect(validated.reserve).toBe(120)
		expect(validated.antiSnipingWindowSeconds).toBe(300)
		expect(validated.antiSnipingExtensionSeconds).toBe(600)
		expect(validated.antiSnipingMaxExtensions).toBe(2)
		expect(validated.imageUrls).toEqual(['https://example.com/auction.png'])
		expect(validated.shippings).toEqual([{ shippingRef: '30406:seller:standard', extraCost: '5' }])
		expect(validated.trustedMints).toEqual(['https://mint.example'])
		expect(validated.maxEndAt).toBe(validated.endAt + 1_200)
	})
})
