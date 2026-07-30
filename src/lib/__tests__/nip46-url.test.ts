import { describe, expect, test } from 'bun:test'
import { MAIN_RELAY_BY_STAGE } from '../constants'
import { buildNostrConnectUrl, buildBunkerUrl, getNip46RelayUrls, normalizeRelayUrls } from '../nostr/nip46'

describe('NIP-46 connection URL helpers', () => {
	test('preserves explicit relays without injecting the development relay when a relay is already provided', () => {
		const relays = getNip46RelayUrls([' wss://relay.example.com ', MAIN_RELAY_BY_STAGE.development, ''])

		expect(relays).toEqual(['wss://relay.example.com', MAIN_RELAY_BY_STAGE.development])
	})

	test('falls back to the development relay only when no relays are provided', () => {
		const relays = getNip46RelayUrls([])

		expect(relays).toEqual([MAIN_RELAY_BY_STAGE.development])
	})

	test('builds nostrconnect URLs using the NIP-46 secret parameter', () => {
		const url = buildNostrConnectUrl('a'.repeat(64), 'wss://relay.example.com', 'abc123', {
			name: 'Plebeian.market',
			url: 'https://plebeian.market',
			image: 'https://plebeian.market/icon.png',
		})

		expect(url).toContain(`nostrconnect://${'a'.repeat(64)}`)
		expect(url).toContain('relay=wss%3A%2F%2Frelay.example.com')
		expect(url).toContain('secret=abc123')
		expect(url).toContain(`relay=${encodeURIComponent('wss://relay.example.com')}`)
		expect(url).not.toContain(`relay=${encodeURIComponent(MAIN_RELAY_BY_STAGE.development)}`)
		expect(url).toContain('name=Plebeian.market')
		expect(url).toContain('url=https%3A%2F%2Fplebeian.market')
		expect(url).not.toContain('token=')
	})

	test('keeps multiple relay query parameters for remote signer choice', () => {
		const url = buildNostrConnectUrl('a'.repeat(64), ['wss://relay.one', 'ws://localhost:10547'], 'abc123')
		const parsed = new URL(url)

		expect(parsed.searchParams.getAll('relay')).toEqual(['wss://relay.one', 'ws://localhost:10547'])
	})

	test('normalizes explicit relay lists for signer login without duplicates', () => {
		const relays = normalizeRelayUrls([' wss://relay.one ', 'wss://relay.one', 'wss://relay.two', ''])

		expect(relays).toEqual(['wss://relay.one', 'wss://relay.two'])
	})

	test('builds bunker URLs with a secret query parameter', () => {
		const url = buildBunkerUrl('b'.repeat(64), 'wss://relay.example.com', 'abc123')

		expect(url).toContain(`bunker://${'b'.repeat(64)}`)
		expect(url).toContain('relay=wss%3A%2F%2Frelay.example.com')
		expect(url).toContain('secret=abc123')
		expect(url).toContain(`relay=${encodeURIComponent('wss://relay.example.com')}`)
		expect(url).not.toContain('token=')
	})
})
