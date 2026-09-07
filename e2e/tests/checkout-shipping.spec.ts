import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'

const seededPhysicalProducts = ['Bitcoin Hardware Wallet', 'Nostr T-Shirt']

async function addSeededProductsAndOpenCheckout(page: Page, productNames: string[]): Promise<void> {
	await page.goto('/products')

	for (const productName of productNames) {
		const productCard = page.locator('[data-testid="product-card"]').filter({ hasText: productName })
		await expect(productCard).toBeVisible({ timeout: 15_000 })
		await productCard.getByRole('button', { name: /add to cart/i }).click()
		await expect(productCard.getByRole('button', { name: /add/i })).toBeVisible()
	}

	await page
		.getByRole('button')
		.filter({ has: page.locator('.i-basket') })
		.click()

	const cartDialog = page.getByRole('dialog', { name: /your cart/i })
	await expect(cartDialog).toBeVisible()
	await cartDialog.getByRole('button', { name: /^checkout$/i }).click()
	await expect(page.getByText('Shipping Address', { exact: true })).toBeVisible({ timeout: 15_000 })
}

async function selectShippingForItem(page: Page, itemIndex: number, optionName: string, expectedSelectorCount: number): Promise<void> {
	const cartSummary = page.locator('[data-slot="card"]:visible').filter({ has: page.getByText('Cart Summary', { exact: true }) })
	const shippingSelectors = cartSummary.getByRole('combobox')

	await expect(shippingSelectors).toHaveCount(expectedSelectorCount)
	await shippingSelectors.nth(itemIndex).click()
	await page.getByRole('option', { name: new RegExp(optionName, 'i') }).click()
}

async function fillPhysicalDeliveryAddress(page: Page): Promise<void> {
	await page.locator('#name').fill('E2E Test Buyer')
	await page.locator('#firstLineOfAddress').fill('123 Test Street')
	await page.locator('#zipPostcode').fill('SW1A 1AA')
	await page.locator('#country').fill('United Kingdom')
	await page.locator('[data-country-item]').filter({ hasText: 'United Kingdom' }).first().click()
	await page.locator('#city').fill('London')
	await page.keyboard.press('Escape')
}

test.describe('Checkout shipping selection', () => {
	test.use({ scenario: 'merchant' })

	test('blocks only unselected seeded items, then allows checkout once their shipping options resolve', async ({ buyerPage }) => {
		test.setTimeout(60_000)
		await addSeededProductsAndOpenCheckout(buyerPage, seededPhysicalProducts)

		const continueButton = buyerPage.locator('button[form="shipping-form"]')
		const missingShippingWarning = buyerPage.getByText('Please select shipping options for all items in your cart.')
		const unresolvedShippingError = buyerPage.getByText(
			'Delivery requirements could not be verified for the selected shipping options. Please reselect shipping before continuing.',
		)

		// A missing selection is the one expected blocking state.
		await expect(missingShippingWarning).toBeVisible()
		await expect(unresolvedShippingError).not.toBeVisible()
		await expect(continueButton).toBeDisabled()

		await selectShippingForItem(buyerPage, 0, 'Worldwide Standard', seededPhysicalProducts.length)

		// Selecting one item is not enough: the warning remains until every item has a method.
		await expect(missingShippingWarning).toBeVisible()
		await expect(continueButton).toBeDisabled()

		await selectShippingForItem(buyerPage, 1, 'Worldwide Standard', seededPhysicalProducts.length)

		// Seeded addressable shipping references must resolve normally after selection.
		await expect(missingShippingWarning).not.toBeVisible()
		await expect(unresolvedShippingError).not.toBeVisible()
		await expect(continueButton).toBeEnabled({ timeout: 15_000 })

		await fillPhysicalDeliveryAddress(buyerPage)
		await continueButton.click()
		await expect(buyerPage.getByText('Order Summary')).toBeVisible({ timeout: 15_000 })
	})
})

test.describe('Checkout unresolved shipping selection', () => {
	test.use({ scenario: 'merchant-unresolved-shipping' })

	test('shows the unresolved-delivery error only for an unsupported selected shipping service', async ({ buyerPage }) => {
		test.setTimeout(60_000)
		// The merchant-unresolved-shipping scenario seeds this product and its
		// selectable shipping event specifically for the failure-state assertion.
		await addSeededProductsAndOpenCheckout(buyerPage, ['Unresolved Shipping E2E Product'])

		const continueButton = buyerPage.locator('button[form="shipping-form"]')
		const missingShippingWarning = buyerPage.getByText('Please select shipping options for all items in your cart.')
		const unresolvedShippingError = buyerPage.getByText(
			'Delivery requirements could not be verified for the selected shipping options. Please reselect shipping before continuing.',
		)

		await expect(missingShippingWarning).toBeVisible()
		await expect(unresolvedShippingError).not.toBeVisible()

		await selectShippingForItem(buyerPage, 0, 'Unsupported E2E Delivery', 1)

		await expect(missingShippingWarning).not.toBeVisible()
		await expect(unresolvedShippingError).toBeVisible({ timeout: 15_000 })
		await expect(continueButton).toBeDisabled()
	})
})
