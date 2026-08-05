import { expect, test, describe } from 'bun:test'
import { shouldRecordVideo } from './video'

/**
 * Pure-logic guard for the e2e fixture video forwarding (e2e/fixtures/index.ts).
 *
 * Playwright's project-level `use.video` does NOT auto-apply to contexts created
 * manually via `browser.newContext()` (which the fixtures need for per-user
 * isolation). The fixtures instead read the mode from `testInfo.project.use.video`
 * and pass `recordVideo` only when this guard returns true. These tests pin that
 * decision so a happy-path spec (video: 'on') records while the bulk regression
 * suite (retain-on-failure) stays recording-free, matching the config contract.
 */
describe('shouldRecordVideo', () => {
	test('records for unconditional capture modes', () => {
		expect(shouldRecordVideo('on')).toBe(true)
		expect(shouldRecordVideo('on-first-retry')).toBe(true)
		expect(shouldRecordVideo('on-all-retries')).toBe(true)
	})

	test('does not record for retain/only-on-failure modes', () => {
		// Manual contexts cannot replicate retain-on-failure (keep-on-fail,
		// discard-on-pass) semantics; recording unconditionally would bloat
		// every run, so non-happy-path projects record nothing — same as today.
		expect(shouldRecordVideo('retain-on-failure')).toBe(false)
		expect(shouldRecordVideo('only-on-failure')).toBe(false)
		expect(shouldRecordVideo('off')).toBe(false)
	})

	test('does not record when video is unconfigured', () => {
		expect(shouldRecordVideo(undefined)).toBe(false)
		expect(shouldRecordVideo('')).toBe(false)
	})
})
