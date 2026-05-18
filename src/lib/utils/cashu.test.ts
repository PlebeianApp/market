import { describe, expect, test } from 'bun:test'
import { getP2PKLocktime } from './cashu'

describe('getP2PKLocktime', () => {
	test('extracts locktime from valid P2PK secret string', () => {
		const secret = JSON.stringify(['P2PK', { nonce: 'abc', data: 'def', tags: [['locktime', '1700000000']] }])
		expect(getP2PKLocktime(secret)).toBe(1700000000)
	})

	test('returns Infinity when no locktime tag present', () => {
		const secret = JSON.stringify(['P2PK', { nonce: 'abc', data: 'def' }])
		expect(getP2PKLocktime(secret)).toBe(Infinity)
	})

	test('returns Infinity when tags array is empty', () => {
		const secret = JSON.stringify(['P2PK', { nonce: 'abc', data: 'def', tags: [] }])
		expect(getP2PKLocktime(secret)).toBe(Infinity)
	})

	test('handles Uint8Array input', () => {
		const secret = JSON.stringify(['P2PK', { nonce: 'abc', data: 'def', tags: [['locktime', '1700000000']] }])
		const encoded = new TextEncoder().encode(secret)
		expect(getP2PKLocktime(encoded)).toBe(1700000000)
	})

	test('throws for non-P2PK secret', () => {
		const secret = JSON.stringify(['OTHER', { nonce: 'abc', data: 'def' }])
		expect(() => getP2PKLocktime(secret)).toThrow('Invalid P2PK secret')
	})

	test('throws for unparseable secret', () => {
		expect(() => getP2PKLocktime('not-json')).toThrow()
	})

	test('handles locktime tag with empty value', () => {
		const secret = JSON.stringify(['P2PK', { nonce: 'abc', data: 'def', tags: [['locktime']] }])
		expect(getP2PKLocktime(secret)).toBe(Infinity)
	})

	test('parses locktime as integer from string', () => {
		const secret = JSON.stringify(['P2PK', { nonce: 'abc', data: 'def', tags: [['locktime', '1700000000']] }])
		const result = getP2PKLocktime(secret)
		expect(Number.isInteger(result)).toBe(true)
	})

	test('handles multiple tags, finds locktime', () => {
		const secret = JSON.stringify([
			'P2PK',
			{ nonce: 'abc', data: 'def', tags: [['sigflag', 'SIG_ALL'], ['locktime', '1700000001']] },
		])
		expect(getP2PKLocktime(secret)).toBe(1700000001)
	})

	test('handles SecretData with additional unknown fields', () => {
		const secret = JSON.stringify([
			'P2PK',
			{ nonce: 'abc', data: 'def', tags: [['locktime', '1700000002']], custom: 'field' },
		])
		expect(getP2PKLocktime(secret)).toBe(1700000002)
	})
})
