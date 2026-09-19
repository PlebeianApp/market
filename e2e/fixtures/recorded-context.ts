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
 *
 * VIDEO MODE — `E2E_VIDEO` (REQUIRED | OFF)
 * -----------------------------------------
 * `E2E_VIDEO` selects how much evidence a run has to produce. It does not
 * change what the specs assert about the app.
 *
 *   E2E_VIDEO=required  (DEFAULT — this is what CI runs)
 *     The context is built WITH `recordVideo`, the teardown resolves the
 *     `.webm`, and the test FAILS if the file is missing or 0 bytes. This is
 *     the "a green run can never be green-without-evidence" path, and it is
 *     byte-for-byte the behaviour CI has always had (CI sets no `E2E_VIDEO`,
 *     so it resolves to `required`).
 *
 *   E2E_VIDEO=off
 *     The context is built WITHOUT `recordVideo`, no video file is asserted,
 *     and ONE loud banner is printed to the reporter output for every test
 *     that uses this fixture. That run proves BEHAVIOUR ONLY — it is not gate
 *     evidence and must never be cited as such. Use it only where recording is
 *     physically impossible (see the measured platform fact below).
 *
 * Any other value throws at import time: the switch is fail-closed, so a typo
 * can never silently downgrade a run from evidence to non-evidence.
 *
 * MEASURED PLATFORM FACT (Ubuntu 26.04 x64 — fleet T470 node, 2026-09-19)
 * -----------------------------------------------------------------------
 * The Playwright version this repo pins (`@playwright/test` ^1.60.0; the
 * runner reports 1.60.0) refuses to provision the recorder for Ubuntu 26.04:
 *
 *   $ bunx playwright install ffmpeg
 *   Failed to install browsers
 *   Error: ERROR: Playwright does not support ffmpeg on ubuntu26.04-x64
 *   (exit 1 — and the same command DELETES any cached `ffmpeg-1011` dir)
 *
 * and any context constructed with `recordVideo` under that runner dies before
 * the first navigation:
 *
 *   Error: browserContext.newPage: Executable doesn't exist at
 *   /home/<user>/.cache/ms-playwright/ffmpeg-1011/ffmpeg-linux
 *   ╔═ Video rendering requires ffmpeg binary ... install ffmpeg ═╗
 *
 * A NEWER Playwright release can hand over the binary (measured: 1.63.0 via
 * `bunx playwright@latest install ffmpeg` downloads playwright ffmpeg v1011 on
 * this OS), but a run under the PINNED runner cannot — and results produced by
 * a different runner version are not this gate's results. `E2E_VIDEO=off` is
 * therefore the ONLY way to exercise these specs' LOGIC on such a host.
 *
 * CI is unaffected: the GitHub runners are `ubuntu-latest` (<= 24.04) and
 * install the recorder via `bunx playwright install --with-deps chromium`
 * (see `.github/workflows/e2e.yml`), so CI keeps `required` — video stays
 * mandatory there — and keeps publishing `.webm` artifacts.
 */
import fs from 'node:fs'
import path from 'node:path'
import { test as base, type BrowserContext, type Page } from '@playwright/test'

/** Directory the recordings land in, relative to the Playwright cwd (repo root). */
export const EVIDENCE_VIDEO_DIR = 'test-results/evidence'

/** Video-evidence mode: `required` (default, CI) or `off` (host cannot record). */
export type VideoEvidenceMode = 'required' | 'off'

/**
 * Resolve `E2E_VIDEO`. Fail-closed: only the two documented values are
 * accepted, everything else throws rather than silently choosing a mode.
 */
function resolveVideoEvidenceMode(): VideoEvidenceMode {
	const raw = process.env.E2E_VIDEO
	if (raw === undefined || raw === '') return 'required'
	if (raw === 'required' || raw === 'off') return raw
	throw new Error(
		`E2E_VIDEO must be 'required' (default) or 'off', got '${raw}'. ` +
			'Refusing to guess: a misspelled value must not silently downgrade a run from evidence to non-evidence.',
	)
}

/** Active video-evidence mode for this process. */
export const VIDEO_EVIDENCE_MODE: VideoEvidenceMode = resolveVideoEvidenceMode()

/**
 * The single, greppable banner printed when video evidence is switched off.
 * Kept as a constant so the notice and any assertion on it can never drift.
 */
export const VIDEO_DISABLED_NOTICE =
	'VIDEO EVIDENCE DISABLED (E2E_VIDEO=off) — this run proves behaviour, NOT evidence; do not cite it as gate evidence'

export interface RecordedContext {
	context: BrowserContext
	page: Page
}

export const test = base.extend<{ recorded: RecordedContext }>({
	recorded: async ({ browser }, use, testInfo) => {
		const videoSize = { width: 1280, height: 720 }

		if (VIDEO_EVIDENCE_MODE === 'off') {
			// Printed BEFORE the test body so the caveat is in the output even
			// if the run dies part-way through.
			console.log(
				`\n  ┌──────────────────────────────────────────────────────────────────┐\n` +
					`  │ ${VIDEO_DISABLED_NOTICE}\n` +
					`  └──────────────────────────────────────────────────────────────────┘\n`,
			)
		}

		const context = await browser.newContext({
			viewport: videoSize,
			// `required`: recording is requested here and asserted on teardown.
			// `off`: no `recordVideo` key at all, so the context has no recorder
			// (and no ffmpeg binary is needed to build it).
			...(VIDEO_EVIDENCE_MODE === 'required' ? { recordVideo: { dir: EVIDENCE_VIDEO_DIR, size: videoSize } } : {}),
		})
		const page = await context.newPage()

		await use({ context, page })

		const video = page.video()
		// close() is what flushes the .webm — resolve the path first, close
		// second, stat third (Playwright documents the file as "available after
		// the page is closed").
		await context.close()

		if (VIDEO_EVIDENCE_MODE === 'off') {
			// Behaviour-only run: there is no artifact to resolve or assert.
			console.log(`  VIDEO EVIDENCE: not recorded (E2E_VIDEO=off)\n`)
			return
		}

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
