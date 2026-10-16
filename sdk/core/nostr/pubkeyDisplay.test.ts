import { describe, expect, test } from 'bun:test'
import { formatPubkeyShort } from './pubkeyDisplay'

describe('formatPubkeyShort', () => {
	test('shortens a valid hex pubkey as npub', () => {
		const label = formatPubkeyShort('f'.repeat(64))
		expect(label.startsWith('npub1')).toBe(true)
		expect(label).toMatch(/^.{10}\.\.\..{4}$/)
	})

	test('falls back to hex slices for invalid input', () => {
		expect(formatPubkeyShort('not-a-pubkey')).toBe('not-a-pu...bkey')
	})
})
