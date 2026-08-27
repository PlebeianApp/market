import { describe, test, expect } from 'bun:test'
import { z } from 'zod'
import { getBtcPriceInputSchema, getBtcPriceOutputSchema, getBtcPriceSingleInputSchema, getBtcPriceSingleOutputSchema, walletStateSyncInputSchema, walletStateSyncOutputSchema, walletStateRequestInputSchema, walletStateRequestOutputSchema } from '../../schemas'

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

		describe('walletStateSyncInputSchema', () => {
		const valid = {
			pubkey: 'a'.repeat(64),
			encryptedState: 'nip44:ciphertext:abc123',
			sequence: 0,
		}

		test('accepts valid input', () => {
			const result = parseSchema(walletStateSyncInputSchema, valid)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.data.pubkey).toBe(valid.pubkey)
				expect(result.data.encryptedState).toBe(valid.encryptedState)
				expect(result.data.sequence).toBe(0)
			}
		})

		test('accepts optional version field', () => {
			const result = parseSchema(walletStateSyncInputSchema, { ...valid, version: 3 })
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.data.version).toBe(3)
			}
		})

		test('rejects missing pubkey', () => {
			const { pubkey, ...rest } = valid
			expect(parseSchema(walletStateSyncInputSchema, rest).success).toBe(false)
		})

		test('rejects empty pubkey', () => {
			expect(parseSchema(walletStateSyncInputSchema, { ...valid, pubkey: '' }).success).toBe(false)
		})

		test('rejects missing encryptedState', () => {
			const { encryptedState, ...rest } = valid
			expect(parseSchema(walletStateSyncInputSchema, rest).success).toBe(false)
		})

		test('rejects empty encryptedState', () => {
			expect(parseSchema(walletStateSyncInputSchema, { ...valid, encryptedState: '' }).success).toBe(false)
		})

		test('rejects negative sequence', () => {
			expect(parseSchema(walletStateSyncInputSchema, { ...valid, sequence: -1 }).success).toBe(false)
		})

		test('rejects non-integer sequence', () => {
			expect(parseSchema(walletStateSyncInputSchema, { ...valid, sequence: 1.5 }).success).toBe(false)
		})

		test('rejects negative version', () => {
			expect(parseSchema(walletStateSyncInputSchema, { ...valid, version: -1 }).success).toBe(false)
		})
		})

		describe('walletStateSyncOutputSchema', () => {
		test('accepts valid output', () => {
			const output = {
				pubkey: 'a'.repeat(64),
				version: 1,
				storedAt: Date.now(),
				accepted: true,
			}
			const result = parseSchema(walletStateSyncOutputSchema, output)
			expect(result.success).toBe(true)
		})

		test('rejects missing version', () => {
			const output = {
				pubkey: 'a'.repeat(64),
				storedAt: Date.now(),
				accepted: true,
			}
			expect(parseSchema(walletStateSyncOutputSchema, output).success).toBe(false)
		})

		test('rejects non-boolean accepted', () => {
			const output = {
				pubkey: 'a'.repeat(64),
				version: 1,
				storedAt: Date.now(),
				accepted: 'yes',
			}
			expect(parseSchema(walletStateSyncOutputSchema, output).success).toBe(false)
		})
		})

		describe('walletStateRequestInputSchema', () => {
		test('accepts valid pubkey', () => {
			const result = parseSchema(walletStateRequestInputSchema, { pubkey: 'a'.repeat(64) })
			expect(result.success).toBe(true)
		})

		test('rejects missing pubkey', () => {
			expect(parseSchema(walletStateRequestInputSchema, {}).success).toBe(false)
		})

		test('rejects empty pubkey', () => {
			expect(parseSchema(walletStateRequestInputSchema, { pubkey: '' }).success).toBe(false)
		})
		})

		describe('walletStateRequestOutputSchema', () => {
		test('accepts found output with all fields', () => {
			const output = {
				pubkey: 'a'.repeat(64),
				found: true,
				encryptedState: 'nip44:ciphertext:abc123',
				version: 2,
				sequence: 1,
				storedAt: Date.now(),
			}
			const result = parseSchema(walletStateRequestOutputSchema, output)
			expect(result.success).toBe(true)
		})

		test('accepts not-found output with nulls', () => {
			const output = {
				pubkey: 'a'.repeat(64),
				found: false,
				encryptedState: null,
				version: null,
				sequence: null,
				storedAt: null,
			}
			const result = parseSchema(walletStateRequestOutputSchema, output)
			expect(result.success).toBe(true)
		})

		test('rejects missing found field', () => {
			const output = {
				pubkey: 'a'.repeat(64),
				encryptedState: null,
				version: null,
				sequence: null,
				storedAt: null,
			}
			expect(parseSchema(walletStateRequestOutputSchema, output).success).toBe(false)
		})
		})
})
