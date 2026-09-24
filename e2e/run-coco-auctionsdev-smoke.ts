const SAFE = {
	baseUrl: 'http://localhost:34567',
	relayUrl: 'ws://localhost:10547',
	mintUrl: 'http://localhost:3338',
	environmentId: 'local-e2e',
	monetaryMode: 'fake',
} as const

const CHECK_NAMES = [
	'create',
	'fund',
	'bidA',
	'bidB',
	'hardReloadRecovery',
	'winnerRelease',
	'sellerReceiveFinalized',
	'settlement',
	'loserOriginalSendRefund',
	'conservation',
] as const

const result = (
	status: 'passed' | 'failed' | 'refused',
	exitCode: number,
	startedAt: number,
	completedChecks: ReadonlySet<string> = new Set(),
	reason?: string,
) => ({
	schemaVersion: 1,
	suite: 'coco-auctionsdev-smoke',
	status,
	exitCode,
	durationMs: Date.now() - startedAt,
	mode: 'coco-v2',
	environmentId: SAFE.environmentId,
	monetaryMode: SAFE.monetaryMode,
	baseUrl: SAFE.baseUrl,
	relayUrl: SAFE.relayUrl,
	mintUrl: SAFE.mintUrl,
	publicRelayEffects: 0,
	realFundsEnabled: false,
	checks: Object.fromEntries(CHECK_NAMES.map((name) => [name, completedChecks.has(name)])) as Record<(typeof CHECK_NAMES)[number], boolean>,
	...(reason ? { reason } : {}),
})

const startedAt = Date.now()
const forbiddenOverrides: Array<[string, string | undefined, string]> = [
	['BUN_PUBLIC_COCO_ENVIRONMENT_ID', process.env.BUN_PUBLIC_COCO_ENVIRONMENT_ID, SAFE.environmentId],
	['BUN_PUBLIC_COCO_MONETARY_MODE', process.env.BUN_PUBLIC_COCO_MONETARY_MODE, SAFE.monetaryMode],
	['BUN_PUBLIC_COCO_FAKE_MINT_ALLOWLIST', process.env.BUN_PUBLIC_COCO_FAKE_MINT_ALLOWLIST, SAFE.mintUrl],
	['APP_RELAY_URL', process.env.APP_RELAY_URL, SAFE.relayUrl],
]
const unsafe = forbiddenOverrides.find(([, actual, expected]) => actual !== undefined && actual !== expected)
if (unsafe) {
	const payload = result('refused', 64, startedAt, new Set(), `${unsafe[0]} must be exactly ${unsafe[2]} for the isolated smoke`)
	console.log(`COCO_AUCTIONSDEV_SMOKE_RESULT=${JSON.stringify(payload)}`)
	process.exit(64)
}

const child = Bun.spawn(
	[
		'bunx',
		'playwright',
		'test',
		'--config=e2e/playwright.config.ts',
		'e2e/tests/coco-v2-auction-bid.spec.ts',
		'--project=chromium',
		'--grep',
		'@coco-auctionsdev-smoke',
	],
	{
		cwd: process.cwd(),
		stdin: 'inherit',
		stdout: 'pipe',
		stderr: 'pipe',
		env: {
			...process.env,
			COCO_V2_E2E: '1',
			BUN_PUBLIC_AUCTION_MONETARY_MODE: 'coco-v2',
			BUN_PUBLIC_COCO_ENVIRONMENT_ID: SAFE.environmentId,
			BUN_PUBLIC_COCO_MONETARY_MODE: SAFE.monetaryMode,
			BUN_PUBLIC_COCO_FAKE_MINT_ALLOWLIST: SAFE.mintUrl,
			APP_RELAY_URL: SAFE.relayUrl,
		},
	},
)
const stdoutPromise = new Response(child.stdout).text()
const stderrPromise = new Response(child.stderr).text()
void Promise.all([child.exited, stdoutPromise, stderrPromise]).then(([exitCode, stdout, stderr]) => {
	process.stdout.write(stdout)
	process.stderr.write(stderr)
	const completedChecks = new Set(
		Array.from(stdout.matchAll(/^COCO_AUCTIONSDEV_SMOKE_CHECK=([A-Za-z]+)$/gm), (match) => match[1]).filter((name) =>
			CHECK_NAMES.includes(name as (typeof CHECK_NAMES)[number]),
		),
	)
	const payload = result(exitCode === 0 ? 'passed' : 'failed', exitCode, startedAt, completedChecks)
	console.log(`COCO_AUCTIONSDEV_SMOKE_RESULT=${JSON.stringify(payload)}`)
	process.exit(exitCode)
})
