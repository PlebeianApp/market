import base from './playwright.config'

/**
 * The gate run: the same harness, with evidence recording turned on.
 *
 * The base config keeps video only on failure (`retain-on-failure`) and screenshots only on failure,
 * which is right for a normal suite and useless for a feature gate whose specs *pass*. This config
 * changes nothing else — same webServer, same local relay and mint, same test isolation — so what it
 * records is the same run, just kept.
 *
 * Use:
 *   PATH="/tmp/cashu-e2e-venv/bin:$PATH" bunx playwright test \
 *     --config=e2e/playwright.gate.config.ts e2e/tests/v4v-zap-split-editor.spec.ts
 */
export default {
	...base,
	outputDir: 'artifacts/gate-run',
	use: {
		...base.use,
		video: 'on' as const,
		screenshot: 'on' as const,
	},
}
