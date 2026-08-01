import { describe, expect, test } from 'bun:test'
import { productsByPubkeyQueryOptions } from '../products'

const VALID_PUBKEY = 'a'.repeat(64)

describe('productsByPubkeyQueryOptions', () => {
	test('disables the query while the pubkey is empty', () => {
		const options = productsByPubkeyQueryOptions('', true)

		expect(options.enabled).toBe(false)
	})

	test('disables the query for a malformed pubkey', () => {
		const options = productsByPubkeyQueryOptions('not-a-valid-pubkey')

		expect(options.enabled).toBe(false)
	})

	test('enables the query for a valid hex pubkey', () => {
		const options = productsByPubkeyQueryOptions(VALID_PUBKEY)

		expect(options.enabled).toBe(true)
	})
})
