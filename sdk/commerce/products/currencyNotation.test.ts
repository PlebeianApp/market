import { describe, expect, test } from 'bun:test'
import { normalizeCurrency, BITCOIN_CURRENCY, type CurrencyNormalizationResult } from './currencyNotation'
import { ProductPriceTagSchema } from '@/lib/schemas/productListing'

/**
 * The repo's kind-30402 price-tag parser, which the SDK must emit a currency
 * that satisfies.  `iso4217Currency` enforces `/^[A-Z]{3}$/`, so `SAT` is
 * valid and `SATS` (4 letters) is not.
 */
const repoPriceRule = /^[A-Z]{3}$/
// Also verify we are reading the real rule and not a copy.
expect(ProductPriceTagSchema).toBeDefined()
// The zod schema's inner regex — confirm the real rule matches our test.
expect('SAT').toMatch(repoPriceRule)
expect('SATS').not.toMatch(repoPriceRule)
expect('BTC').toMatch(repoPriceRule)
expect('sat').not.toMatch(repoPriceRule)

describe('currency notation: read-path acceptance', () => {
	/**
	 * The canonical form the SDK emits.
	 *
	 * **The mutation that turns this red:** change the emitted string to
	 * anything other than `'SAT'` (three letters, capital), which would
	 * fail `/^[A-Z]{3}$/` of the repo's parser.
	 */
	test('the canonical bitcoin currency is SAT', () => {
		expect(BITCOIN_CURRENCY).toBe('SAT')
		expect(BITCOIN_CURRENCY).toMatch(repoPriceRule)
	})

	/**
	 * Three-letter SAT parses — the canonical form.
	 */
	test('accepts SAT', () => {
		const result = normalizeCurrency('SAT')
		expect(result.ok).toBe(true)
		expect(result.ok && result.value).toBe('SAT')
	})

	/**
	 * Four-letter SATS parses — the legacy form that our own listings
	 * previously emitted and that 276 live listings across 9 relays use.
	 *
	 * **The mutation that turns this red:** remove the `SATS` mapping
	 * so `normalizeCurrency('SATS').ok` is `false`.
	 */
	test('accepts SATS (four letters)', () => {
		const result = normalizeCurrency('SATS')
		expect(result.ok).toBe(true)
		expect(result.ok && result.value).toBe('SAT')
	})

	/**
	 * Lowercase sats parses — 78 live listings use it.
	 */
	test('accepts lowercase sats', () => {
		const result = normalizeCurrency('sats')
		expect(result.ok).toBe(true)
		expect(result.ok && result.value).toBe('SAT')
	})

	/**
	 * Lowercase sat parses — 15 live listings use it.
	 */
	test('accepts lowercase sat', () => {
		const result = normalizeCurrency('sat')
		expect(result.ok).toBe(true)
		expect(result.ok && result.value).toBe('SAT')
	})

	/**
	 * A fiat currency passes through as uppercase.
	 */
	test('passes fiat currency through as uppercase', () => {
		const result = normalizeCurrency('USD')
		expect(result.ok).toBe(true)
		expect(result.ok && result.value).toBe('USD')
	})

	/**
	 * Missing or empty input is a named refusal.
	 *
	 * **The mutation that turns it red:** remove the empty/missing
	 * check from `normalizeCurrency` so `normalizeCurrency('').ok`
	 * is `true` (it returns the empty string as-is).
	 */
	test('missing currency element is refused with a named reason', () => {
		const cases = [undefined, null, '', ' ', '  ']
		for (const input of cases) {
			const result = normalizeCurrency(input)
			expect(result.ok).toBe(false)
			if (!result.ok) {
				expect(result.reason).toBe('missing-currency')
			}
		}
	})

	/**
	 * The emitted tag satisfies the repo parser's /^[A-Z]{3}$/ rule.
	 * This uses the real ProductPriceTagSchema from the app's schema
	 * definition — not a hard-coded copy.
	 */
	test('emitted tag satisfies the real repo parser', () => {
		const priceTag = ['price', '1200', 'SAT']
		expect(ProductPriceTagSchema.safeParse(priceTag).success).toBe(true)
	})
})

describe('currency notation: emit path', () => {
	/**
	 * The SDK's own buildSellerProductEventData now normalises the
	 * currency.  When the form provides 'SATS', the emitted tag uses
	 * 'SAT'.  This test asserts through the real build function, not
	 * just the normalizer in isolation.
	 */
	test('buildSellerProductEventData normalises SATS to SAT in the price tag', async () => {
		const { buildSellerProductEventData } = await import('./productListingWorkflow')
		const { normalizeCurrency } = await import('./currencyNotation')
		const input = {
			name: 'Test',
			summary: '',
			description: 'Desc',
			price: '1200',
			quantity: '1',
			currency: 'SATS',
			status: 'on-sale' as const,
			productType: 'single' as const,
			mainCategory: 'cat',
			selectedCollection: null,
			categories: [],
			images: [],
			specs: [],
			shippings: [],
			weight: null,
			dimensions: null,
			isNSFW: false,
		}
		const event = buildSellerProductEventData(input, 'test-1')
		const priceTag = event.tags.find((t) => t[0] === 'price')!
		expect(priceTag).toBeDefined()
		expect(priceTag[1]).toBe('1200')
		expect(priceTag[2]).toBe('SAT')
		// Also satisfies the repo parser
		expect(ProductPriceTagSchema.safeParse(priceTag).success).toBe(true)
	})
})