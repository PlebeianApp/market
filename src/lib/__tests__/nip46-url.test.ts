import { describe, expect, test } from 'bun:test'
import { MAIN_RELAY_BY_STAGE } from '../constants'
import {
	buildNostrConnectUrl,
	buildNostrConnectUrlFromResolvedRelayUrls,
	buildBunkerUrl,
	buildBunkerUrlFromResolvedRelayUrls,
	getNip46RelayUrls,
	isApprovedNostrConnectResponse,
	normalizeRelayUrls,
} from '../nostr/nip46'

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
			icons: ['https://plebeian.market/icon.png'],
		})
		const parsed = new URL(url)

		expect(url).toContain(`nostrconnect://${'a'.repeat(64)}`)
		expect(url).toContain('relay=wss%3A%2F%2Frelay.example.com')
		expect(url).toContain('secret=abc123')
		expect(url).toContain(`relay=${encodeURIComponent('wss://relay.example.com')}`)
		expect(url).not.toContain(`relay=${encodeURIComponent(MAIN_RELAY_BY_STAGE.development)}`)
		expect(parsed.searchParams.get('metadata')).toEqual(
			JSON.stringify({
				name: 'Plebeian.market',
				url: 'https://plebeian.market',
				icons: ['https://plebeian.market/icon.png'],
			}),
		)
		expect(parsed.searchParams.has('name')).toBe(false)
		expect(parsed.searchParams.has('url')).toBe(false)
		expect(parsed.searchParams.has('image')).toBe(false)
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

	test('uses resolved relay URLs without resolving them again', () => {
		const nostrConnectUrl = buildNostrConnectUrlFromResolvedRelayUrls('a'.repeat(64), [], 'abc123')
		const bunkerUrl = buildBunkerUrlFromResolvedRelayUrls('b'.repeat(64), [], 'abc123')

		expect(new URL(nostrConnectUrl).searchParams.getAll('relay')).toEqual([])
		expect(new URL(bunkerUrl).searchParams.getAll('relay')).toEqual([])
	})

	test('only accepts NostrConnect responses from an approved signer', () => {
		const tempSecret = 'temporary-secret'
		const approvedSignerPubkeys = new Set(['approved-signer'])

		expect(isApprovedNostrConnectResponse(tempSecret, tempSecret, 'approved-signer', approvedSignerPubkeys)).toBe(true)
		expect(isApprovedNostrConnectResponse(tempSecret, tempSecret, 'unapproved-signer', approvedSignerPubkeys)).toBe(false)
		expect(isApprovedNostrConnectResponse('ack', tempSecret, 'unapproved-signer', approvedSignerPubkeys)).toBe(false)
	})
})
