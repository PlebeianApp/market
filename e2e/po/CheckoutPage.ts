import { type Page, expect } from '@playwright/test'
import { BasePage } from './BasePage'

export class CheckoutPage extends BasePage {
	// Shipping form
	private readonly shippingForm = this.page.locator('#shipping-form')
	private readonly nameInput = this.page.locator('input[name="name"]').first()
	private readonly emailInput = this.page.locator('input[name="email"]')
	private readonly phoneInput = this.page.locator('input[name="phone"]')
	private readonly addressInput = this.page.locator('input[name="firstLineOfAddress"]')
	private readonly zipInput = this.page.locator('input[name="zipPostcode"]')

	// Payment
	private readonly paymentDialog = this.page.locator('[data-testid="payment-dialog"]')

	// Completion
	private readonly orderFinalize = this.page.locator('[data-testid="order-finalize"]')

	async expectOnCheckoutPage() {
		await this.waitForURL(/\/checkout/, 10000)
	}

	async fillShippingAddress(data: { name: string; email: string; phone?: string; address: string; zip: string }) {
		await this.nameInput.fill(data.name)
		await this.emailInput.fill(data.email)
		if (data.phone) {
			await this.phoneInput.fill(data.phone)
		}
		await this.addressInput.fill(data.address)
		await this.zipInput.fill(data.zip)
	}

	async submitShippingForm() {
		const submitButton = this.page.locator('button[type="submit"]').filter({ hasText: /continue|payment/i })
		await submitButton.click()
	}

	async expectPaymentStep() {
		// Wait for payment-related content to appear
		await expect(this.page.getByText(/payment/i).first()).toBeVisible({ timeout: 10000 })
	}

	async expectOrderComplete() {
		await expect(this.orderFinalize).toBeVisible({ timeout: 30000 })
	}

	async clickViewPurchases() {
		const button = this.page.getByText(/view your purchases/i).first()
		await button.click()
	}

	async clickContinueShopping() {
		const button = this.page.getByText(/continue shopping/i).first()
		await button.click()
	}
}
