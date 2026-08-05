import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import { TEST_APP_PRIVATE_KEY, RELAY_URL, BASE_URL, TEST_PORT } from './test-config'
import { getRecordingScopeSync } from './lib/diff-specs'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Resolve which specs get a FULL recording (video + screenshots) for this run.
// In CI this is diff-aware: the @happy-path baseline UNION the specs whose code
// paths intersect the PR diff (see e2e/lib/diff-specs.ts). Locally it collapses
// to the static @happy-path pattern with no git side effects, keeping
// `bun test e2e/playwright.config.test.ts` hermetic. Logged once for CI clarity.
const recordingScope = getRecordingScopeSync()
if (process.env.CI) {
	// eslint-disable-next-line no-console
	console.log(`[playwright.config] recording scope: ${recordingScope.reason}`)
}

export default defineConfig({
	testDir: './tests',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: 1,
	// In CI, emit the 'github' reporter for log annotations AND a 'json' report
	// so the render-dashboard action can build the nsite dashboard with per-test
	// statuses, screenshots, and counts.
	//
	// Playwright resolves the JSON reporter `outputFile` RELATIVE TO THE CONFIG
	// DIR (e2e/), unlike `outputDir` (traces/videos) which is CWD-relative — so a
	// bare 'test-results/results.json' would land in e2e/test-results/ while every
	// downstream consumer (e2e.yml RESULTS_JSON, render-dashboard results-dir, and
	// the test-results-* artifact upload) reads the WORKSPACE-root test-results/.
	// Use an absolute path via PROJECT_ROOT so the report lands where consumers
	// expect it. Fixes the "0 passed" PR-comment defect (t_26317db1).
	reporter: process.env.CI ? [['github'], ['json', { outputFile: path.join(PROJECT_ROOT, 'test-results', 'results.json') }]] : 'list',
	testMatch: /.*\.spec\.ts$/,

	// trace is shared by every project. CI always records a trace (the
	// interactive trace viewer — DOM scrub, network, console — is uploaded as a
	// workflow artifact so reviewers can debug any failure without a checkout).
	// Locally keep the cheaper on-first-retry behaviour.
	use: {
		baseURL: BASE_URL,
		trace: process.env.CI ? 'on' : 'on-first-retry',
	},

	projects: [
		{
			// Default suite: every spec NOT in the recording scope.
			// Keeps the retain-on-failure / only-on-failure capture the trust
			// pipeline relies on for bulk regression runs.
			name: 'chromium',
			grepInvert: recordingScope.pattern,
			use: {
				...devices['Desktop Chrome'],
				screenshot: 'only-on-failure',
				video: 'retain-on-failure',
			},
		},
		{
			// Recording suite (@happy-path ∪ diff-affected): records a full video
			// and screenshots on every run, giving reviewers visual proof of the
			// feature working that the nsite dashboard surfaces in the PR. Video
			// records at the Desktop Chrome viewport (1280×720 = 720p) as WebM.
			// See docs/plans/pr-trust-pipeline.md (Layer 2) and e2e/lib/diff-specs.ts.
			name: 'chromium-happy-path',
			grep: recordingScope.pattern,
			use: {
				...devices['Desktop Chrome'],
				screenshot: 'on',
				video: 'on',
			},
		},
	],

	// On CI, servers are started manually in the workflow for better visibility.
	// Locally, Playwright manages the relay and dev server automatically.
	webServer: process.env.CI
		? []
		: [
				{
					command: 'nak serve --hostname 0.0.0.0',
					port: 10547,
					reuseExistingServer: true,
					stdout: 'pipe',
					stderr: 'pipe',
				},
				{
					// Seed the relay with app settings, then start the dev server.
					// The dev server caches appSettings at startup, so events must
					// exist on the relay before it initializes.
					command: 'bun e2e/seed-relay.ts && NODE_ENV=test bun dev',
					cwd: PROJECT_ROOT,
					port: TEST_PORT,
					reuseExistingServer: true,
					stdout: 'pipe',
					stderr: 'pipe',
					env: {
						NODE_ENV: 'test',
						PORT: String(TEST_PORT),
						APP_RELAY_URL: RELAY_URL,
						APP_PRIVATE_KEY: TEST_APP_PRIVATE_KEY,
						LOCAL_RELAY_ONLY: 'true',
						NIP46_RELAY_URL: RELAY_URL,
					},
				},
			],

	globalSetup: './global-setup.ts',
	globalTeardown: './global-teardown.ts',
	timeout: 30_000,
	expect: { timeout: 5_000 },
})
