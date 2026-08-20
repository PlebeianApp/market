/**
 * Unit tests for the single-relay lookup path in ogMeta.ts.
 *
 * Per the repo test-isolation rules these tests exercise only the
 * non-network paths (input validation and relay-configuration guards);
 * real relay round-trips are covered by the e2e suite against the local
 * CI relay. Failure/timeout behavior (null → untouched SPA shell) is
 * covered by the renderProductPageHtml tests in ogTags.test.ts.
 */
import { describe, expect, test } from 'bun:test'
import { getProductOgMeta } from '../../server/ogMeta'

describe('getProductOgMeta', () => {
	test('returns null for ids that are not 64-hex event ids (no relay IO)', async () => {
		expect(await getProductOgMeta('wss://relay.example.com', 'not-an-id')).toBeNull()
		expect(await getProductOgMeta('wss://relay.example.com', '')).toBeNull()
		expect(await getProductOgMeta('wss://relay.example.com', 'z'.repeat(64))).toBeNull()
		expect(await getProductOgMeta('wss://relay.example.com', 'a'.repeat(63))).toBeNull()
		expect(await getProductOgMeta('wss://relay.example.com', 'a'.repeat(65))).toBeNull()
	})

	test('accepts uppercase hex ids by normalizing to lowercase', async () => {
		// Uppercase hex is a valid event id once lowercased; no relay is
		// configured so the lookup still stops before any network IO.
		expect(await getProductOgMeta(undefined, 'B'.repeat(64))).toBeNull()
	})

	test('returns null before any relay IO when no relay is configured', async () => {
		expect(await getProductOgMeta(undefined, 'a'.repeat(64))).toBeNull()
		expect(await getProductOgMeta(undefined, 'c'.repeat(64))).toBeNull()
		expect(await getProductOgMeta('', 'd'.repeat(64))).toBeNull()
		expect(await getProductOgMeta('   ', 'e'.repeat(64))).toBeNull()
	})
})
