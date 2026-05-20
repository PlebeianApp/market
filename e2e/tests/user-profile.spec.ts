import { test, expect } from '../fixtures'

test.use({ scenario: 'base' })

test.describe('User Profile', () => {
	test('user can save a profile', async ({ newUserPage }) => {
		await newUserPage.goto('/dashboard/account/profile')

		// Wait for the form to be ready (may pre-fill from relay if profile exists)
		const nameInput = newUserPage.locator('#name')
		await expect(nameInput).toBeVisible({ timeout: 10_000 })

		const saveButton = newUserPage.getByTestId('profile-save-button-desktop')

		// Fill mandatory fields (overwrite whatever may be there)
		await nameInput.fill('E2E New User')
		await newUserPage.locator('#displayName').fill('E2E Test Display Name')

		// Fill optional fields
		await newUserPage.locator('#about').fill('Profile created by the e2e test suite')
		await newUserPage.locator('#website').fill('https://example.com')

		// Button should be enabled
		await expect(saveButton).toBeEnabled()

		// Save the profile
		await saveButton.click()

		// After save, button should change to "Saved"
		await expect(saveButton).toHaveText('Saved', { timeout: 10_000 })
	})

	test('existing user sees pre-filled profile data', async ({ merchantPage }) => {
		await merchantPage.goto('/dashboard/account/profile')

		// Wait for profile to load from relay
		const nameInput = merchantPage.locator('#name')
		await expect(nameInput).toBeVisible({ timeout: 10_000 })

		// Seeded profile has name "TestMerchant" and displayName "Test Merchant".
		// Only check fields the update test doesn't modify, since the relay
		// persists across runs and the latest Kind 0 wins.
		await expect(nameInput).toHaveValue('TestMerchant', { timeout: 10_000 })
		await expect(merchantPage.locator('#displayName')).toHaveValue('Test Merchant')

		// About field may differ from seed if a previous run's update test modified it,
		// so just verify it's not empty (i.e. profile data loaded)
		await expect(merchantPage.locator('#about')).not.toHaveValue('')
	})

	test('existing user can update their profile', async ({ merchantPage }) => {
		await merchantPage.goto('/dashboard/account/profile')

		const nameInput = merchantPage.locator('#name')
		await expect(nameInput).toBeVisible({ timeout: 10_000 })

		// Wait for profile data to load
		await expect(nameInput).toHaveValue('TestMerchant', { timeout: 10_000 })

		// Change the about field to a unique value so it always differs from the current value
		// (relay persists across runs, so using a static string would be a no-op on re-runs)
		const aboutInput = merchantPage.locator('#about')
		await aboutInput.clear()
		await aboutInput.fill(`Updated bio from e2e test ${Date.now()}`)

		// Button should now say "Save Changes" and be enabled
		const saveButton = merchantPage.getByTestId('profile-save-button-desktop')
		await expect(saveButton).toBeEnabled()
		await expect(saveButton).toHaveText('Save Changes')

		// Save
		await saveButton.click()

		// After save, button should change to "Saved"
		await expect(saveButton).toHaveText('Saved', { timeout: 10_000 })
	})

	test('profile creation publishes Kind 0 event to relay', async ({ browser }) => {
		// Use a fresh context with devUser3 and a relay monitor
		const { setupAuthContext } = await import('../fixtures/auth')
		const { devUser3 } = await import('../../src/lib/fixtures')
		const { RelayMonitor } = await import('../fixtures/relay-monitor')

		const context = await browser.newContext()
		await setupAuthContext(context, devUser3)
		const page = await context.newPage()

		const monitor = new RelayMonitor(page)
		await monitor.start()

		await page.goto('/dashboard/account/profile')
		await page.waitForLoadState('networkidle')

		const nameInput = page.locator('#name')
		await expect(nameInput).toBeVisible({ timeout: 10_000 })

		// Fill profile
		await nameInput.fill('E2E Relay Check User')
		await page.locator('#displayName').fill('Relay Check')
		await page.locator('#lud16').fill('test@example.com')

		// Save
		await page.getByTestId('profile-save-button-desktop').click()
		await expect(page.getByTestId('profile-save-button-desktop')).toHaveText('Saved', { timeout: 10_000 })

		// Verify Kind 0 was published
		const kind0Events = monitor.findSentEventsByKind(0)
		expect(kind0Events.length).toBeGreaterThan(0)

		const publishedEvent = kind0Events[kind0Events.length - 1]
		expect(publishedEvent.nostrEvent).toBeTruthy()

		const content = JSON.parse(publishedEvent.nostrEvent!.content)
		expect(content.name).toBe('E2E Relay Check User')
		expect(content.displayName).toBe('Relay Check')
		expect(content.lud16).toBe('test@example.com')

		// Verify it was sent to the local relay only
		expect(publishedEvent.relayUrl).toContain('localhost')

		await context.close()
	})

	test('mandatory fields are required to save', async ({ newUserPage }) => {
		await newUserPage.goto('/dashboard/account/profile')

		const nameInput = newUserPage.locator('#name')
		const displayNameInput = newUserPage.locator('#displayName')
		await expect(nameInput).toBeVisible({ timeout: 10_000 })

		const saveButton = newUserPage.getByTestId('profile-save-button-desktop')

		// Clear both mandatory fields to test validation
		await nameInput.clear()
		await displayNameInput.clear()

		// With both mandatory fields empty, button should be disabled
		await expect(saveButton).toBeDisabled()

		// Fill only name (missing displayName)
		await nameInput.fill('Only Name')
		await expect(saveButton).toBeDisabled()

		// Clear name, fill only displayName
		await nameInput.clear()
		await displayNameInput.fill('Only Display')
		await expect(saveButton).toBeDisabled()

		// Fill both mandatory fields — button should enable
		await nameInput.fill('Both Fields')
		await expect(saveButton).toBeEnabled()
	})
})
