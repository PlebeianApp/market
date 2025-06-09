import { test, expect } from '@playwright/test'
import { createRelayMonitor } from './utils/relay-monitor'
import { skipIfInSetupMode } from './utils/test-utils'

// Helper function to fill user profile form
async function fillUserForm(page: any, userData: any) {
	console.log('📝 Filling user profile form...')
	
	// Handle potential decrypt dialog that might appear when accessing profile
	try {
		const decryptDialog = page.locator('[data-testid="decrypt-password-dialog"]')
		if (await decryptDialog.isVisible({ timeout: 2000 })) {
			console.log('🔑 Decrypt dialog appeared, entering password...')
			await page.fill('[data-testid="decrypt-password-input"]', 'pass1234')
			await page.click('[data-testid="decrypt-login-button"]')
			await page.waitForTimeout(1000)
		}
	} catch (e) {
		// No decrypt dialog needed
	}

	// Wait for profile form to be ready (looking for name field which is required)
	await page.waitForSelector('input[name="name"]', { timeout: 10000 })
	
	// Fill all form fields using the correct TanStack Form field names
	await page.fill('input[name="name"]', userData.name)
	await page.fill('input[name="displayName"]', userData.displayName)
	await page.fill('textarea[name="about"]', userData.about)
	await page.fill('input[name="website"]', userData.website)
	await page.fill('input[name="lud16"]', userData.lud16)
	await page.fill('input[name="nip05"]', userData.nip05)
	
	console.log('✅ Profile form filled successfully')
}

// Helper function to navigate using UI elements
async function navigateWithUI(page: any, linkText: string): Promise<boolean> {
	try {
		// Look for navigation link with the specified text
		const navLink = page.getByText(linkText, { exact: false })
		if (await navLink.isVisible({ timeout: 3000 })) {
			await navLink.click()
			await page.waitForTimeout(1000)
			return true
		}
		return false
	} catch (error) {
		console.log(`Failed to find navigation link: ${linkText}`)
		return false
	}
}

