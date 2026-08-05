import { expect, test, describe } from 'bun:test'
import type { PlaywrightTestConfig } from '@playwright/test'

/**
 * Regression guard for the @happy-path video routing in e2e/playwright.config.ts.
 *
 * Run: `bun test e2e/playwright.config.test.ts`
 *
 * The trust pipeline records video for specs whose title contains the
 * `@happy-path` tag and leaves every other spec on the cheaper
 * `retain-on-failure` / `only-on-failure` defaults. Playwright applies `use`
 * options per project, so the routing is implemented as two chromium projects
 * split by `grep` / `grepInvert`. This test pins that contract so a future
 * config edit cannot silently regress video capture or loosen the worker/retry
 * guarantees the task forbids changing.
 */
import rawConfig from './playwright.config'

const config = rawConfig as unknown as PlaywrightTestConfig

const HAPPY_PATH = /@happy-path/

describe('playwright.config @happy-path video routing', () => {
	test('exposes exactly one project that captures @happy-path specs', () => {
		const happyPathProjects = (config.projects ?? []).filter(
			(p) => p.grep instanceof RegExp && HAPPY_PATH.source === (p.grep as RegExp).source,
		)
		expect(happyPathProjects.length).toBe(1)
	})

	test('happy-path project records video and screenshots unconditionally', () => {
		const happy = (config.projects ?? []).find((p) => p.grep instanceof RegExp && HAPPY_PATH.source === (p.grep as RegExp).source)
		expect(happy).toBeDefined()
		expect(happy!.use?.video).toBe('on')
		expect(happy!.use?.screenshot).toBe('on')
	})

	test('non-happy-path project keeps retain-on-failure video and only-on-failure screenshots', () => {
		const others = (config.projects ?? []).filter((p) => !(p.grep instanceof RegExp && HAPPY_PATH.source === (p.grep as RegExp).source))
		expect(others.length).toBeGreaterThan(0)
		for (const p of others) {
			// Default project must opt OUT of @happy-path so the two projects partition the suite.
			expect(p.grepInvert).toBeDefined()
			expect((p.grepInvert as RegExp)?.source).toBe(HAPPY_PATH.source)
			expect(p.use?.video).toBe('retain-on-failure')
			expect(p.use?.screenshot).toBe('only-on-failure')
		}
	})

	test('does not change worker count or parallelism (task constraint)', () => {
		expect(config.workers).toBe(1)
		expect(config.fullyParallel).toBe(false)
	})

	test('does not change retry count (task constraint)', () => {
		// retries is the same CI/non-CI split the task forbids touching.
		expect(config.retries).toBe(process.env.CI ? 2 : 0)
	})

	test('CI records a trace on every run; locally keeps on-first-retry (Layer 2a)', () => {
		// CI sets trace 'on' so the interactive trace viewer (DOM scrub, network,
		// console) is uploaded as a workflow artifact for offline debugging.
		// Locally the cheaper on-first-retry mode is retained.
		expect(config.use?.trace).toBe(process.env.CI ? 'on' : 'on-first-retry')
	})

	test('every project still targets chromium only (no new browsers introduced)', () => {
		for (const p of config.projects ?? []) {
			const deviceName = (p.use as { browserName?: string })?.browserName
			expect(deviceName ?? 'chromium').toBe('chromium')
		}
	})
})
