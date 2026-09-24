import { verifyFreshAuctionsdevPublicReport } from '../src/lib/coco/migration/freshAuctionsdevReport'

const requireEnvironment = (name: string): string => {
	const value = process.env[name]
	if (!value) throw new Error(`${name} is required`)
	return value
}

async function main(): Promise<void> {
	const inputPath = process.argv[2] ?? process.env.AUCTIONSDEV_FRESH_WALLET_REPORT
	if (!inputPath) throw new Error('Usage: bun run preflight:auctionsdev:fresh-wallet <public-report.json>')
	const marketCommit = requireEnvironment('AUCTIONSDEV_MARKET_COMMIT_SHA')
	const environment = requireEnvironment('AUCTIONSDEV_COCO_ENVIRONMENT_ID')
	const result = await verifyFreshAuctionsdevPublicReport(await Bun.file(inputPath).json(), {
		marketCommit,
		account: requireEnvironment('AUCTIONSDEV_ACCOUNT_PUBKEY'),
		environment,
	})
	console.log(
		JSON.stringify({
			schemaVersion: 1,
			profile: 'FRESH_AUCTIONSDEV_TEST',
			verdict: 'FRESH_AUCTIONSDEV_READY',
			marketCommit,
			environment,
			...result,
		}),
	)
}

void main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error))
	process.exitCode = 1
})
