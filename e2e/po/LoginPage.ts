import { type Page, expect } from '@playwright/test'
import { BasePage } from './BasePage'
import { nip19 } from 'nostr-tools'
import { FIXED_TEST_USER } from 'e2e/fixtures/users'

export class LoginPage extends BasePage {
	private readonly loginButton = this.page.locator('[data-testid="login-button"]')
	private readonly loginDialog = this.page.locator('[data-testid="login-dialog"]')
	private readonly privateKeyTab = this.page.locator('[data-testid="private-key-tab"]')
	private readonly privateKeyInput = this.page.locator('[data-testid="private-key-input"]')
	private readonly storedPasswordInput = this.page.locator('[data-testid="stored-password-input"]')
	private readonly storedKeyLoginButton = this.page.locator('[data-testid="stored-key-login-button"]')
	private readonly continueButton = this.page.locator('[data-testid="continue-button"]')
	private readonly newPasswordInput = this.page.locator('[data-testid="new-password-input"]')
	private readonly confirmPasswordInput = this.page.locator('[data-testid="confirm-password-input"]')
	private readonly autoLoginCheckbox = this.page.locator('[data-testid="auto-login-checkbox"]')
	private readonly encryptContinueButton = this.page.locator('[data-testid="encrypt-continue-button"]')
	private readonly decryptDialog = this.page.locator('[data-testid="decrypt-password-dialog"]')
	private readonly decryptPasswordInput = this.page.locator('[data-testid="decrypt-password-input"]')
	private readonly decryptLoginButton = this.page.locator('[data-testid="decrypt-login-button"]')
	private readonly dashboardLink = this.page.locator('[data-testid="dashboard-link"]')

	async login(password = 'a', privateKeyHex?: string) {
		if (await this.dashboardLink.isVisible()) {
			return // Already logged in
		}

		await this.handleDecryptDialog(password)

		if (await this.dashboardLink.isVisible()) {
			return
		}

		await this.loginButton.click()
		await expect(this.loginDialog).toBeVisible()
		await this.privateKeyTab.click()
		await this.pause(500)

		if (await this.storedPasswordInput.isVisible()) {
			await this.storedPasswordInput.fill(password)
			await this.autoLoginCheckbox.check()
			await this.storedKeyLoginButton.click()
		} else {
			// Use provided private key or fall back to fixed test user
			const keyToUse = privateKeyHex || FIXED_TEST_USER.privateKey
			const privateKeyBytes = new Uint8Array(Buffer.from(keyToUse, 'hex'))
			const privateKeyNsec = nip19.nsecEncode(privateKeyBytes)

			await this.privateKeyInput.fill(privateKeyNsec)
			await this.continueButton.click()

			await this.newPasswordInput.fill(password)
			await this.confirmPasswordInput.fill(password)
			await this.autoLoginCheckbox.check()
			await this.encryptContinueButton.click()
		}

		await expect(this.dashboardLink).toBeVisible({ timeout: 5000 })
	}

	async logout() {
		// Check if user is logged in by looking for dashboard link
		if (await this.dashboardLink.isVisible()) {
			// Click on the profile/user menu
			const userMenuButton = this.page.locator('[data-testid="user-menu-button"]')
			if (await userMenuButton.isVisible()) {
				await userMenuButton.click()
				await this.pause(300)

				// Look for logout button in the dropdown
				const logoutButton = this.page.locator('button:has-text("Logout")')
				if (await logoutButton.isVisible()) {
					await logoutButton.click()
					await this.pause(500)
				}
			}
		}

		// Clear storage to ensure clean state
		await this.page.evaluate(() => {
			localStorage.clear()
			sessionStorage.clear()
		})
	}

	async handleDecryptDialog(password = 'a') {
		try {
			if (await this.decryptDialog.isVisible({ timeout: 300 })) {
				await this.decryptPasswordInput.fill(password)
				await this.decryptLoginButton.click()
				await expect(this.decryptDialog).not.toBeVisible({ timeout: 200 })
			}
		} catch (e) {
			// No decrypt dialog
		}
	}
}
