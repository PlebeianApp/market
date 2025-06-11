import { type Page, expect } from '@playwright/test'
import { BasePage } from './BasePage'
import { FIXED_TEST_USER, type TestUser } from '../fixtures/users'

export class SetupPage extends BasePage {
	private readonly nameInput = this.page.locator('input[name="name"]')
	private readonly displayNameInput = this.page.locator('input[name="displayName"]')
	private readonly ownerPkInput = this.page.locator('input[name="ownerPk"]')
	private readonly contactEmailInput = this.page.locator('input[name="contactEmail"]')
	private readonly submitButton = this.page.locator('button[type="submit"]')

	async expectToBeOnSetupPage() {
		await this.waitForURL('/setup')
		await expect(this.page.getByText('Instance Setup')).toBeVisible()
	}

	async fillForm(testUser?: TestUser) {
		console.log('📝 Filling setup form...')
		await expect(this.nameInput).toBeVisible()

		const userToUse = testUser || FIXED_TEST_USER

		await this.nameInput.fill('Test Market')
		await this.displayNameInput.fill('Test Market Display')
		await this.ownerPkInput.fill(userToUse.npub)
		await this.contactEmailInput.fill('test@example.com')
	}

	async submitForm() {
		console.log('📤 Submitting setup form...')
		await this.submitButton.click()
		// await expect(this.page.locator('.sonner-toast:has-text("App settings successfully updated")')).toBeVisible({
		// 	timeout: 5000,
		// })
		console.log('✅ Setup form submitted successfully')
	}
}
