/**
 * Unit tests for the outbox-model policy (`lib/outbox-policy.ts`).
 *
 * `computeEnableOutbox` is a pure resolver (no store reads, no NDK instance),
 * so we feed it inputs and assert the computed flag — including the #1046
 * production kill-switch (`NEXT_PUBLIC_DISABLE_OUTBOX`, surfaced here as the
 * `disableOutbox` input that `stores/ndk.ts` derives from `Bun.env`).
 */
import { describe, expect, test } from 'bun:test'
import { computeEnableOutbox } from '../outbox-policy'

describe('computeEnableOutbox — outbox-model rule', () => {
	test('production with no flags keeps the outbox model on', () => {
		expect(computeEnableOutbox({ stage: 'production' })).toBe(true)
	})

	test('production + disableOutbox turns it off (#1046 kill-switch)', () => {
		expect(computeEnableOutbox({ stage: 'production', disableOutbox: true })).toBe(false)
	})

	test('disableOutbox defaults to off (omitting it behaves like false)', () => {
		expect(computeEnableOutbox({ stage: 'production', disableOutbox: false })).toBe(true)
	})

	test('staging is always off, regardless of disableOutbox', () => {
		expect(computeEnableOutbox({ stage: 'staging' })).toBe(false)
		expect(computeEnableOutbox({ stage: 'staging', disableOutbox: true })).toBe(false)
	})

	test('development is always off', () => {
		expect(computeEnableOutbox({ stage: 'development' })).toBe(false)
	})

	test('localRelayOnly overrides production (off even in prod)', () => {
		expect(computeEnableOutbox({ stage: 'production', localRelayOnly: true })).toBe(false)
	})

	test('undefined stage falls through to on (matches the legacy default)', () => {
		expect(computeEnableOutbox({ stage: undefined })).toBe(true)
	})
})
