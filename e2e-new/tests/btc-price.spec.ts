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

test.describe('BTC price display', () => {
	test('products load and show product cards with sats prices', async ({ merchantPage }) => {
		await safeGoto(merchantPage, '/products')

		const card = merchantPage.locator('[data-testid="product-card"]').first()
		await expect(card).toBeVisible({ timeout: 20000 })

		const productText = await card.textContent()
		expect(productText).toMatch(/\d[\d,]*\s*sats/i)
	})

	test('product cards show fiat price from real exchange rates', async ({ merchantPage }) => {
		await safeGoto(merchantPage, '/products')

		const card = merchantPage.locator('[data-testid="product-card"]').first()
		await expect(card).toBeVisible({ timeout: 20000 })

		const cardText = await waitForFiatPrice(merchantPage, card)

		const fiatMatch = cardText.match(/([\d,.]+)\s*(USD|EUR|GBP|JPY|CHF|CAD|AUD)/i)
		expect(fiatMatch).not.toBeNull()
		if (fiatMatch) {
			console.log(`  Real fiat price found: ${fiatMatch[1]} ${fiatMatch[2]}`)
		}
	})

	test('currency dropdown switches displayed fiat price to EUR', async ({ merchantPage }) => {
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

		const cardText = await waitForFiatPrice(merchantPage, card)

		const eurMatch = cardText.match(/([\d,.]+)\s*EUR/i)
		expect(eurMatch).not.toBeNull()
		if (eurMatch) {
			console.log(`  Real EUR price found: ${eurMatch[1]} EUR`)
		}
	})

	test('product detail page shows price', async ({ merchantPage }) => {
		await safeGoto(merchantPage, '/products')

		const firstCard = merchantPage.locator('[data-testid="product-card"]').first()
		await expect(firstCard).toBeVisible({ timeout: 20000 })
		await firstCard.click()

		await merchantPage.waitForLoadState('networkidle')

		const satsText = merchantPage.getByText(/\d[\d,]*\s*sats/i).first()
		await expect(satsText).toBeVisible({ timeout: 10000 })

		const priceContent = await satsText.textContent()
		console.log(`  Product detail sats price: ${priceContent}`)
	})

	test('fiat price is a reasonable number (not NaN, not zero)', async ({ merchantPage }) => {
		await safeGoto(merchantPage, '/products')

		const card = merchantPage.locator('[data-testid="product-card"]').first()
		await expect(card).toBeVisible({ timeout: 20000 })

		const cardText = await waitForFiatPrice(merchantPage, card)

		const match = cardText.match(/([\d,.]+)\s*(USD|EUR|GBP|JPY|CHF|CAD|AUD)/i)
		expect(match).not.toBeNull()
		if (match) {
			const numStr = match[1].replace(/,/g, '')
			const num = parseFloat(numStr)
			expect(num).toBeGreaterThan(0)
			expect(num).toBeLessThan(500000)
			console.log(`  Verified real price: ${match[1]} ${match[2]}`)
		}
	})
})