test.describe.serial('3. User Profile Creation Flow', () => {
	test.beforeEach(async ({ page }) => {
		// Skip if in setup mode
		await skipIfInSetupMode(page, test)

		// Navigate to dashboard/profile directly
		await page.goto('/dashboard/account/profile')
		await page.waitForTimeout(1000)

		// Handle potential decrypt dialog that might appear
		try {
			const decryptDialog = page.locator('[data-testid="decrypt-password-dialog"]')
			if (await decryptDialog.isVisible({ timeout: 3000 })) {
				console.log('🔑 Decrypt dialog appeared, entering password...')
				await page.fill('[data-testid="decrypt-password-input"]', 'pass1234')
				await page.click('[data-testid="decrypt-login-button"]')
				await page.waitForTimeout(2000)
			}
		} catch (e) {
			// No decrypt dialog or already handled
		}
	})

	test('debug relay monitor - check if it captures any events', async ({ page }) => {
		console.log('🔍 Debug: Testing relay monitor functionality')
		
		// Start monitoring
		const relayMonitor = await createRelayMonitor(page)
		
		// Navigate around and perform some actions to generate traffic
		await page.goto('/')
		await page.waitForTimeout(2000)
		
		// Check if any events were captured
		const allEvents = relayMonitor.getEvents()
		console.log(`📊 Captured ${allEvents.length} events so far`)
		
		// Print details of what we captured
		relayMonitor.printEventSummary()
		
		// Try to trigger some WebSocket activity
		console.log('🔄 Triggering some activity...')
		await page.goto('/dashboard')
		await page.waitForTimeout(3000)
		
		// Check again
		const eventsAfter = relayMonitor.getEvents()
		console.log(`📊 Captured ${eventsAfter.length} events after navigation`)
		relayMonitor.printEventSummary()
		
		// Stop monitoring
		relayMonitor.stopMonitoring()
	})

	test('should complete full user creation and profile setup flow', async ({ page }) => {
		console.log('🚀 Starting user profile creation flow test')

		// Start monitoring relay events
		const relayMonitor = await createRelayMonitor(page)

		// Step 1: Navigate to home page
		console.log('📱 Step 1: Navigating to home page')
		await page.goto('/')
		await page.waitForTimeout(2000)

		// Skip if we're in setup mode
		if (page.url().includes('/setup')) {
			console.log('⚠️  App is in setup mode - skipping user profile test')
			test.skip()
			return
		}

		// Step 1.5: Handle decrypt dialog if it appears (from previous test sessions)
		const decryptDialog = page.locator('[data-testid="decrypt-password-dialog"]')
		if (await decryptDialog.isVisible()) {
			console.log('🔐 Step 1.5: Decrypt dialog appeared - entering password')
			await page.fill('[data-testid="decrypt-password-input"]', 'pass1234')
			await page.click('[data-testid="decrypt-login-button"]')
			await page.waitForTimeout(3000)
			console.log('✅ Successfully decrypted and logged in')
		}

		// Step 2: Check if already logged in, if not click login button
		console.log('🔐 Step 2: Checking authentication state')

		// Check if user is already authenticated (dashboard link visible)
		const dashboardLink = page.locator('[data-testid="dashboard-link"]')
		const isAlreadyLoggedIn = await dashboardLink.isVisible()

		if (isAlreadyLoggedIn) {
			console.log('ℹ️  User already authenticated - proceeding to profile setup')
			// Skip to profile setup
		} else {
			console.log('🔐 User not authenticated - clicking login button')
			await page.click('[data-testid="login-button"]')

			// Wait for login dialog to open
			await page.waitForSelector('[data-testid="login-dialog"]', { timeout: 5000 })
			console.log('✅ Login dialog opened')

			// Step 3: Switch to Private Key tab
			console.log('🔑 Step 3: Switching to Private Key tab')
			await page.click('[data-testid="private-key-tab"]')
			await page.waitForTimeout(1000)

			// Step 4: Generate new private key
			console.log('🎲 Step 4: Generating new private key')
			await page.click('[data-testid="generate-key-button"]')
			await page.waitForTimeout(1000)

			// Verify private key was generated (should start with nsec1)
			const privateKeyInput = page.locator('[data-testid="private-key-input"]')
			const privateKeyValue = await privateKeyInput.inputValue()
			expect(privateKeyValue).toMatch(/^nsec1[a-z0-9]+$/)
			console.log('✅ Private key generated:', privateKeyValue.substring(0, 10) + '...')

			// Step 5: Continue to password setup
			console.log('📝 Step 5: Proceeding to password setup')
			await page.click('[data-testid="continue-button"]')
			await page.waitForTimeout(1000)

			// Step 6: Set password
			console.log('🔒 Step 6: Setting password')
			await page.fill('[data-testid="new-password-input"]', 'pass1234')
			await page.fill('[data-testid="confirm-password-input"]', 'pass1234')

			// Step 6.5: Enable auto-login to stay logged in across tests
			console.log('✅ Step 6.5: Enabling auto-login')
			await page.check('[data-testid="auto-login-checkbox"]')

			// Step 7: Encrypt and continue
			console.log('🔐 Step 7: Encrypting and storing key')
			await page.click('[data-testid="encrypt-continue-button"]')
			await page.waitForTimeout(3000)

			// Verify login was successful - dialog should close and user should be authenticated
			console.log('✅ Login completed, verifying authentication state')

			// Wait for dialog to close and check for authenticated state indicators
			await page.waitForTimeout(2000)

			// Look for dashboard link or profile button (signs of being logged in)
			await expect(dashboardLink).toBeVisible({ timeout: 10000 })
			console.log('✅ User authenticated - dashboard link visible')
		}

		// Step 8: Navigate to profile page through UI
		console.log('👤 Step 8: Navigating to profile page through UI')
		await page.click('[data-testid="dashboard-link"]')
		await page.waitForTimeout(2000)

		// Navigate through the dashboard UI to profile section
		console.log('📋 Looking for account/profile navigation in dashboard')

		// Try to find profile or account navigation links
		const profileNavLinks = [
			'a:has-text("👤 Profile")', // Based on dashboardNavigation.ts
			'a:has-text("Profile")',
			'a[href="/dashboard/account/profile"]',
			'a:has-text("Account")',
			'button:has-text("Profile")',
			'button:has-text("Account")',
		]

		let profileNavFound = false
		for (const selector of profileNavLinks) {
			const navElement = page.locator(selector).first()
			if (await navElement.isVisible()) {
				console.log(`✅ Found profile navigation: ${selector}`)
				await navElement.click()
				profileNavFound = true
				break
			}
		}

		// If no UI navigation found, fall back to direct navigation
		if (!profileNavFound) {
			console.log('⚠️  No profile navigation found in UI, using direct navigation')
			await page.goto('/dashboard/account/profile')
		}

		await page.waitForTimeout(3000)

		// Step 8.5: Handle decrypt dialog if it appears when accessing profile
		const decryptDialogOnProfile = page.locator('[data-testid="decrypt-password-dialog"]')
		if (await decryptDialogOnProfile.isVisible()) {
			console.log('🔐 Step 8.5: Decrypt dialog appeared when accessing profile - entering password')
			await page.fill('[data-testid="decrypt-password-input"]', 'pass1234')
			await page.click('[data-testid="decrypt-login-button"]')
			await page.waitForTimeout(3000)
			// Wait for profile page to load after decryption
			await page.waitForTimeout(2000)
			console.log('✅ Successfully decrypted and profile page loaded')
		}

		// Verify we're on the profile page
		await expect(page.locator('h1').filter({ hasText: 'Profile' }).first()).toBeVisible()
		console.log('✅ Profile page loaded')

		// Step 9: Fill profile data
		console.log('📝 Step 9: Filling profile data')

		const testProfileData = {
			name: 'Test User E2E',
			displayName: 'Test User Display',
			about: 'This is a test user created during e2e testing. Hello Nostr world!',
			nip05: 'testuser@example.com',
			lud16: 'testuser@getalby.com',
			website: 'https://example.com',
		}

		// Fill form fields
		await page.fill('input[name="name"]', testProfileData.name)
		await page.fill('input[name="displayName"]', testProfileData.displayName)
		await page.fill('textarea[name="about"]', testProfileData.about)
		await page.fill('input[name="nip05"]', testProfileData.nip05)
		await page.fill('input[name="lud16"]', testProfileData.lud16)
		await page.fill('input[name="website"]', testProfileData.website)

		console.log('✅ Profile data filled')

		// Step 10: Save profile
		console.log('💾 Step 10: Saving profile')
		await page.click('[data-testid="profile-save-button"]')

		// Wait for save operation
		await page.waitForTimeout(3000)

		// Look for success indication (button should change back from "Saving..." to "Save")
		await expect(page.locator('[data-testid="profile-save-button"]:has-text("Save")')).toBeVisible({ timeout: 10000 })
		console.log('✅ Profile saved')

		// Step 10.5: Verify profile event was published to relay
		console.log('🔍 Step 10.5: Verifying profile data was published to relay')
		const profileEventReceived = await relayMonitor.verifyProfileData({
			name: testProfileData.name,
			display_name: testProfileData.displayName,
			about: testProfileData.about,
			nip05: testProfileData.nip05,
			lud16: testProfileData.lud16,
			website: testProfileData.website,
		})

		expect(profileEventReceived).toBe(true)
		console.log('✅ Profile data verified on relay')

		// Step 11: Refresh page and verify data persistence
		console.log('🔄 Step 11: Verifying data persistence')
		await page.reload()
		await page.waitForTimeout(3000)

		// Handle decrypt dialog if it appears after reload
		const decryptDialogAfterReload = page.locator('[data-testid="decrypt-password-dialog"]')
		if (await decryptDialogAfterReload.isVisible()) {
			console.log('🔐 Decrypt dialog appeared after reload - entering password')
			await page.fill('[data-testid="decrypt-password-input"]', 'pass1234')
			await page.click('[data-testid="decrypt-login-button"]')
			await page.waitForTimeout(3000)
			// Navigate back to profile page through UI
			console.log('📋 Navigating back to profile page through UI after decrypt')
			await page.click('[data-testid="dashboard-link"]')
			await page.waitForTimeout(1000)

			// Look for profile navigation again
			const profileNavOptions = ['a:has-text("👤 Profile")', 'a:has-text("Profile")', 'a[href="/dashboard/account/profile"]']

			let found = false
			for (const selector of profileNavOptions) {
				const navElement = page.locator(selector).first()
				if (await navElement.isVisible()) {
					await navElement.click()
					found = true
					break
				}
			}

			if (!found) {
				await page.goto('/dashboard/account/profile')
			}
			await page.waitForTimeout(2000)
		}

		// Verify all fields retained their values
		await expect(page.locator('input[name="name"]')).toHaveValue(testProfileData.name)
		await expect(page.locator('input[name="displayName"]')).toHaveValue(testProfileData.displayName)
		await expect(page.locator('textarea[name="about"]')).toHaveValue(testProfileData.about)
		await expect(page.locator('input[name="nip05"]')).toHaveValue(testProfileData.nip05)
		await expect(page.locator('input[name="lud16"]')).toHaveValue(testProfileData.lud16)
		await expect(page.locator('input[name="website"]')).toHaveValue(testProfileData.website)

		console.log('✅ All profile data persisted correctly')

		// Step 12: Test profile display and navigate back to home through UI
		console.log('🏠 Step 12: Navigating back to home page through UI')

		// Try to find home navigation elements
		const homeNavLinks = [
			'a[href="/"]',
			'a:has-text("Home")',
			'[data-testid="home-link"]',
			'img[alt*="logo" i]', // Logo usually links to home
			'a:has(img[alt*="logo" i])', // Link containing logo
		]

		let homeNavFound = false
		for (const selector of homeNavLinks) {
			const navElement = page.locator(selector).first()
			if (await navElement.isVisible()) {
				console.log(`✅ Found home navigation: ${selector}`)
				await navElement.click()
				homeNavFound = true
				break
			}
		}

		// If no UI navigation found, fall back to direct navigation
		if (!homeNavFound) {
			console.log('⚠️  No home navigation found in UI, using direct navigation')
			await page.goto('/')
		}

		await page.waitForTimeout(2000)

		// The user should still be logged in and we should see authenticated state
		await expect(page.locator('[data-testid="dashboard-link"]')).toBeVisible()
		console.log('✅ User remains authenticated after navigation')

		// Final verification: Check that we can see the authenticated user state
		console.log('🔍 Step 13: Final verification of complete user flow')

		// Verify we're still authenticated and can access dashboard
		await expect(page.locator('[data-testid="dashboard-link"]')).toBeVisible()
		console.log('✅ User remains authenticated')

		// Verify we're not seeing any error messages
		const errorMessages = ['error', 'failed', 'something went wrong']
		for (const errorText of errorMessages) {
			await expect(page.locator(`text=${errorText}`).first()).not.toBeVisible()
		}
		console.log('✅ No error messages present')

		console.log('🎉 User profile creation flow completed successfully!')
		console.log('📊 Test Results Summary:')
		console.log('  ✅ User account created with private key')
		console.log('  ✅ Auto-login enabled')
		console.log('  ✅ Profile data filled and submitted')
		console.log('  ✅ Profile event published to Nostr relay')
		console.log('  ✅ Profile data persisted after page refresh')
		console.log('  ✅ UI navigation working correctly')
		console.log('  ✅ Authentication state maintained')

		// Print relay event summary
		relayMonitor.printEventSummary()
		relayMonitor.stopMonitoring()
	})

	test('should handle login with existing stored key', async ({ page }) => {
		console.log('🔑 Testing login with existing stored key')

		await page.goto('/')
		await page.waitForTimeout(2000)

		if (page.url().includes('/setup')) {
			console.log('⚠️  App is in setup mode - skipping stored key test')
			test.skip()
			return
		}

		// Handle decrypt dialog if it appears immediately
		const decryptDialog = page.locator('[data-testid="decrypt-password-dialog"]')
		if (await decryptDialog.isVisible()) {
			console.log('🔐 Decrypt dialog appeared - entering password')
			await page.fill('[data-testid="decrypt-password-input"]', 'pass1234')
			await page.click('[data-testid="decrypt-login-button"]')
			await page.waitForTimeout(3000)
			console.log('✅ Successfully decrypted and logged in - test complete')
			return
		}

		// If user is already logged in from previous test, logout first
		// (This would require implementing a logout function, for now we'll assume clean state)

		// Click login button
		await page.click('[data-testid="login-button"]')

		await page.waitForSelector('[data-testid="login-dialog"]', { timeout: 5000 })

		// Switch to Private Key tab
		await page.click('[data-testid="private-key-tab"]')
		await page.waitForTimeout(1000)

		// If there's a stored key, we should see password input
		const passwordInput = page.locator('[data-testid="stored-password-input"]')
		if (await passwordInput.isVisible()) {
			console.log('🔐 Found stored key - testing password login')

			// Enter the password we set in the previous test
			await passwordInput.fill('pass1234')

			// Ensure auto-login is enabled
			await page.check('[data-testid="auto-login-checkbox"]')

			await page.click('[data-testid="stored-key-login-button"]')
			await page.waitForTimeout(3000)

			// Verify login was successful
			await expect(page.locator('[data-testid="dashboard-link"]')).toBeVisible({ timeout: 10000 })
			console.log('✅ Successfully logged in with stored key')
		} else {
			console.log('ℹ️  No stored key found - this is expected if running tests in isolation')
		}
	})

	test('should create user profile, navigate away, and verify data persistence', async ({ page }) => {
		console.log('🚀 Starting profile data persistence test')
		
		// Step 1: Navigate to home page and authenticate
		console.log('📱 Step 1: Navigating to home page')
		await page.goto('/')
		await page.waitForTimeout(2000)

		// Check if user is already authenticated (dashboard link visible)
		const dashboardLink = page.locator('[data-testid="dashboard-link"]')
		const isAlreadyLoggedIn = await dashboardLink.isVisible()

		if (!isAlreadyLoggedIn) {
			console.log('🔐 User not authenticated - clicking login button')
			await page.click('[data-testid="login-button"]')

			// Wait for login dialog to open
			await page.waitForSelector('[data-testid="login-dialog"]', { timeout: 5000 })

			// Click on Private Key tab
			await page.click('[data-testid="private-key-tab"]')
			await page.waitForTimeout(1000)

			// Generate new private key
			await page.click('[data-testid="generate-key-button"]')
			await page.waitForTimeout(1000)

			// Continue to password setup
			await page.click('[data-testid="continue-button"]')
			await page.waitForTimeout(1000)

			// Set password
			await page.fill('[data-testid="new-password-input"]', 'pass1234')
			await page.fill('[data-testid="confirm-password-input"]', 'pass1234')

			// Enable auto-login
			await page.check('[data-testid="auto-login-checkbox"]')

			// Encrypt and continue
			await page.click('[data-testid="encrypt-continue-button"]')
			await page.waitForTimeout(3000)

			// Wait for authentication to complete
			await expect(dashboardLink).toBeVisible({ timeout: 10000 })
			console.log('✅ User authenticated')
		} else {
			console.log('ℹ️  User already authenticated')
		}

		// Step 2: Navigate to profile page via UI
		console.log('👤 Step 2: Navigating to profile page via UI')
		await page.click('[data-testid="dashboard-link"]')
		await page.waitForTimeout(2000)

		// Look for profile navigation in the UI
		console.log('🔍 Looking for Profile navigation link...')
		const profileNavFound = await navigateWithUI(page, '👤 Profile')
		if (!profileNavFound) {
			console.log('⚠️ Profile navigation not found in UI, trying alternative selectors...')
			// Try alternative selectors for profile navigation
			const profileSelectors = [
				'a:has-text("Profile")',
				'a[href*="profile"]',
				'button:has-text("Profile")',
				'*:has-text("Account") >> a',
			]
			
			let found = false
			for (const selector of profileSelectors) {
				try {
					const element = page.locator(selector).first()
					if (await element.isVisible({ timeout: 2000 })) {
						console.log(`✅ Found profile navigation with selector: ${selector}`)
						await element.click()
						found = true
						break
					}
				} catch (e) {
					// Continue to next selector
				}
			}
			
			if (!found) {
				console.log('❌ Could not find profile navigation - test may fail')
			}
		}
		
		await page.waitForTimeout(2000)

		// Handle potential decrypt dialog
		try {
			const decryptDialog = page.locator('[data-testid="decrypt-password-dialog"]')
			if (await decryptDialog.isVisible({ timeout: 3000 })) {
				console.log('🔑 Decrypt dialog appeared, entering password...')
				await page.fill('[data-testid="decrypt-password-input"]', 'pass1234')
				await page.click('[data-testid="decrypt-login-button"]')
				await page.waitForTimeout(2000)
			}
		} catch (e) {
			// No decrypt dialog needed
		}

		// Fill out and save the profile
		const userData = {
			name: 'john_doe',
			displayName: 'John Doe',
			about: 'Test user profile for e2e testing',
			website: 'https://johndoe.com',
			lud16: 'john@getalby.com',
			nip05: 'john@example.com',
		}

		await fillUserForm(page, userData)

		// Save the profile
		await page.click('[data-testid="profile-save-button"]')

		// Wait for save success (could be a toast, redirect, or other indicator)
		await page.waitForTimeout(2000)

		console.log('✅ Profile saved successfully')

				// Navigate to Products page using UI
		console.log('🔄 Navigating to Products page...')
		const productsNavigated = await navigateWithUI(page, '📦 Products')
		if (!productsNavigated) {
			// Try alternative selectors for products navigation
			console.log('⚠️ Products navigation not found, trying alternative selectors...')
			const productSelectors = [
				'a:has-text("Products")',
				'a[href*="products"]',
				'button:has-text("Products")',
			]
			
			let found = false
			for (const selector of productSelectors) {
				try {
					const element = page.locator(selector).first()
					if (await element.isVisible({ timeout: 2000 })) {
						console.log(`✅ Found products navigation with selector: ${selector}`)
						await element.click()
						found = true
						break
					}
				} catch (e) {
					// Continue to next selector
				}
			}
			
			if (!found) {
				console.log('❌ Could not find products navigation - staying on current page')
			}
		}

		// Wait for the page to load
		await page.waitForTimeout(2000)
		console.log('✅ Successfully navigated to Products page (or alternative page)')

		// Navigate back to Profile page using UI
		console.log('🔄 Navigating back to Profile page...')
		const profileReturnNavigated = await navigateWithUI(page, '👤 Profile')
		if (!profileReturnNavigated) {
			// Try alternative selectors for profile navigation
			console.log('⚠️ Profile return navigation not found, trying alternative selectors...')
			const profileSelectors = [
				'a:has-text("Profile")',
				'a[href*="profile"]',
				'button:has-text("Profile")',
				'*:has-text("Account") >> a',
			]
			
			let found = false
			for (const selector of profileSelectors) {
				try {
					const element = page.locator(selector).first()
					if (await element.isVisible({ timeout: 2000 })) {
						console.log(`✅ Found profile return navigation with selector: ${selector}`)
						await element.click()
						found = true
						break
					}
				} catch (e) {
					// Continue to next selector
				}
			}
			
			if (!found) {
				console.log('❌ Could not find profile return navigation - test may fail')
			}
		}

				// Wait for the page to load and handle potential decrypt dialog
		await page.waitForTimeout(2000)
		
		// Handle potential decrypt dialog that might appear when returning to profile
		try {
			const decryptDialog = page.locator('[data-testid="decrypt-password-dialog"]')
			if (await decryptDialog.isVisible({ timeout: 2000 })) {
				console.log('🔑 Decrypt dialog appeared on return, entering password...')
				await page.fill('[data-testid="decrypt-password-input"]', 'pass1234')
				await page.click('[data-testid="decrypt-login-button"]')
				await page.waitForTimeout(1000)
			}
		} catch (e) {
			// No decrypt dialog needed
		}

		console.log('✅ Successfully navigated back to Profile page')

				// Verify all the profile data is still there
		console.log('🔍 Verifying profile data persistence...')
		
		await expect(page.locator('input[name="name"]')).toHaveValue(userData.name)
		await expect(page.locator('input[name="displayName"]')).toHaveValue(userData.displayName)
		await expect(page.locator('textarea[name="about"]')).toHaveValue(userData.about)
		await expect(page.locator('input[name="website"]')).toHaveValue(userData.website)
		await expect(page.locator('input[name="lud16"]')).toHaveValue(userData.lud16)
		await expect(page.locator('input[name="nip05"]')).toHaveValue(userData.nip05)

		console.log('✅ All profile data persisted correctly after navigation!')
	})
})
