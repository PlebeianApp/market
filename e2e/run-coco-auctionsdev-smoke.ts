import { createConnection } from 'node:net'
import {
	COCO_CORE_INSTALLED_CONTENT_HASH,
	COCO_INDEXEDDB_INSTALLED_CONTENT_HASH,
	COCO_ROUND_14_SHA,
	installedContentHash,
} from '../scripts/coco-artifact-contract'
import { COCO_AUCTIONSDEV_FAKE_MINT_INFO_COMMITMENT, COCO_AUCTIONSDEV_SMOKE_SAFE as SAFE } from './coco-auctionsdev-smoke-contract'

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

interface CandidateIdentity {
	marketCommit: string
	coreSha: string
	coreInstalledContentHash: string
	indexeddbInstalledContentHash: string
}

const result = (
	status: 'passed' | 'failed' | 'refused',
	exitCode: number,
	startedAt: number,
	candidate: CandidateIdentity,
	completedChecks: ReadonlySet<string> = new Set(),
	reason?: string,
	preflightReportPath?: string,
) => ({
	schemaVersion: 2,
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
	appServerColdStart: true,
	candidate,
	checks: Object.fromEntries(CHECK_NAMES.map((name) => [name, completedChecks.has(name)])) as Record<(typeof CHECK_NAMES)[number], boolean>,
	...(reason ? { reason } : {}),
	...(preflightReportPath ? { preflightReportPath } : {}),
})

const gitOutput = (args: string[]): string => {
	const command = Bun.spawnSync(['git', ...args], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' })
	if (command.exitCode !== 0) throw new Error(new TextDecoder().decode(command.stderr).trim() || `git ${args.join(' ')} failed`)
	return new TextDecoder().decode(command.stdout).trim()
}

const portIsOpen = (url: string): Promise<boolean> => {
	const parsed = new URL(url)
	const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80))
	return new Promise((resolve) => {
		const socket = createConnection({ host: parsed.hostname, port })
		let settled = false
		const finish = (open: boolean) => {
			if (settled) return
			settled = true
			socket.destroy()
			resolve(open)
		}
		socket.setTimeout(500)
		socket.once('connect', () => finish(true))
		socket.once('timeout', () => finish(false))
		socket.once('error', () => finish(false))
	})
}

const startedAt = Date.now()
let candidate: CandidateIdentity = {
	marketCommit: '0'.repeat(40),
	coreSha: COCO_ROUND_14_SHA,
	coreInstalledContentHash: COCO_CORE_INSTALLED_CONTENT_HASH,
	indexeddbInstalledContentHash: COCO_INDEXEDDB_INSTALLED_CONTENT_HASH,
}

const refuse = (reason: string): never => {
	console.log(`COCO_AUCTIONSDEV_SMOKE_RESULT=${JSON.stringify(result('refused', 64, startedAt, candidate, new Set(), reason))}`)
	process.exit(64)
}

try {
	const marketCommit = gitOutput(['rev-parse', 'HEAD'])
	if (!/^[0-9a-f]{40}$/.test(marketCommit)) refuse('Market HEAD is not an exact 40-character commit')
	candidate = { ...candidate, marketCommit }
	if (gitOutput(['status', '--porcelain', '--untracked-files=normal']))
		refuse('Market worktree must be clean before sealed smoke execution')
	if (await portIsOpen(SAFE.baseUrl)) refuse(`app port ${new URL(SAFE.baseUrl).port} is already occupied; cold start is mandatory`)

	const [coreInstalledContentHash, indexeddbInstalledContentHash] = await Promise.all([
		installedContentHash('node_modules/@cashu/coco-core'),
		installedContentHash('node_modules/@cashu/coco-indexeddb'),
	])
	candidate = { ...candidate, coreInstalledContentHash, indexeddbInstalledContentHash }
	if (coreInstalledContentHash !== COCO_CORE_INSTALLED_CONTENT_HASH) refuse('installed @cashu/coco-core content hash mismatch')
	if (indexeddbInstalledContentHash !== COCO_INDEXEDDB_INSTALLED_CONTENT_HASH)
		refuse('installed @cashu/coco-indexeddb content hash mismatch')

	const forbiddenOverrides: Array<[string, string | undefined, string]> = [
		['BUN_PUBLIC_COCO_ENVIRONMENT_ID', process.env.BUN_PUBLIC_COCO_ENVIRONMENT_ID, SAFE.environmentId],
		['BUN_PUBLIC_COCO_MONETARY_MODE', process.env.BUN_PUBLIC_COCO_MONETARY_MODE, SAFE.monetaryMode],
		['BUN_PUBLIC_COCO_FAKE_MINT_ALLOWLIST', process.env.BUN_PUBLIC_COCO_FAKE_MINT_ALLOWLIST, SAFE.mintUrl],
		['APP_RELAY_URL', process.env.APP_RELAY_URL, SAFE.relayUrl],
	]
	const unsafe = forbiddenOverrides.find(([, actual, expected]) => actual !== undefined && actual !== expected)
	if (unsafe) refuse(`${unsafe[0]} must be exactly ${unsafe[2]} for the isolated smoke`)

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
				BUN_PUBLIC_COCO_FAKE_MINT_IDENTITIES: `${SAFE.mintUrl}=${COCO_AUCTIONSDEV_FAKE_MINT_INFO_COMMITMENT}`,
				BUN_PUBLIC_MARKET_COMMIT_SHA: marketCommit,
				APP_RELAY_URL: SAFE.relayUrl,
			},
		},
	)
	const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
	process.stdout.write(stdout)
	process.stderr.write(stderr)
	const completedChecks = new Set(
		Array.from(stdout.matchAll(/^COCO_AUCTIONSDEV_SMOKE_CHECK=([A-Za-z]+)$/gm), (match) => match[1]).filter((name) =>
			CHECK_NAMES.includes(name as (typeof CHECK_NAMES)[number]),
		),
	)
	const preflightReportPath = stdout.match(/^COCO_AUCTIONSDEV_PREFLIGHT_REPORT_PATH=(.+)$/m)?.[1]
	if (exitCode === 0 && !preflightReportPath) refuse('Playwright passed without producing a strict fresh-wallet preflight report')
	const payload = result(
		exitCode === 0 ? 'passed' : 'failed',
		exitCode,
		startedAt,
		candidate,
		completedChecks,
		exitCode === 0 ? undefined : `Playwright exited ${exitCode}; inspect the preceding causal trace`,
		preflightReportPath,
	)
	console.log(`COCO_AUCTIONSDEV_SMOKE_RESULT=${JSON.stringify(payload)}`)
	process.exit(exitCode)
} catch (error) {
	refuse(error instanceof Error ? error.message : String(error))
}
