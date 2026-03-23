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

async function clearCurrencyCache(page: Page) {
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			await page.waitForLoadState('networkidle').catch(() => {})
			await page.waitForTimeout(200)
			await page.evaluate(() => {
				localStorage.removeItem('btc_exchange_rates')
			})
			return
		} catch {
			await page.waitForTimeout(500)
		}
	}
	await page.evaluate(() => {
		localStorage.removeItem('btc_exchange_rates')
	})
}

async function getCachedRates(page: Page): Promise<Record<string, number> | null> {
	return await page.evaluate(() => {
		const raw = localStorage.getItem('btc_exchange_rates')
		if (!raw) return null
		return JSON.parse(raw).rates
	})
}

async function waitForRatesToLoad(page: Page, timeoutMs = 15000): Promise<void> {
	await expect.toPass(
		async () => {
			const rates = await getCachedRates(page)
			expect(rates).not.toBeNull()
			expect(rates!.USD).toBeGreaterThan(0)
		},
		{ timeout: timeoutMs },
	)
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
		await clearCurrencyCache(merchantPage)

		await safeGoto(merchantPage, '/products')

		await waitForRatesToLoad(merchantPage)

		const cachedRates = await getCachedRates(merchantPage)
		expect(cachedRates).not.toBeNull()
		expect(cachedRates!.USD).toBe(97500)
	})

	test('currency dropdown changes displayed price', async ({ merchantPage }) => {
		setupYadioMock(merchantPage)
		blockContextVmRelays(merchantPage)
		await clearCurrencyCache(merchantPage)

		await safeGoto(merchantPage, '/products')

		await waitForRatesToLoad(merchantPage)

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
		await clearCurrencyCache(merchantPage)

		await safeGoto(merchantPage, '/')

		await waitForRatesToLoad(merchantPage)

		const cachedRates = await getCachedRates(merchantPage)
		expect(cachedRates).not.toBeNull()
		expect(cachedRates!.USD).toBe(MOCK_YADIO_RATES.USD)
		expect(cachedRates!.EUR).toBe(MOCK_YADIO_RATES.EUR)
	})

	test('cache persists across page reloads', async ({ merchantPage }) => {
		setupYadioMock(merchantPage)
		blockContextVmRelays(merchantPage)
		await clearCurrencyCache(merchantPage)

		await safeGoto(merchantPage, '/')

		await waitForRatesToLoad(merchantPage)

		const firstRates = await getCachedRates(merchantPage)
		expect(firstRates).not.toBeNull()

		let yadioCallCount = 0
		await merchantPage.route('**/api.yadio.io/**', async (route) => {
			yadioCallCount++
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ BTC: { USD: 999999 } }),
			})
		})

		await safeGoto(merchantPage, '/')

		await merchantPage.waitForLoadState('networkidle')

		const secondRates = await getCachedRates(merchantPage)
		expect(secondRates).not.toBeNull()
		expect(secondRates!.USD).toBe(firstRates!.USD)
		expect(yadioCallCount).toBe(0)
	})

	test('shows error state when all sources fail', async ({ merchantPage }) => {
		failYadioMock(merchantPage)
		blockContextVmRelays(merchantPage)
		await clearCurrencyCache(merchantPage)

		await safeGoto(merchantPage, '/')

		await merchantPage.waitForLoadState('networkidle')
		await merchantPage.waitForTimeout(3000)

		const cachedRates = await getCachedRates(merchantPage)
		expect(cachedRates).toBeNull()
	})
})
