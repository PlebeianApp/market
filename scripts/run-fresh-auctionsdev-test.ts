import { chromium } from 'playwright'
import { verifyFreshAuctionsdevPublicReport } from '../src/lib/coco/migration/freshAuctionsdevReport'
import { FRESH_AUCTIONSDEV_PUBLIC_REPORT_STORAGE_KEY } from '../src/lib/coco/migration/freshAuctionsdevBrowser'
import { COCO_AUCTIONSDEV_FAKE_MINT_INFO, COCO_AUCTIONSDEV_SMOKE_SAFE } from '../e2e/coco-auctionsdev-smoke-contract'

const requireEnvironment = (name: string): string => {
	const value = process.env[name]
	if (!value) throw new Error(`${name} is required`)
	return value
}

async function main(): Promise<void> {
	const outputPath = process.argv[2]
	if (!outputPath) throw new Error('Usage: bun scripts/run-fresh-auctionsdev-test.ts <public-report.json>')
	const account = requireEnvironment('AUCTIONSDEV_ACCOUNT_PUBKEY').toLowerCase()
	const marketCommit = requireEnvironment('AUCTIONSDEV_MARKET_COMMIT_SHA')
	const environment = requireEnvironment('AUCTIONSDEV_COCO_ENVIRONMENT_ID')
	if (environment !== 'auctionsdev' && environment !== 'test') throw new Error('Producer environment must be auctionsdev or test')
	const baseUrl =
		process.env.AUCTIONSDEV_BASE_URL ??
		(environment === 'test' ? COCO_AUCTIONSDEV_SMOKE_SAFE.baseUrl : 'https://auctionsdev.plebeian.market')
	const parsedBase = new URL(baseUrl)
	if (
		(environment === 'auctionsdev' && parsedBase.origin !== 'https://auctionsdev.plebeian.market') ||
		(environment === 'test' && !['localhost', '127.0.0.1'].includes(parsedBase.hostname))
	) {
		throw new Error('Preflight producer target is outside the allowed AuctionsDev/test origins')
	}

	const browser = await chromium.launch({ headless: process.env.AUCTIONSDEV_PREFLIGHT_HEADED !== '1' })
	try {
		const context = await browser.newContext({ baseURL: parsedBase.origin, acceptDownloads: false })
		await context.addInitScript(
			({ accountPubkey }) => {
				;(window as unknown as { __freshPreflightRelayWrites: number }).__freshPreflightRelayWrites = 0
				const nativeSend = WebSocket.prototype.send
				WebSocket.prototype.send = function (data: string | ArrayBufferLike | Blob | ArrayBufferView) {
					try {
						const message = typeof data === 'string' ? JSON.parse(data) : null
						if (Array.isArray(message) && message[0] === 'EVENT') {
							;(window as unknown as { __freshPreflightRelayWrites: number }).__freshPreflightRelayWrites += 1
							throw new Error('Disposable fresh-preflight browser blocked a Nostr EVENT publish frame')
						}
					} catch (error) {
						if (error instanceof Error && error.message.includes('blocked a Nostr EVENT publish frame')) throw error
						// Non-JSON WebSocket traffic cannot be a Nostr EVENT frame.
					}
					return nativeSend.call(this, data)
				}
				const unavailable = async (): Promise<never> => {
					throw new Error('Disposable fresh-preflight browser has no signing or encryption authority')
				}
				;(window as unknown as { nostr: unknown }).nostr = {
					getPublicKey: async () => accountPubkey,
					signEvent: unavailable,
					nip04: { encrypt: unavailable, decrypt: unavailable },
					nip44: { encrypt: unavailable, decrypt: unavailable },
				}
				localStorage.setItem('nostr_auto_login', 'true')
				localStorage.setItem('plebeian_terms_accepted', 'true')
			},
			{ accountPubkey: account },
		)
		const page = await context.newPage()
		if (environment === 'test' && process.env.AUCTIONSDEV_TEST_FAKE_MINT_FIXTURE === '1') {
			await page.route(`${COCO_AUCTIONSDEV_SMOKE_SAFE.mintUrl}/v1/info`, (route) =>
				route.fulfill({ json: COCO_AUCTIONSDEV_FAKE_MINT_INFO }),
			)
		}
		await page.goto('/')
		await page.getByTestId('dashboard-button').waitFor({ state: 'visible', timeout: 30_000 })
		await page.getByTestId('wallet-button').click()
		await page.getByRole('button', { name: 'Receive fake eCash' }).click()
		const dialog = page.getByRole('dialog', { name: 'Receive eCash' })
		await dialog.getByRole('button', { name: 'Run fresh-wallet preflight' }).click()
		await page.getByText('Fresh wallet preflight ready').waitFor({ state: 'visible', timeout: 60_000 })
		const report = await page.evaluate((key) => {
			const value = localStorage.getItem(key)
			if (!value) throw new Error('Browser preflight did not expose its public report')
			return JSON.parse(value) as unknown
		}, FRESH_AUCTIONSDEV_PUBLIC_REPORT_STORAGE_KEY)
		const relayWrites = await page.evaluate(
			() => (window as unknown as { __freshPreflightRelayWrites: number }).__freshPreflightRelayWrites,
		)
		if (relayWrites !== 0) throw new Error(`Fresh-wallet preflight attempted ${relayWrites} relay write(s)`)
		const verified = await verifyFreshAuctionsdevPublicReport(report, { marketCommit, account, environment })
		await Bun.write(outputPath, `${JSON.stringify(report, null, 2)}\n`)
		console.log(
			JSON.stringify({
				schemaVersion: 1,
				profile: 'FRESH_AUCTIONSDEV_TEST',
				verdict: 'FRESH_AUCTIONSDEV_READY',
				marketCommit,
				environment,
				outputPath,
				browserProfile: 'disposable-incognito',
				relayWrites,
				...verified,
			}),
		)
	} finally {
		await browser.close()
	}
}

void main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error))
	process.exitCode = 1
})
