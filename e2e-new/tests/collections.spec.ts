import { test, expect } from '../fixtures'

test.use({ scenario: 'merchant' })

/**
 * Navigate to a dashboard page, handling the SPA redirect race condition.
 * The app's async auth initialization can briefly redirect to '/' when
 * navigating via full page load. This helper retries navigation if needed.
 */
async function gotoDashboard(page: import('@playwright/test').Page, path: string) {
	try {
		await page.goto(path, { waitUntil: 'domcontentloaded' })
	} catch {
		// SPA auth init can redirect to '/' mid-navigation — wait and retry
		await page.waitForTimeout(2_000)
		await page.goto(path, { waitUntil: 'domcontentloaded' })
	}
	// If we landed on the wrong page, retry once more after auth settles
	if (!page.url().includes(path.replace(/\/$/, ''))) {
		await page.waitForTimeout(2_000)
		await page.goto(path, { waitUntil: 'domcontentloaded' })
	}
}

test.describe('Collection Management', () => {
	test('collections list page is accessible', async ({ merchantPage }) => {
		await gotoDashboard(merchantPage, '/dashboard/products/collections')

		// The page heading should be visible
		await expect(merchantPage.getByRole('heading', { name: /collections/i })).toBeVisible({ timeout: 10_000 })

		// The "Create A Collection" button should be visible
		await expect(merchantPage.getByTestId('add-collection-button')).toBeVisible()
	})

	test('can create a new collection', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		await gotoDashboard(merchantPage, '/dashboard/products/collections')
		await expect(merchantPage.getByRole('heading', { name: /collections/i })).toBeVisible({ timeout: 10_000 })

		// Click "Create A Collection"
		await merchantPage.getByTestId('add-collection-button').click()

		// --- Info Tab ---
		const nameInput = merchantPage.getByTestId('collection-name-input')
		await expect(nameInput).toBeVisible({ timeout: 5_000 })
		await nameInput.fill('E2E Summer Collection')

		const descriptionInput = merchantPage.getByTestId('collection-description-input')
		await descriptionInput.fill('A curated selection of summer products.')

		// Optionally fill summary
		const summaryInput = merchantPage.getByTestId('collection-summary-input')
		await summaryInput.fill('Summer essentials')

		// Click Next to go to Products tab
		await merchantPage.getByTestId('collection-form-next').click()

		// --- Products Tab ---
		await expect(merchantPage.getByTestId('collection-tab-products')).toHaveAttribute('data-state', 'active')

		// Select some seeded products if available
		const productCheckbox = merchantPage.getByRole('checkbox').first()
		const hasProducts = await productCheckbox.isVisible({ timeout: 3_000 }).catch(() => false)
		if (hasProducts) {
			await productCheckbox.check()
		}

		// Click Next to go to Shipping tab
		await merchantPage.getByTestId('collection-form-next').click()

		// --- Shipping Tab ---
		await expect(merchantPage.getByTestId('collection-tab-shipping')).toHaveAttribute('data-state', 'active')

		// Add a shipping option if available (seeded from merchant scenario)
		const addShippingBtn = merchantPage.getByTestId('add-shipping-option-worldwide-standard')
		const hasShipping = await addShippingBtn.isVisible({ timeout: 3_000 }).catch(() => false)
		if (hasShipping) {
			await addShippingBtn.click()
		}

		// Click "Publish Collection"
		await merchantPage.getByTestId('collection-form-submit').click()

		// Verify: navigated back to list with the new collection visible
		await expect(merchantPage.getByText('E2E Summer Collection').first()).toBeVisible({ timeout: 15_000 })
	})

	test('can create a second collection', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		await gotoDashboard(merchantPage, '/dashboard/products/collections')
		await expect(merchantPage.getByRole('heading', { name: /collections/i })).toBeVisible({ timeout: 10_000 })

		await merchantPage.getByTestId('add-collection-button').click()

		// --- Info Tab ---
		const nameInput = merchantPage.getByTestId('collection-name-input')
		await expect(nameInput).toBeVisible({ timeout: 5_000 })
		await nameInput.fill('E2E Winter Collection')

		await merchantPage.getByTestId('collection-description-input').fill('Warm products for the cold season.')

		// Next → Products tab
		await merchantPage.getByTestId('collection-form-next').click()

		// Next → Shipping tab (skip product selection)
		await merchantPage.getByTestId('collection-form-next').click()

		// Add shipping options if available
		const addDigitalBtn = merchantPage.getByTestId('add-shipping-option-digital-delivery')
		if (await addDigitalBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
			await addDigitalBtn.click()
		}

		// Publish
		await merchantPage.getByTestId('collection-form-submit').click()

		// Verify the new collection exists (use first() to handle duplicates from previous runs)
		await expect(merchantPage.getByText('E2E Winter Collection').first()).toBeVisible({ timeout: 15_000 })
	})

	test('can edit an existing collection', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		// First, create a collection to edit
		await gotoDashboard(merchantPage, '/dashboard/products/collections')
		await expect(merchantPage.getByRole('heading', { name: /collections/i })).toBeVisible({ timeout: 10_000 })

		await merchantPage.getByTestId('add-collection-button').click()

		const nameInput = merchantPage.getByTestId('collection-name-input')
		await expect(nameInput).toBeVisible({ timeout: 5_000 })
		await nameInput.fill('E2E Editable Collection')
		await merchantPage.getByTestId('collection-description-input').fill('This will be edited.')

		// Navigate through tabs and publish
		await merchantPage.getByTestId('collection-form-next').click()
		await merchantPage.getByTestId('collection-form-next').click()
		await merchantPage.getByTestId('collection-form-submit').click()

		// Wait for it to appear in the list
		await expect(merchantPage.getByText('E2E Editable Collection').first()).toBeVisible({ timeout: 15_000 })

		// Click the edit button
		await merchantPage.getByLabel('Edit E2E Editable Collection').first().click()

		// Wait for the edit form to load with pre-populated data
		const editNameInput = merchantPage.getByTestId('collection-name-input')
		await expect(editNameInput).toBeVisible({ timeout: 5_000 })
		await expect(editNameInput).toHaveValue('E2E Editable Collection')

		// Update the name
		await editNameInput.clear()
		await editNameInput.fill('E2E Updated Collection')

		// Update the description
		const descInput = merchantPage.getByTestId('collection-description-input')
		await descInput.clear()
		await descInput.fill('This collection has been updated.')

		// In edit mode, submit is visible on any tab — click it
		await merchantPage.getByTestId('collection-form-submit').click()

		// Wait for the update to complete (toast confirms success)
		await expect(merchantPage.getByText('Collection updated successfully')).toBeVisible({ timeout: 15_000 })

		// The list may show stale data briefly. Reload to ensure we get fresh data from the relay.
		await merchantPage.reload({ waitUntil: 'domcontentloaded' })

		// Wait for the updated name to appear in the list
		await expect(merchantPage.getByText('E2E Updated Collection').first()).toBeVisible({ timeout: 20_000 })
	})

	test('can delete a collection', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		// First, create a collection to delete
		await gotoDashboard(merchantPage, '/dashboard/products/collections')
		await expect(merchantPage.getByRole('heading', { name: /collections/i })).toBeVisible({ timeout: 10_000 })

		await merchantPage.getByTestId('add-collection-button').click()

		const nameInput = merchantPage.getByTestId('collection-name-input')
		await expect(nameInput).toBeVisible({ timeout: 5_000 })
		await nameInput.fill('E2E Deletable Collection')
		await merchantPage.getByTestId('collection-description-input').fill('This will be deleted.')

		await merchantPage.getByTestId('collection-form-next').click()
		await merchantPage.getByTestId('collection-form-next').click()
		await merchantPage.getByTestId('collection-form-submit').click()

		await expect(merchantPage.getByText('E2E Deletable Collection').first()).toBeVisible({ timeout: 15_000 })

		// Accept the browser confirm dialog
		merchantPage.on('dialog', (dialog) => dialog.accept())

		// Click the delete button (target the first/most-recent one)
		await merchantPage.getByLabel('Delete E2E Deletable Collection').first().click()

		// Verify at least one was removed — count should decrease
		const countBefore = await merchantPage.getByText('E2E Deletable Collection').count()
		// The deletion is optimistic, so wait for the count to drop
		await expect(async () => {
			const countAfter = await merchantPage.getByText('E2E Deletable Collection').count()
			expect(countAfter).toBeLessThan(countBefore)
		}).toPass({ timeout: 10_000 })
	})

	test('submit button is disabled without required fields', async ({ merchantPage }) => {
		await gotoDashboard(merchantPage, '/dashboard/products/collections')
		await expect(merchantPage.getByRole('heading', { name: /collections/i })).toBeVisible({ timeout: 10_000 })

		await merchantPage.getByTestId('add-collection-button').click()

		const nameInput = merchantPage.getByTestId('collection-name-input')
		await expect(nameInput).toBeVisible({ timeout: 5_000 })

		// Navigate to shipping tab where submit is visible (use tab clicks since Next may be disabled)
		await merchantPage.getByTestId('collection-tab-shipping').click()

		// Submit should be disabled since name and description are empty
		await expect(merchantPage.getByTestId('collection-form-submit')).toBeDisabled()

		// Go back and fill only the name
		await merchantPage.getByTestId('collection-tab-info').click()
		await nameInput.fill('Test Collection')

		// Submit should still be disabled (no description)
		await merchantPage.getByTestId('collection-tab-shipping').click()
		await expect(merchantPage.getByTestId('collection-form-submit')).toBeDisabled()

		// Fill description too
		await merchantPage.getByTestId('collection-tab-info').click()
		await merchantPage.getByTestId('collection-description-input').fill('A description.')

		// Now submit should be enabled
		await merchantPage.getByTestId('collection-tab-shipping').click()
		await expect(merchantPage.getByTestId('collection-form-submit')).toBeEnabled()
	})

	test('can navigate between tabs using Back and Next buttons', async ({ merchantPage }) => {
		await gotoDashboard(merchantPage, '/dashboard/products/collections')
		await expect(merchantPage.getByRole('heading', { name: /collections/i })).toBeVisible({ timeout: 10_000 })

		await merchantPage.getByTestId('add-collection-button').click()

		const nameInput = merchantPage.getByTestId('collection-name-input')
		await expect(nameInput).toBeVisible({ timeout: 5_000 })

		// Fill required fields so Next button is enabled
		await nameInput.fill('Tab Nav Test')
		await merchantPage.getByTestId('collection-description-input').fill('Testing navigation.')

		// Start on Info tab
		await expect(merchantPage.getByTestId('collection-tab-info')).toHaveAttribute('data-state', 'active')

		// Next → Products tab
		await merchantPage.getByTestId('collection-form-next').click()
		await expect(merchantPage.getByTestId('collection-tab-products')).toHaveAttribute('data-state', 'active')

		// Next → Shipping tab
		await merchantPage.getByTestId('collection-form-next').click()
		await expect(merchantPage.getByTestId('collection-tab-shipping')).toHaveAttribute('data-state', 'active')

		// Back → Products tab
		await merchantPage.getByTestId('collection-form-back').click()
		await expect(merchantPage.getByTestId('collection-tab-products')).toHaveAttribute('data-state', 'active')

		// Back → Info tab
		await merchantPage.getByTestId('collection-form-back').click()
		await expect(merchantPage.getByTestId('collection-tab-info')).toHaveAttribute('data-state', 'active')
	})

	test('edit mode shows submit button on all tabs', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		// Create a collection to edit
		await gotoDashboard(merchantPage, '/dashboard/products/collections')
		await expect(merchantPage.getByRole('heading', { name: /collections/i })).toBeVisible({ timeout: 10_000 })

		await merchantPage.getByTestId('add-collection-button').click()

		const nameInput = merchantPage.getByTestId('collection-name-input')
		await expect(nameInput).toBeVisible({ timeout: 5_000 })
		await nameInput.fill('E2E Multi-Tab Edit Test')
		await merchantPage.getByTestId('collection-description-input').fill('Testing submit visibility.')

		await merchantPage.getByTestId('collection-form-next').click()
		await merchantPage.getByTestId('collection-form-next').click()
		await merchantPage.getByTestId('collection-form-submit').click()

		await expect(merchantPage.getByText('E2E Multi-Tab Edit Test').first()).toBeVisible({ timeout: 15_000 })

		// Enter edit mode
		await merchantPage.getByLabel('Edit E2E Multi-Tab Edit Test').first().click()
		await expect(merchantPage.getByTestId('collection-name-input')).toBeVisible({ timeout: 5_000 })

		// Submit should be visible on Info tab (edit mode)
		await expect(merchantPage.getByTestId('collection-form-submit')).toBeVisible()

		// Switch to Products tab — submit still visible
		await merchantPage.getByTestId('collection-tab-products').click()
		await expect(merchantPage.getByTestId('collection-form-submit')).toBeVisible()

		// Switch to Shipping tab — submit still visible
		await merchantPage.getByTestId('collection-tab-shipping').click()
		await expect(merchantPage.getByTestId('collection-form-submit')).toBeVisible()
	})
})
