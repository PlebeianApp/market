import type { Page } from '@playwright/test'

/**
 * A structurally valid-looking BOLT11 invoice prefix for tests.
 * Not decodable by real Lightning software, but satisfies the UI checks
 * that expect a string starting with "lnbc".
 */
const FAKE_BOLT11 =
	'lnbc500u1pjtest0pp5qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsp5qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq9q7sqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqgpqysgqa0a0a'

export interface LnurlMockOptions {
	/** The Lightning address domain to intercept (default: coinos.io) */
	domain?: string
	/** The Lightning address username to intercept (default: plebeianuser) */
	username?: string
	/** The minSendable in millisats (default: 1_000 = 1 sat) */
	minSendable?: number
	/** The maxSendable in millisats (default: 100_000_000_000 = 100k sats) */
	maxSendable?: number
	/** Override the bolt11 invoice returned (default: FAKE_BOLT11) */
	bolt11?: string
	/** If true, return allowsNostr: true in metadata (default: true) */
	allowsNostr?: boolean
	/** If true, the callback will return an error instead of an invoice */
	failCallback?: boolean
}

/**
 * Sets up Playwright route mocks to intercept LNURL-pay HTTP calls.
 *
 * The app uses @getalby/lightning-tools LightningAddress class, which:
 * 1. Fetches LNURL-pay metadata from `https://<domain>/.well-known/lnurlp/<username>`
 * 2. Requests an invoice from the callback URL with `?amount=<milliSats>`
 *
 * This mock intercepts both requests so no real HTTP calls leave the browser.
 */
export async function setupLnurlMock(page: Page, options?: LnurlMockOptions): Promise<void> {
	const domain = options?.domain ?? 'coinos.io'
	const username = options?.username ?? 'plebeianuser'
	const bolt11 = options?.bolt11 ?? FAKE_BOLT11
	const minSendable = options?.minSendable ?? 1_000
	const maxSendable = options?.maxSendable ?? 100_000_000_000
	const allowsNostr = options?.allowsNostr ?? true
	const callbackUrl = `https://${domain}/lnurlp/${username}/callback`

	// 1. Intercept LNURL-pay metadata request
	await page.route(`https://${domain}/.well-known/lnurlp/${username}`, (route) => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				callback: callbackUrl,
				minSendable,
				maxSendable,
				metadata: JSON.stringify([['text/plain', `Payment to ${username}`]]),
				tag: 'payRequest',
				allowsNostr,
				nostrPubkey: '0'.repeat(64),
			}),
		})
	})

	// 2. Intercept invoice generation callback
	await page.route(`https://${domain}/lnurlp/${username}/callback**`, (route) => {
		if (options?.failCallback) {
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					status: 'ERROR',
					reason: 'Mocked failure for testing',
				}),
			})
			return
		}

		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				pr: bolt11,
				routes: [],
			}),
		})
	})
}
