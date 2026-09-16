/**
 * Bounded author-relay read path — policy tests (ADR-0002 Wave 1 addendum, F3).
 *
 * F3 has exactly one decision point: a server-computed `/api/config` boolean
 * that is ON in production only (OFF in staging, development, `LOCAL_RELAY_ONLY`
 * and CI). The browser consumes that single decision; the server-side arm
 * applies the same policy independently because it cannot read the
 * `/api/config` response it produces (same shape as ADR-016's zap relays).
 *
 * These tests pin the policy so it cannot drift between the two arms, and pin
 * the authority carve-out: an authority read (app config, admin/editor/
 * blacklist, settlement) may never consult author relays, even when the flag
 * is ON.
 */
import { describe, expect, test } from 'bun:test'

import {
	isAuthorRelayReadAllowed,
	isExternalAuthorReadsEnabledFromConfig,
	resolveExternalAuthorReadsEnabled,
} from '@/lib/nostr/authorRelayPolicy'

describe('externalAuthorReadsEnabled stage policy', () => {
	test('is ON in production', () => {
		expect(resolveExternalAuthorReadsEnabled({ stage: 'production', localRelayOnly: false })).toBe(true)
	})

	test('is OFF in staging and development', () => {
		expect(resolveExternalAuthorReadsEnabled({ stage: 'staging', localRelayOnly: false })).toBe(false)
		expect(resolveExternalAuthorReadsEnabled({ stage: 'development', localRelayOnly: false })).toBe(false)
	})

	test('is OFF for LOCAL_RELAY_ONLY and CI runs even with a production stage', () => {
		expect(resolveExternalAuthorReadsEnabled({ stage: 'production', localRelayOnly: true })).toBe(false)
		// `NODE_ENV=test` resolves to the development stage in the server entry
		expect(resolveExternalAuthorReadsEnabled({ stage: 'development', localRelayOnly: true })).toBe(false)
	})

	test('is OFF when the stage is unknown or absent (fail closed)', () => {
		expect(resolveExternalAuthorReadsEnabled({ stage: undefined, localRelayOnly: false })).toBe(false)
		expect(resolveExternalAuthorReadsEnabled({ stage: 'test', localRelayOnly: false })).toBe(false)
	})
})

describe('client consumption of the single server decision', () => {
	test('the flag defaults OFF when the config is absent or missing the field', () => {
		expect(isExternalAuthorReadsEnabledFromConfig(undefined)).toBe(false)
		expect(isExternalAuthorReadsEnabledFromConfig(null)).toBe(false)
		expect(isExternalAuthorReadsEnabledFromConfig({})).toBe(false)
	})

	test('only an explicit boolean true turns the path on', () => {
		expect(isExternalAuthorReadsEnabledFromConfig({ externalAuthorReadsEnabled: true })).toBe(true)
		expect(isExternalAuthorReadsEnabledFromConfig({ externalAuthorReadsEnabled: false })).toBe(false)
		expect(isExternalAuthorReadsEnabledFromConfig({ externalAuthorReadsEnabled: 'true' })).toBe(false)
		expect(isExternalAuthorReadsEnabledFromConfig({ externalAuthorReadsEnabled: 1 })).toBe(false)
	})
})

describe('authority carve-out', () => {
	test('an authority read is refused even with the flag ON', () => {
		expect(isAuthorRelayReadAllowed('authority', true)).toBe(false)
		expect(isAuthorRelayReadAllowed('authority', false)).toBe(false)
	})

	test('display and self-scoped reads are allowed only with the flag ON', () => {
		expect(isAuthorRelayReadAllowed('display', true)).toBe(true)
		expect(isAuthorRelayReadAllowed('self', true)).toBe(true)
		expect(isAuthorRelayReadAllowed('display', false)).toBe(false)
		expect(isAuthorRelayReadAllowed('self', false)).toBe(false)
	})
})
