/**
 * Video-recording browser context, as a file-level fixture.
 *
 * WHY A FIXTURE AND NOT `test.use({ video: 'on' })`
 * -------------------------------------------------
 * The `video` option in `playwright.config.ts` / `test.use()` is only applied
 * to the context Playwright builds for the built-in `page` fixture. Any spec
 * that builds its own context with `browser.newContext()` gets a context with
 * NO recording, and `test.use({ video: 'on' })` is silently dropped — there is
 * no error, just a missing artifact. That pitfall is documented in-repo at
 * `e2e/tests/og-meta-tags.spec.ts` (the login specs need their own context for
 * init scripts, route interception and video, so they cannot use `page`).
 *
 * The supported mechanism is to pass `recordVideo` at context-construction
 * time — precedent: the ADR-0009 confirmation run in
 * `e2e/tests/test-labels-admin-confirmation.spec.ts` (PR #1280).
 *
 * This fixture also PROVES THE ARTIFACT EXISTS. On teardown it resolves the
 * recorded path, closes the context (which is what flushes the .webm to disk)
 * and FAILS the test if the file is missing or zero bytes. A green run can
 * therefore never be green-without-evidence, and the byte size is printed to
 * the reporter output and attached to the test result.
 */
import fs from 'node:fs'
import path from 'node:path'
import { test as base, type BrowserContext, type Page } from '@playwright/test'

/** Directory the recordings land in, relative to the Playwright cwd (repo root). */
export const EVIDENCE_VIDEO_DIR = 'test-results/evidence'

export interface RecordedContext {
	context: BrowserContext
	page: Page
}

export const test = base.extend<{ recorded: RecordedContext }>({
	recorded: async ({ browser }, use, testInfo) => {
		const context = await browser.newContext({
			viewport: { width: 1280, height: 720 },
			recordVideo: { dir: EVIDENCE_VIDEO_DIR, size: { width: 1280, height: 720 } },
		})
		const page = await context.newPage()

		await use({ context, page })

		const video = page.video()
		// close() is what flushes the .webm — resolve the path first, close
		// second, stat third (Playwright documents the file as "available after
		// the page is closed").
		await context.close()

		const videoPath = video ? await video.path() : undefined
		if (!videoPath) {
			throw new Error(
				'No video was recorded for this test (context.recordVideo was dropped). ' + 'Video evidence is mandatory for this gate.',
			)
		}
		if (!fs.existsSync(videoPath)) {
			throw new Error(`Expected video evidence at ${videoPath} but the file does not exist`)
		}
		const bytes = fs.statSync(videoPath).size
		if (bytes === 0) {
			throw new Error(`Video evidence at ${videoPath} is 0 bytes — recording did not work`)
		}

		const label = path.relative(process.cwd(), videoPath)
		console.log(`\n  VIDEO EVIDENCE: ${label} (${bytes} bytes)\n`)
		await testInfo.attach('login-gate-video', { path: videoPath, contentType: 'video/webm' })
	},
})

export { expect } from '@playwright/test'
