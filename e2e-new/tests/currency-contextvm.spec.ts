import { test, expect } from '../fixtures'
import type { Page } from '@playwright/test'

test.use({ scenario: 'merchant' })

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

async function waitForFiatPrice(page: Page, locator: ReturnType<Page['locator']>, timeout = 20000): Promise<string> {
	let lastText = ''
	await expect(async () => {
		lastText = (await locator.textContent()) || ''
		expect(lastText).toMatch(/\d[\d,.]+\s*(USD|EUR|GBP|JPY|CHF|CAD|AUD)/i)
	}).toPass({ timeout })
	return lastText
}

test.describe('Currency ContextVM', () => {
	test('price display shows real fiat amount from exchange rates', async ({ merchantPage }) => {
		await safeGoto(merchantPage, '/products')

		const card = merchantPage.locator('[data-testid="product-card"]').first()
		await expect(card).toBeVisible({ timeout: 20000 })

		const cardText = await waitForFiatPrice(merchantPage, card)

		const fiatMatch = cardText.match(/([\d,.]+)\s*(USD|EUR|GBP|JPY|CHF|CAD|AUD)/i)
		expect(fiatMatch).not.toBeNull()
		if (fiatMatch) {
			console.log(`  Real fiat price displayed: ${fiatMatch[1]} ${fiatMatch[2]}`)
		}
	})

	test('currency dropdown changes displayed price to real EUR rate', async ({ merchantPage }) => {
		await safeGoto(merchantPage, '/products')

		const currencyButton = merchantPage.getByTestId('currency-dropdown-button')
		await expect(currencyButton).toBeVisible({ timeout: 5000 })

		const initialCurrency = await currencyButton.innerText()
		expect(initialCurrency.trim()).toBeTruthy()

		await currencyButton.click()

		const eurOption = merchantPage.getByTestId('currency-option-EUR')
		await expect(eurOption).toBeVisible({ timeout: 3000 })
		await eurOption.click()

		await merchantPage.waitForTimeout(2000)

		const updatedText = await currencyButton.innerText()
		expect(updatedText.trim()).toBe('EUR')

		const card = merchantPage.locator('[data-testid="product-card"]').first()
		const cardText = await waitForFiatPrice(merchantPage, card)

		const eurMatch = cardText.match(/([\d,.]+)\s*EUR/i)
		expect(eurMatch).not.toBeNull()
		if (eurMatch) {
			console.log(`  Real EUR price after switch: ${eurMatch[1]} EUR`)
		}

		const currentCurrency = await merchantPage.evaluate(() => {
			return localStorage.getItem('selectedCurrency')
		})
		expect(currentCurrency).toBe('EUR')
	})
})
