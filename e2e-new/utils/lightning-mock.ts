/**
 * Lightning payment mock for e2e tests.
 *
 * Intercepts LNURL HTTP requests, injects a WebLN mock, and publishes
 * NIP-57 zap receipts to the local relay so the app's payment processor
 * confirms via the `zap_receipt` path.
 *
 * Usage:
 *   const lnMock = await LightningMock.setup(page)
 *   // … trigger payment in the UI …
 *   // payment auto-completes via WebLN → zap receipt
 */

import type { Page } from '@playwright/test'
import { finalizeEvent, type EventTemplate } from 'nostr-tools/pure'
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay'
import { getPublicKey } from 'nostr-tools/pure'
import { hexToBytes } from '@noble/hashes/utils'
import WebSocket from 'ws'
import { RELAY_URL } from '../test-config'

useWebSocketImplementation(WebSocket)

// Fixed LNURL server keypair — signs zap receipts and is returned as `nostrPubkey`
// in LNURL-pay metadata so the app trusts the receipts.
const LNURL_SERVER_SK = 'e2e1111111111111111111111111111111111111111111111111111111111111'
const LNURL_SERVER_PK = getPublicKey(hexToBytes(LNURL_SERVER_SK))

// Mock domain used in the LNURL callback URL. Playwright intercepts requests
// to this domain so no real DNS resolution happens.
const MOCK_LNURL_DOMAIN = 'mock-lnurl.e2e.test'

let invoiceCounter = 0

export class LightningMock {
	/** The last zap request (Kind 9734 JSON) captured from an LNURL callback. */
	lastZapRequest: string | null = null

	/** The last BOLT11 invoice string returned by the mock. */
	lastBolt11: string | null = null

	/** All invoices "paid" via the WebLN mock. */
	paidInvoices: string[] = []

	/** Maps each bolt11 to its corresponding zap request JSON (for multi-invoice scenarios). */
	zapRequestsByBolt11: Map<string, string> = new Map()

	private constructor() {}

	/**
	 * Set up all three mock layers on a Playwright page:
	 *  1. LNURL HTTP interception
	 *  2. WebLN browser mock
	 *  3. Zap receipt bridge (browser → Node.js → relay)
	 *
	 * Must be called BEFORE the page navigates to the app.
	 */
	static async setup(page: Page): Promise<LightningMock> {
		const mock = new LightningMock()

		// --- Layer 3: Expose Node.js function to browser ---
		// When WebLN "pays" an invoice, the browser calls this function which
		// publishes a Kind 9735 zap receipt to the local relay.
		await page.exposeFunction('__e2eOnLightningPayment', async (bolt11: string) => {
			mock.paidInvoices.push(bolt11)
			await mock.publishZapReceipt(bolt11)
		})

		// --- Layer 2: Inject WebLN mock ---
		await page.addInitScript(() => {
			;(window as any).webln = {
				enable: async () => {},
				sendPayment: async (bolt11: string) => {
					// Bridge to Node.js to publish zap receipt
					await (window as any).__e2eOnLightningPayment(bolt11)
					return {}
				},
			}
		})

		// --- Layer 1: Intercept LNURL HTTP requests ---

		// LNURL-pay discovery: any request to .well-known/lnurlp/
		await page.route('**/.well-known/lnurlp/*', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					callback: `https://${MOCK_LNURL_DOMAIN}/lnurlp/callback`,
					maxSendable: 100_000_000_000, // 100k sats in msats
					minSendable: 1_000, // 1 sat in msats
					metadata: JSON.stringify([['text/plain', 'Mock LNURL for e2e tests']]),
					tag: 'payRequest',
					allowsNostr: true,
					nostrPubkey: LNURL_SERVER_PK,
				}),
			})
		})

		// LNURL callback: invoice generation
		await page.route(`https://${MOCK_LNURL_DOMAIN}/**`, async (route) => {
			const url = new URL(route.request().url())

			// Extract amount for a more realistic-looking invoice
			const amountMsats = url.searchParams.get('amount') || '21000'

			// Generate a fake but unique BOLT11 string
			const bolt11 = `lnbc${amountMsats}n1mock${++invoiceCounter}${Date.now()}`
			mock.lastBolt11 = bolt11

			// Capture zap request if present (Kind 9734 JSON, URL-encoded)
			const nostrParam = url.searchParams.get('nostr')
			if (nostrParam) {
				mock.lastZapRequest = nostrParam
				mock.zapRequestsByBolt11.set(bolt11, nostrParam)
			}

			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					pr: bolt11,
					routes: [],
				}),
			})
		})

		return mock
	}

	/**
	 * Publish a Kind 9735 zap receipt to the local relay.
	 * Called automatically by the WebLN mock after "paying" an invoice.
	 */
	private async publishZapReceipt(bolt11: string): Promise<void> {
		const relay = await Relay.connect(RELAY_URL)

		try {
			const tags: string[][] = [['bolt11', bolt11]]

			// Look up the zap request for this specific bolt11, falling back to the last one
			const zapRequestJson = this.zapRequestsByBolt11.get(bolt11) || this.lastZapRequest

			// Extract recipient pubkey and zap request from stored state
			if (zapRequestJson) {
				try {
					const zapRequest = JSON.parse(zapRequestJson)
					tags.push(['description', zapRequestJson])

					// Extract 'p' tag from zap request
					const pTag = zapRequest.tags?.find((t: string[]) => t[0] === 'p')
					if (pTag) {
						tags.push(['p', pTag[1]])
					}

					// Extract 'e' tag from zap request (event being zapped)
					const eTag = zapRequest.tags?.find((t: string[]) => t[0] === 'e')
					if (eTag) {
						tags.push(['e', eTag[1]])
					}
				} catch {
					// If parsing fails, still publish with just the bolt11 tag
				}
			}

			const template: EventTemplate = {
				kind: 9735,
				created_at: Math.floor(Date.now() / 1000),
				content: '',
				tags,
			}

			const event = finalizeEvent(template, hexToBytes(LNURL_SERVER_SK))
			await relay.publish(event)
		} finally {
			relay.close()
		}
	}
}

export { LNURL_SERVER_PK, MOCK_LNURL_DOMAIN }
