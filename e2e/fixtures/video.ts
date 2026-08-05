/**
 * Decide whether a browser context should record video for the current test.
 *
 * Playwright's project-level `use.video` setting only auto-applies to the
 * built-in `page`/`context` fixtures. The e2e page fixtures
 * (merchantPage, buyerPage, newUserPage, unauthenticatedPage) create their own
 * contexts via `browser.newContext()` for per-user isolation, so they must opt
 * into recording explicitly by passing `recordVideo`.
 *
 * We forward only the unconditional capture modes. The `retain-on-failure` and
 * `only-on-failure` modes cannot be replicated on a manually-created context
 * (Playwright would keep every recording, not just failures), so non-happy-path
 * projects record nothing — identical to the pre-existing behaviour for these
 * fixtures.
 *
 * @param videoMode the `testInfo.project.use.video` value for the running project
 */
export function shouldRecordVideo(videoMode: string | undefined): videoMode is 'on' | 'on-first-retry' | 'on-all-retries' {
	return videoMode === 'on' || videoMode === 'on-first-retry' || videoMode === 'on-all-retries'
}
