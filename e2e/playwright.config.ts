import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import { TEST_APP_PRIVATE_KEY, RELAY_URL, BASE_URL, TEST_PORT } from './test-config'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const COCO_V2_WEB_SERVER_ENV =
	process.env.COCO_V2_E2E === '1'
		? {
				BUN_PUBLIC_AUCTION_MONETARY_MODE: process.env.BUN_PUBLIC_AUCTION_MONETARY_MODE ?? 'coco-v2',
				BUN_PUBLIC_COCO_ENVIRONMENT_ID: process.env.BUN_PUBLIC_COCO_ENVIRONMENT_ID ?? 'test',
				BUN_PUBLIC_COCO_MONETARY_MODE: process.env.BUN_PUBLIC_COCO_MONETARY_MODE ?? 'fake',
				BUN_PUBLIC_COCO_FAKE_MINT_ALLOWLIST: process.env.BUN_PUBLIC_COCO_FAKE_MINT_ALLOWLIST ?? 'http://localhost:3338',
				BUN_PUBLIC_COCO_FAKE_MINT_IDENTITIES: process.env.BUN_PUBLIC_COCO_FAKE_MINT_IDENTITIES ?? '',
				BUN_PUBLIC_MARKET_COMMIT_SHA: process.env.BUN_PUBLIC_MARKET_COMMIT_SHA ?? '',
			}
		: {}

export default defineConfig({
	testDir: './tests',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: 1,
	reporter: process.env.CI ? 'github' : 'list',
	testMatch: /.*\.spec\.ts$/,

	use: {
		baseURL: BASE_URL,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
	},

	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],

	// On CI, servers are started manually in the workflow for better visibility.
	// Locally, Playwright manages the relay, mint, and dev server automatically.
	webServer: process.env.CI
		? []
		: [
				{
					command: 'nak serve --hostname 0.0.0.0 < /dev/null',
					// `nak serve` reads stdin, so a relay spawned with a piped
					// (never-EOF) stdin never binds its port — Playwright then
					// fails the whole run with "Timed out waiting 60000ms from
					// config.webServer" whenever it has to start the relay
					// itself, i.e. every cold local run. Redirect stdin from
					// /dev/null so nak starts serving.
					port: 10547,
					reuseExistingServer: true,
					stdout: 'pipe',
					stderr: 'pipe',
				},
				{
					// Local Cashu mint (nutshell with FakeWallet backend).
					// Auto-settles Lightning invoices instantly — no external
					// Lightning node or external mint required.
					command: 'bash e2e/start-local-mint.sh',
					cwd: PROJECT_ROOT,
					port: 3338,
					reuseExistingServer: true,
					stdout: 'pipe',
					stderr: 'pipe',
				},
				{
					// Seed the relay with app settings, then start the dev server.
					// The dev server caches appSettings at startup, so events must
					// exist on the relay before it initializes.
					//
					// `reuseExistingServer` stays FALSE here on purpose. Reusing a
					// dev server skips this whole command, seeding included, so the
					// run would silently execute against a relay with no app
					// settings / admin list and against a server that may belong to
					// another worktree. In that state the ADR-0009 label suites
					// degrade quietly (labels fail open, label actions never render)
					// instead of failing for a readable reason. Failing fast on an
					// occupied port is the honest outcome — the relay and mint
					// entries above keep their reuse.
					command: 'bun e2e/seed-relay.ts && NODE_ENV=test bun dev',
					cwd: PROJECT_ROOT,
					port: TEST_PORT,
					reuseExistingServer: false,
					stdout: 'pipe',
					stderr: 'pipe',
					env: {
						...COCO_V2_WEB_SERVER_ENV,
						NODE_ENV: 'test',
						PORT: String(TEST_PORT),
						APP_RELAY_URL: RELAY_URL,
						APP_PRIVATE_KEY: TEST_APP_PRIVATE_KEY,
						// Same value the e2e workflow exports before starting the dev
						// server. Without it `/api/config` throws ("No CVM server
						// pubkey available") and global setup fails with
						// "needsSetup=true after 10 retries" — i.e. a
						// Playwright-managed local run could never get past startup,
						// which is what pushed local runs onto a reused dev server.
						CVM_SERVER_KEY: 'e2e2222222222222222222222222222222222222222222222222222222222222',
						LOCAL_RELAY_ONLY: 'true',
						NIP46_RELAY_URL: RELAY_URL,
						APP_DEV_TEST_MINT_URL: 'http://localhost:3338',
					},
				},
			],

	globalSetup: './global-setup.ts',
	globalTeardown: './global-teardown.ts',
	timeout: 120_000,
	expect: { timeout: 5_000 },
})
