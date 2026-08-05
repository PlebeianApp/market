import { describe, expect, test } from 'bun:test'
import { fetchUserPaymentDetails, fetchProductPaymentDetails } from '../payment'
import { authorQueryOptions } from '../authors'
import { collectionsByPubkeyQueryOptions } from '../collections'
import { shippingOptionsByPubkeyQueryOptions } from '../shipping'

const VALID_PUBKEY = 'a'.repeat(64)

describe('payment fetcher guards (zero relay I/O for invalid identity)', () => {
	test('fetchUserPaymentDetails returns [] for empty pubkey without touching NDK', async () => {
		const result = await fetchUserPaymentDetails('')
		expect(result).toEqual([])
	})

	test('fetchUserPaymentDetails returns [] for malformed pubkey without touching NDK', async () => {
		const result = await fetchUserPaymentDetails('not-hex')
		expect(result).toEqual([])
	})

	test('fetchUserPaymentDetails returns [] for whitespace pubkey without touching NDK', async () => {
		const result = await fetchUserPaymentDetails('   ')
		expect(result).toEqual([])
	})

	test('fetchProductPaymentDetails returns [] for malformed optional pubkey without touching NDK', async () => {
		const result = await fetchProductPaymentDetails('30402:abc:not-hex', 'not-hex')
		expect(result).toEqual([])
	})

	test('fetchProductPaymentDetails returns [] for empty optional pubkey without touching NDK', async () => {
		const result = await fetchProductPaymentDetails('30402:abc:test', '')
		expect(result).toEqual([])
	})
})

describe('identity-scoped query options disable for invalid input', () => {
	test('authorQueryOptions disables for malformed pubkey', () => {
		expect(authorQueryOptions('').enabled).toBe(false)
		expect(authorQueryOptions('not-hex').enabled).toBe(false)
		expect(authorQueryOptions('abc').enabled).toBe(false)
	})

	test('authorQueryOptions enables for valid hex pubkey', () => {
		expect(authorQueryOptions(VALID_PUBKEY).enabled).toBe(true)
	})

	test('collectionsByPubkeyQueryOptions disables for malformed pubkey', () => {
		expect(collectionsByPubkeyQueryOptions('').enabled).toBe(false)
		expect(collectionsByPubkeyQueryOptions('not-hex').enabled).toBe(false)
	})

	test('collectionsByPubkeyQueryOptions enables for valid hex pubkey', () => {
		expect(collectionsByPubkeyQueryOptions(VALID_PUBKEY).enabled).toBe(true)
	})

	test('shippingOptionsByPubkeyQueryOptions disables for malformed pubkey', () => {
		expect(shippingOptionsByPubkeyQueryOptions('').enabled).toBe(false)
		expect(shippingOptionsByPubkeyQueryOptions('not-hex').enabled).toBe(false)
	})

	test('shippingOptionsByPubkeyQueryOptions enables for valid hex pubkey', () => {
		expect(shippingOptionsByPubkeyQueryOptions(VALID_PUBKEY).enabled).toBe(true)
	})
})
