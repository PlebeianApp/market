import { describe, test, expect } from 'bun:test'
import { z } from 'zod'
import { getBtcPriceInputSchema, getBtcPriceOutputSchema, getBtcPriceSingleInputSchema, getBtcPriceSingleOutputSchema } from '../../schemas'

function parseSchema(schema: Record<string, z.ZodType>, data: unknown) {
	const shape = z.object(schema)
	return shape.safeParse(data)
}

describe('schemas', () => {
	describe('getBtcPriceInputSchema', () => {
		test('defaults refresh to false when omitted', () => {
			const result = parseSchema(getBtcPriceInputSchema, {})
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.data.refresh).toBe(false)
			}
		})

		test('accepts refresh: true', () => {
			const result = parseSchema(getBtcPriceInputSchema, { refresh: true })
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.data.refresh).toBe(true)
			}
		})

		test('accepts refresh: false explicitly', () => {
			const result = parseSchema(getBtcPriceInputSchema, { refresh: false })
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.data.refresh).toBe(false)
			}
		})

		test('accepts empty object', () => {
			const result = parseSchema(getBtcPriceInputSchema, {})
			expect(result.success).toBe(true)
		})
	})

	describe('getBtcPriceOutputSchema', () => {
		test('accepts valid output with all fields', () => {
			const output = {
				rates: { USD: 100000, EUR: 92000 },
				sourcesSucceeded: ['yadio', 'coingecko'],
				sourcesFailed: [],
				fetchedAt: Date.now(),
				cached: false,
			}
			const result = parseSchema(getBtcPriceOutputSchema, output)
			expect(result.success).toBe(true)
		})

		test('rejects missing rates field', () => {
			const output = {
				sourcesSucceeded: ['yadio'],
				sourcesFailed: [],
				fetchedAt: Date.now(),
				cached: false,
			}
			const result = parseSchema(getBtcPriceOutputSchema, output)
			expect(result.success).toBe(false)
		})

		test('rejects invalid rates type (string instead of record)', () => {
			const output = {
				rates: 'invalid',
				sourcesSucceeded: ['yadio'],
				sourcesFailed: [],
				fetchedAt: Date.now(),
				cached: false,
			}
			const result = parseSchema(getBtcPriceOutputSchema, output)
			expect(result.success).toBe(false)
		})

		test('rejects non-boolean cached field', () => {
			const output = {
				rates: { USD: 100000 },
				sourcesSucceeded: ['yadio'],
				sourcesFailed: [],
				fetchedAt: Date.now(),
				cached: 'yes',
			}
			const result = parseSchema(getBtcPriceOutputSchema, output)
			expect(result.success).toBe(false)
		})
	})

	describe('getBtcPriceSingleInputSchema', () => {
		test('accepts valid currency input', () => {
			const result = parseSchema(getBtcPriceSingleInputSchema, { currency: 'USD' })
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.data.currency).toBe('USD')
				expect(result.data.refresh).toBe(false)
			}
		})

		test('accepts currency with refresh: true', () => {
			const result = parseSchema(getBtcPriceSingleInputSchema, { currency: 'EUR', refresh: true })
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.data.currency).toBe('EUR')
				expect(result.data.refresh).toBe(true)
			}
		})

		test('rejects missing currency field', () => {
			const result = parseSchema(getBtcPriceSingleInputSchema, {})
			expect(result.success).toBe(false)
		})

		test('rejects non-string currency', () => {
			const result = parseSchema(getBtcPriceSingleInputSchema, { currency: 123 })
			expect(result.success).toBe(false)
		})
	})

	describe('getBtcPriceSingleOutputSchema', () => {
		test('accepts valid single currency output', () => {
			const output = {
				currency: 'USD',
				rate: 100000,
				fetchedAt: Date.now(),
				cached: false,
			}
			const result = parseSchema(getBtcPriceSingleOutputSchema, output)
			expect(result.success).toBe(true)
		})

		test('rejects missing rate field', () => {
			const output = {
				currency: 'USD',
				fetchedAt: Date.now(),
				cached: false,
			}
			const result = parseSchema(getBtcPriceSingleOutputSchema, output)
			expect(result.success).toBe(false)
		})

		test('rejects non-number rate', () => {
			const output = {
				currency: 'USD',
				rate: 'expensive',
				fetchedAt: Date.now(),
				cached: false,
			}
			const result = parseSchema(getBtcPriceSingleOutputSchema, output)
			expect(result.success).toBe(false)
		})
	})
})
