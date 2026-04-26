import { test, expect } from '../fixtures'

test.use({ scenario: 'merchant' })

test.describe('Shipping Option Creation', () => {
	test('creates shipping option using a template', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		await merchantPage.goto('/dashboard/products/shipping-options')

		// Wait for existing seeded shipping options to load
		await expect(merchantPage.getByText('Worldwide Standard').first()).toBeVisible({ timeout: 15_000 })
		await expect(merchantPage.getByText('Digital Delivery').first()).toBeVisible()

		// Click the "Add Shipping Option" button in the header to show the form
		await merchantPage.getByRole('button', { name: /Add Shipping Option/i }).click()

		// Wait for the form to appear
		await expect(merchantPage.locator('[data-testid="shipping-template-select"]')).toBeVisible({ timeout: 5_000 })

		// Select the "North America" template
		await merchantPage.locator('[data-testid="shipping-template-select"]').click()
		await merchantPage.locator('[data-testid="template-north-america"]').click()

		// Verify template auto-filled the title and price
		await expect(merchantPage.locator('[data-testid="shipping-title-input"]')).toHaveValue('North America')
		await expect(merchantPage.locator('[data-testid="shipping-price-input"]')).toHaveValue('0')

		// Customize the form
		await merchantPage.locator('[data-testid="shipping-title-input"]').clear()
		await merchantPage.locator('[data-testid="shipping-title-input"]').fill('Standard North America')
		await merchantPage.locator('[data-testid="shipping-price-input"]').clear()
		await merchantPage.locator('[data-testid="shipping-price-input"]').fill('8000')
		await merchantPage.locator('[data-testid="shipping-description-input"]').fill('Standard shipping to North America')

		// Submit
		await merchantPage.locator('[data-testid="shipping-submit-button"]').click()

		// Verify it appears in the list (form collapses, list updates)
		await expect(merchantPage.getByText('Standard North America').first()).toBeVisible({ timeout: 10_000 })
	})

	test('creates shipping option with manual country selection', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		await merchantPage.goto('/dashboard/products/shipping-options')

		// Wait for page to load
		await expect(merchantPage.getByText('Worldwide Standard').first()).toBeVisible({ timeout: 15_000 })

		// Click the "Add Shipping Option" button in the header to show the form
		await merchantPage.getByRole('button', { name: /Add Shipping Option/i }).click()

		// Wait for the form to appear
		await expect(merchantPage.locator('[data-testid="shipping-title-input"]')).toBeVisible({ timeout: 5_000 })

		// Fill in title
		await merchantPage.locator('[data-testid="shipping-title-input"]').fill('Express Europe')

		// Select Express service type
		await merchantPage.locator('[data-testid="shipping-service-select"]').click()
		await merchantPage.locator('[data-testid="service-express"]').click()

		// Set price
		await merchantPage.locator('[data-testid="shipping-price-input"]').clear()
		await merchantPage.locator('[data-testid="shipping-price-input"]').fill('15000')

		// Add countries manually
		await merchantPage.locator('[data-testid="shipping-country-select"]').click()
		await merchantPage.locator('[data-testid="country-gbr"]').click()

		await merchantPage.locator('[data-testid="shipping-country-select"]').click()
		await merchantPage.locator('[data-testid="country-deu"]').click()

		// Verify country badges appear within the form
		const formArea = merchantPage.locator('[data-testid="add-shipping-option-button"]')
		await expect(formArea.getByText('United Kingdom')).toBeVisible()
		await expect(formArea.getByText('Germany')).toBeVisible()

		// Fill description
		await merchantPage.locator('[data-testid="shipping-description-input"]').fill('Express shipping to Europe')

		// Submit
		await merchantPage.locator('[data-testid="shipping-submit-button"]').click()

		// Verify it appears in the list
		await expect(merchantPage.getByText('Express Europe').first()).toBeVisible({ timeout: 10_000 })
	})

	test('creates worldwide shipping option using checkbox', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		await merchantPage.goto('/dashboard/products/shipping-options')

		// Wait for page to load
		await expect(merchantPage.getByText('Worldwide Standard').first()).toBeVisible({ timeout: 15_000 })

		// Click the "Add Shipping Option" button in the header to show the form
		await merchantPage.getByRole('button', { name: /Add Shipping Option/i }).click()

		// Wait for the form to appear
		await expect(merchantPage.locator('[data-testid="shipping-title-input"]')).toBeVisible({ timeout: 5_000 })

		// Fill in title and price
		await merchantPage.locator('[data-testid="shipping-title-input"]').fill('Global Economy')
		await merchantPage.locator('[data-testid="shipping-price-input"]').clear()
		await merchantPage.locator('[data-testid="shipping-price-input"]').fill('12000')

		// Check the worldwide checkbox
		await merchantPage.locator('[data-testid="worldwide-checkbox"]').click()

		// Verify the country select is disabled
		await expect(merchantPage.locator('[data-testid="shipping-country-select"]')).toBeDisabled()

		// Fill description
		await merchantPage.locator('[data-testid="shipping-description-input"]').fill('Economy shipping worldwide')

		// Submit
		await merchantPage.locator('[data-testid="shipping-submit-button"]').click()

		// Verify it appears in the list
		await expect(merchantPage.getByText('Global Economy').first()).toBeVisible({ timeout: 10_000 })
	})
})
