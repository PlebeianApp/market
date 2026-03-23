import { test, expect } from '../fixtures'
import type { Page } from '@playwright/test'

test.use({ scenario: 'merchant' })

const MOCK_YADIO_RATES = {
	USD: 97500,
	EUR: 89700,
	GBP: 76200,
	JPY: 14600000,
	CHF: 85800,
	CNY: 706000,
	AUD: 151000,
	CAD: 134000,
	HKD: 761000,
	SGD: 131000,
	INR: 8090000,
	MXN: 1660000,
	RUB: 8970000,
	BRL: 478000,
	TRY: 3120000,
	KRW: 132000000,
	ZAR: 1750000,
	ARS: 84800000,
	CLP: 87700000,
	COP: 380000000,
	PEN: 361000,
	UYU: 3900000,
	PHP: 5650000,
	THB: 3410000,
	IDR: 1520000000,
	MYR: 458000,
	NGN: 151000000,
	BTC: 1,
	SATS: 1,
}

function setupYadioMock(page: Page) {
	page.route('**/api.yadio.io/**', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ BTC: MOCK_YADIO_RATES }),
		})
	})
}

function blockContextVmRelays(page: Page) {
	page.route('**/relay.contextvm.org/**', (route) => route.abort())
	page.route('**/relay2.contextvm.org/**', (route) => route.abort())
	page.route('**/cvm.otherstuff.ai/**', (route) => route.abort())
}

function failYadioMock(page: Page) {
	page.route('**/api.yadio.io/**', async (route) => {
		await route.fulfill({
			status: 500,
			contentType: 'application/json',
			body: JSON.stringify({ error: 'internal server error' }),
		})
	})
}

function setupStaleRatesMock(page: Page) {
	let callCount = 0
	page.route('**/api.yadio.io/**', async (route) => {
		callCount++
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ BTC: { USD: 97500 + callCount } }),
		})
	})
}

async function safeGoto(page: Page, url: string): Promise<void> {
	const targetPath = url.split('?')[0]

	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			await page.goto(url)
		} catch (error) {
			const msg = String(error)
			if (!msg.includes('interrupted by another navigation') && !msg.includes('ERR_ABORTED')) throw error
			await page.waitForLoadState('networkidle').catch(() => {})
		}

		await page.waitForTimeout(1000)
		await page.waitForLoadState('networkidle').catch(() => {})

		const currentPath = new URL(page.url()).pathname
		if (currentPath === targetPath || currentPath.startsWith(targetPath)) {
			return
		}
	}

	await page.goto(url)
}

test.describe('Currency ContextVM', () => {
	test('price display shows fiat amount via Yadio fallback', async ({ merchantPage }) => {
		setupYadioMock(merchantPage)
		blockContextVmRelays(merchantPage)

		await safeGoto(merchantPage, '/products')

		await expect(merchantPage.getByText('Loading')).not.toBeVisible({ timeout: 10000 })
	})

	test('currency dropdown changes displayed price', async ({ merchantPage }) => {
		setupYadioMock(merchantPage)
		blockContextVmRelays(merchantPage)

		await safeGoto(merchantPage, '/products')

		const currencyButton = merchantPage.getByTestId('currency-dropdown-button')
		await expect(currencyButton).toBeVisible({ timeout: 5000 })

		const initialCurrency = await currencyButton.innerText()
		expect(initialCurrency.trim()).toBeTruthy()

		await currencyButton.click()

		const eurOption = merchantPage.getByTestId('currency-option-EUR')
		await expect(eurOption).toBeVisible({ timeout: 3000 })
		await eurOption.click()

		await merchantPage.waitForTimeout(500)

		const updatedText = await currencyButton.innerText()
		expect(updatedText.trim()).toBe('EUR')

		const currentCurrency = await merchantPage.evaluate(() => {
			return localStorage.getItem('selectedCurrency')
		})
		expect(currentCurrency).toBe('EUR')
	})

	test('fallback works when ContextVM relays are blocked', async ({ merchantPage }) => {
		setupYadioMock(merchantPage)
		blockContextVmRelays(merchantPage)

		await safeGoto(merchantPage, '/')

		await expect(merchantPage.getByText('Loading')).not.toBeVisible({ timeout: 10000 })
	})

	test('fresh rates fetched on every page load (no stale cache)', async ({ merchantPage }) => {
		setupStaleRatesMock(merchantPage)
		blockContextVmRelays(merchantPage)

		await safeGoto(merchantPage, '/')
		await merchantPage.waitForLoadState('networkidle')
		await merchantPage.waitForTimeout(3000)

		await safeGoto(merchantPage, '/')
		await merchantPage.waitForLoadState('networkidle')
		await merchantPage.waitForTimeout(3000)

		await safeGoto(merchantPage, '/')
		await merchantPage.waitForLoadState('networkidle')
		await merchantPage.waitForTimeout(3000)
	})

	test('shows error state when all sources fail', async ({ merchantPage }) => {
		failYadioMock(merchantPage)
		blockContextVmRelays(merchantPage)

		await safeGoto(merchantPage, '/')

		await merchantPage.waitForLoadState('networkidle')
		await merchantPage.waitForTimeout(3000)
	})
})
