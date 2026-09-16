import { describe, expect, spyOn, test } from 'bun:test'
import { ADDITIONAL_OPERATOR_RELAYS, buildOperatorRelayUrls, parseOperatorRelayUrls } from '@/lib/nostr/operatorRelays'

/**
 * The authority reads (admin/editor lists, blacklist, app settings) must run
 * against relays the operator controls — the configured app relay plus any
 * additional operator relays — and never against third-party public relays,
 * where a stale copy can outlive the canonical one.
 *
 * Production currently runs exactly ONE operator relay
 * (`wss://relay.plebeian.market`), so `buildOperatorRelayUrls(mainRelay, [])`
 * must return exactly that relay: the operator-set change is behaviour
 * preserving until a second operator relay is configured.
 */

const MAIN = 'wss://relay.plebeian.market'

describe('parseOperatorRelayUrls', () => {
	test('accepts a comma-separated string', () => {
		expect(parseOperatorRelayUrls('wss://relay2.plebeian.market, ws://localhost:10547')).toEqual([
			'wss://relay2.plebeian.market',
			'ws://localhost:10547',
		])
	})

	test('accepts an array and trims entries', () => {
		expect(parseOperatorRelayUrls([' wss://relay2.plebeian.market '])).toEqual(['wss://relay2.plebeian.market'])
	})

	test('de-duplicates', () => {
		expect(parseOperatorRelayUrls(['wss://a.plebeian.market', 'wss://a.plebeian.market'])).toEqual(['wss://a.plebeian.market'])
	})

	test('drops non-websocket schemes and junk instead of throwing', () => {
		expect(parseOperatorRelayUrls(['https://relay2.plebeian.market', 'not a relay', '', 'wss://b.plebeian.market'])).toEqual([
			'wss://b.plebeian.market',
		])
	})

	test('returns an empty list for unset or unusable configuration', () => {
		expect(parseOperatorRelayUrls(undefined)).toEqual([])
		expect(parseOperatorRelayUrls(null)).toEqual([])
		expect(parseOperatorRelayUrls('')).toEqual([])
		expect(parseOperatorRelayUrls(42)).toEqual([])
	})
})

describe('buildOperatorRelayUrls', () => {
	test('production today: a single operator relay is returned unchanged', () => {
		expect(buildOperatorRelayUrls(MAIN, [])).toEqual([MAIN])
	})

	test('additional operator relays join the app relay, app relay first', () => {
		expect(buildOperatorRelayUrls(MAIN, ['wss://relay2.plebeian.market', 'wss://relay3.plebeian.market'])).toEqual([
			MAIN,
			'wss://relay2.plebeian.market',
			'wss://relay3.plebeian.market',
		])
	})

	test('does not repeat the app relay when it is also listed as additional', () => {
		expect(buildOperatorRelayUrls(MAIN, [MAIN, 'wss://relay2.plebeian.market'])).toEqual([MAIN, 'wss://relay2.plebeian.market'])
	})

	test('drops malformed additional urls instead of throwing', () => {
		expect(buildOperatorRelayUrls(MAIN, ['https://relay2.plebeian.market', 'wss://relay3.plebeian.market'])).toEqual([
			MAIN,
			'wss://relay3.plebeian.market',
		])
	})

	test('drops third-party public relays from the additional list, with a warning', () => {
		const warn = spyOn(console, 'warn').mockImplementation(() => {})
		try {
			expect(buildOperatorRelayUrls(MAIN, ['wss://relay.damus.io', 'wss://relay2.plebeian.market'])).toEqual([
				MAIN,
				'wss://relay2.plebeian.market',
			])
			expect(warn).toHaveBeenCalled()
		} finally {
			warn.mockRestore()
		}
	})

	test('keeps the configured app relay even if it is also a known public relay', () => {
		// The app relay is operator-chosen; only ADDITIONAL relays are filtered.
		expect(buildOperatorRelayUrls('wss://nos.lol', [])).toEqual(['wss://nos.lol'])
	})

	test('returns an empty list when no operator relay is known yet', () => {
		expect(buildOperatorRelayUrls(undefined, [])).toEqual([])
	})
})

describe('operator relay defaults', () => {
	test('no additional operator relay is compiled in by default', () => {
		expect(ADDITIONAL_OPERATOR_RELAYS).toEqual([])
	})
})
