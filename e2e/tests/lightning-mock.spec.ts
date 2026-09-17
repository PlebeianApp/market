import { test, expect } from '../fixtures'
import type { Page } from '@playwright/test'
import { LightningMock, LNURL_SERVER_PK, MOCK_LNURL_DOMAIN } from '../utils/lightning-mock'

/**
 * Regression coverage for the LightningMock HTTP layer.
 *
 * Per maximotodev's review on PR #1191: the invoice callback handler must not
 * shadow LNURL-pay discovery, and both response shapes need explicit coverage.
 * Playwright evaluates routes in reverse registration order, so a broad
 * `https://<domain>/**` callback glob would swallow `.well-known/lnurlp/*`
 * discovery requests. These tests pin each shape independently and verify the
 * two handlers stay disjoint.
 *
 * No app navigation is required: requests are issued from a blank page, so the
 * only routes exercised are the ones LightningMock registers.
 */

/** Fetch a URL from inside the page; returns status, content type and parsed body. */
async function fetchJson(page: Page, url: string): Promise<{ status: number; contentType: string | null; body: any }> {
	return page.evaluate(async (u: string) => {
		const res = await fetch(u)
		return { status: res.status, contentType: res.headers.get('content-type'), body: await res.json() }
	}, url)
}

test.describe('Lightning Mock', () => {
	test('serves LNURL-pay discovery metadata for .well-known/lnurlp requests', async ({ page }) => {
		await LightningMock.setup(page)
		await page.goto('about:blank')

		const discovery = await fetchJson(page, `https://${MOCK_LNURL_DOMAIN}/.well-known/lnurlp/plebeianuser`)

		expect(discovery.status).toBe(200)
		expect(discovery.contentType).toContain('application/json')
		expect(discovery.body.tag).toBe('payRequest')
		expect(discovery.body.callback).toBe(`https://${MOCK_LNURL_DOMAIN}/lnurlp/callback`)
		expect(discovery.body.nostrPubkey).toBe(LNURL_SERVER_PK)
		expect(discovery.body.minSendable).toBeGreaterThan(0)
		expect(discovery.body.maxSendable).toBeGreaterThanOrEqual(discovery.body.minSendable)
		expect(JSON.parse(discovery.body.metadata)).toEqual([['text/plain', 'Mock LNURL for e2e tests']])
		// Discovery must answer with metadata, never the invoice shape.
		expect(discovery.body.pr).toBeUndefined()
		expect(discovery.body.routes).toBeUndefined()
	})

	test('serves invoice JSON for callback requests and captures zap request state', async ({ page }) => {
		const mock = await LightningMock.setup(page)
		await page.goto('about:blank')

		const zapRequest = encodeURIComponent(JSON.stringify({ kind: 9734, content: '', created_at: 1, tags: [['p', '00'.repeat(32)]] }))
		const first = await fetchJson(page, `https://${MOCK_LNURL_DOMAIN}/lnurlp/callback?amount=21000&nostr=${zapRequest}`)

		expect(first.status).toBe(200)
		expect(first.body.pr).toMatch(/^lnbc21000n1mock/)
		expect(first.body.routes).toEqual([])
		// The callback must answer with an invoice, never discovery metadata.
		expect(first.body.tag).toBeUndefined()

		// The mock exposes the captured invoice + zap request for assertions.
		expect(mock.lastBolt11).toBe(first.body.pr)
		expect(mock.lastZapRequest).toBeTruthy()
		expect(mock.zapRequestsByBolt11.get(first.body.pr)).toBeTruthy()

		// Each callback generates a distinct invoice (mock counter increments).
		const second = await fetchJson(page, `https://${MOCK_LNURL_DOMAIN}/lnurlp/callback?amount=21000&nostr=${zapRequest}`)
		expect(second.body.pr).toMatch(/^lnbc21000n1mock/)
		expect(second.body.pr).not.toBe(first.body.pr)
	})

	test('callback handler does not shadow LNURL discovery (reverse route order)', async ({ page }) => {
		await LightningMock.setup(page)
		await page.goto('about:blank')

		// Exercise the callback first, then verify discovery still returns
		// LNURL-pay metadata — the shadowing regression flagged in review.
		const callback = await fetchJson(page, `https://${MOCK_LNURL_DOMAIN}/lnurlp/callback?amount=1000`)
		expect(callback.body.pr).toMatch(/^lnbc1000n1mock/)

		const discovery = await fetchJson(page, `https://${MOCK_LNURL_DOMAIN}/.well-known/lnurlp/plebeianuser`)
		expect(discovery.body.tag).toBe('payRequest')
		expect(discovery.body.pr).toBeUndefined()
	})
})
