import { test, expect } from '../fixtures'
import type { Page } from '@playwright/test'

test.use({ scenario: 'merchant' })

const MOCK_YADIO_RATES = {
	USD: 97500,
	EUR: 89700,
	GBP: 76200,
	JPY: 14600000,
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

async function waitForText(page: Page, locator: ReturnType<Page['locator']>, text: string, timeout = 15000): Promise<void> {
	await expect(async () => {
		const content = await locator.textContent()
		expect(content).toContain(text)
	}).toPass({ timeout })
}

test.describe('BTC price display', () => {
	test('products load and show product cards with sats prices', async ({ merchantPage }) => {
		setupYadioMock(merchantPage)
		blockContextVmRelays(merchantPage)

		await safeGoto(merchantPage, '/products')

		const card = merchantPage.locator('[data-testid="product-card"]').first()
		await expect(card).toBeVisible({ timeout: 20000 })

		const productText = await card.textContent()
		expect(productText).toMatch(/\d[\d,]*\s*sats/i)
	})

	test('product cards show fiat price from exchange rates', async ({ merchantPage }) => {
		setupYadioMock(merchantPage)
		blockContextVmRelays(merchantPage)

		await safeGoto(merchantPage, '/products')

		const card = merchantPage.locator('[data-testid="product-card"]').first()
		await expect(card).toBeVisible({ timeout: 20000 })

		await waitForText(merchantPage, card, 'USD')
	})

	test('currency dropdown switches displayed fiat price to EUR', async ({ merchantPage }) => {
		setupYadioMock(merchantPage)
		blockContextVmRelays(merchantPage)

		await safeGoto(merchantPage, '/products')

		const card = merchantPage.locator('[data-testid="product-card"]').first()
		await expect(card).toBeVisible({ timeout: 20000 })

		const currencyButton = merchantPage.getByTestId('currency-dropdown-button')
		await expect(currencyButton).toBeVisible({ timeout: 5000 })
		await currencyButton.click()

		const eurOption = merchantPage.getByTestId('currency-option-EUR')
		await expect(eurOption).toBeVisible({ timeout: 5000 })
		await eurOption.click()

		await merchantPage.waitForTimeout(2000)

		const updatedText = await currencyButton.innerText()
		expect(updatedText.trim()).toBe('EUR')

		await waitForText(merchantPage, card, 'EUR')
	})

	test('product detail page shows price', async ({ merchantPage }) => {
		setupYadioMock(merchantPage)
		blockContextVmRelays(merchantPage)

		await safeGoto(merchantPage, '/products')

		const firstCard = merchantPage.locator('[data-testid="product-card"]').first()
		await expect(firstCard).toBeVisible({ timeout: 20000 })
		await firstCard.click()

		await merchantPage.waitForLoadState('networkidle')

		await expect(merchantPage.getByText(/\d[\d,]*\s*sats/i).first()).toBeVisible({ timeout: 10000 })
	})

	test('fiat price is a reasonable number (not NaN, not zero)', async ({ merchantPage }) => {
		setupYadioMock(merchantPage)
		blockContextVmRelays(merchantPage)

		await safeGoto(merchantPage, '/products')

		const card = merchantPage.locator('[data-testid="product-card"]').first()
		await expect(card).toBeVisible({ timeout: 20000 })

		await expect(async () => {
			const cardText = await card.textContent()
			const match = cardText.match(/[\d,.]+\s*(USD|EUR|GBP|JPY)/i)
			expect(match).not.toBeNull()
			if (!match) return
			const numStr = match[0].replace(/[^0-9.]/g, '')
			const num = parseFloat(numStr)
			expect(num).toBeGreaterThan(0)
			expect(num).toBeLessThan(1000000)
		}).toPass({ timeout: 15000 })
	})
})
