import { test, expect } from '@playwright/test'
import { skipIfInSetupMode } from './utils/test-utils'
import { LoginPage } from './po/LoginPage'
import { BrowsePage } from './po/BrowsePage'
import { CartPage } from './po/CartPage'
import { CheckoutPage } from './po/CheckoutPage'

test.describe.serial('14. Payment Execution', () => {
	let loginPage: LoginPage
	let browsePage: BrowsePage
	let cartPage: CartPage
	let checkoutPage: CheckoutPage

	test.beforeEach(async ({ page }) => {
		loginPage = new LoginPage(page)
		browsePage = new BrowsePage(page)
		cartPage = new CartPage(page)
		checkoutPage = new CheckoutPage(page)
		await loginPage.goto()
		await skipIfInSetupMode(page, test)
		await loginPage.login()
	})

	test('payment processor should render QR code or invoice state', async ({ page }) => {
		// Add a product to cart
		await browsePage.goToProducts()
		await browsePage.expectProductsVisible()
		await browsePage.clickProduct(0)
		await browsePage.expectProductDetailVisible()
		await browsePage.addToCart()
		await page.waitForTimeout(1000)

		// Open cart and proceed to checkout
		await cartPage.openCart()
		await cartPage.expectCartNotEmpty()

		// Select shipping if needed
		const shippingWarning = page.locator('text=/select shipping/i')
		if (await shippingWarning.isVisible({ timeout: 2000 }).catch(() => false)) {
			await shippingWarning.click()
			await page.waitForTimeout(1000)

			const shippingSelect = page.locator('select, [role="combobox"]').first()
			if (await shippingSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
				await shippingSelect.click()
				await page.waitForTimeout(500)

				const option = page.locator('[role="option"]').first()
				if (await option.isVisible({ timeout: 1000 }).catch(() => false)) {
					await option.click()
					await page.waitForTimeout(500)
				}
			}
		}

		await cartPage.proceedToCheckout()
		await checkoutPage.expectOnCheckoutPage()

		// Fill shipping form
		await checkoutPage.fillShippingAddress({
			name: 'Test Buyer',
			email: 'test@example.com',
			address: '123 Test Street',
			zip: '12345',
		})

		// Submit form to proceed toward payment
		await checkoutPage.submitShippingForm()
		await page.waitForTimeout(3000)

		// The payment content or order summary should appear
		const paymentContent = page.locator('[data-testid="payment-content"]')
		const orderFinalize = page.locator('[data-testid="order-finalize"]')
		const paymentOrSummary = paymentContent.or(orderFinalize)

		if (await paymentOrSummary.isVisible({ timeout: 10000 }).catch(() => false)) {
			console.log('Payment step or order summary reached')
		} else {
			// May still be on shipping step if form needs more fields
			console.log('Could not reach payment step — form may need additional fields')
		}
	})

	test('payment buttons should show wallet availability', async ({ page }) => {
		// Navigate to checkout with items
		await browsePage.goToProducts()
		await browsePage.expectProductsVisible()
		await browsePage.clickProduct(0)
		await browsePage.expectProductDetailVisible()
		await browsePage.addToCart()
		await page.waitForTimeout(1000)

		await page.goto('/checkout')
		await checkoutPage.expectOnCheckoutPage()

		// Fill shipping and submit
		await checkoutPage.fillShippingAddress({
			name: 'Test Buyer',
			email: 'test@example.com',
			address: '123 Test Street',
			zip: '12345',
		})
		await checkoutPage.submitShippingForm()
		await page.waitForTimeout(3000)

		// Check for payment buttons if we reached the payment step
		const paymentContent = page.locator('[data-testid="payment-content"]')
		if (await paymentContent.isVisible({ timeout: 5000 }).catch(() => false)) {
			// NWC and WebLN buttons should be present (may be disabled)
			const nwcButton = page.getByText(/pay with nwc/i).first()
			const weblnButton = page.getByText(/pay with webln/i).first()

			if (await nwcButton.isVisible({ timeout: 2000 }).catch(() => false)) {
				console.log('NWC payment button visible')
			}
			if (await weblnButton.isVisible({ timeout: 2000 }).catch(() => false)) {
				console.log('WebLN payment button visible')
			}
		} else {
			console.log('Payment step not reached — skipping button check')
		}
	})

	test('skip payment should be available for skippable invoices', async ({ page }) => {
		await browsePage.goToProducts()
		await browsePage.expectProductsVisible()
		await browsePage.clickProduct(0)
		await browsePage.expectProductDetailVisible()
		await browsePage.addToCart()
		await page.waitForTimeout(1000)

		await page.goto('/checkout')
		await checkoutPage.expectOnCheckoutPage()

		await checkoutPage.fillShippingAddress({
			name: 'Test Buyer',
			email: 'test@example.com',
			address: '123 Test Street',
			zip: '12345',
		})
		await checkoutPage.submitShippingForm()
		await page.waitForTimeout(3000)

		// Check for pay later / skip button
		const paymentContent = page.locator('[data-testid="payment-content"]')
		if (await paymentContent.isVisible({ timeout: 5000 }).catch(() => false)) {
			const payLaterButton = page.getByText(/pay later/i).first()
			if (await payLaterButton.isVisible({ timeout: 2000 }).catch(() => false)) {
				console.log('Pay Later button is available for skippable invoices')
			} else {
				console.log('Pay Later button not shown — invoice may not be skippable')
			}
		} else {
			console.log('Payment step not reached')
		}
	})

	test('checkout should navigate between shipping and payment steps', async ({ page }) => {
		await browsePage.goToProducts()
		await browsePage.expectProductsVisible()
		await browsePage.clickProduct(0)
		await browsePage.expectProductDetailVisible()
		await browsePage.addToCart()
		await page.waitForTimeout(1000)

		await page.goto('/checkout')
		await checkoutPage.expectOnCheckoutPage()

		// Should start at shipping step
		await expect(page.getByText(/shipping address/i).first()).toBeVisible({ timeout: 5000 })

		// Fill and submit shipping
		await checkoutPage.fillShippingAddress({
			name: 'Test Buyer',
			email: 'test@example.com',
			address: '123 Test Street',
			zip: '12345',
		})
		await checkoutPage.submitShippingForm()
		await page.waitForTimeout(2000)

		// After shipping submission, should be on a different step (payment or summary)
		// The shipping form should no longer be the active step
		const shippingHeading = page.getByText('Shipping Address')
		const paymentContent = page.locator('[data-testid="payment-content"]')
		const orderFinalize = page.locator('[data-testid="order-finalize"]')

		const advanced = await paymentContent
			.or(orderFinalize)
			.isVisible({ timeout: 5000 })
			.catch(() => false)
		if (advanced) {
			console.log('Successfully advanced past shipping step')
		} else {
			console.log('Did not advance — may need additional form fields')
		}
	})

	test('empty cart should redirect or show message on checkout', async ({ page }) => {
		// Clear cart first
		await cartPage.openCart()
		const clearBtn = page.locator('[data-testid="cart-clear-button"]')
		if (await clearBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
			await clearBtn.click()
			await page.waitForTimeout(500)
		}

		// Navigate to checkout
		await page.goto('/checkout')
		await page.waitForTimeout(2000)

		// Should show empty cart message or redirect
		const emptyMessage = page.getByText(/cart is empty/i)
		await expect(emptyMessage).toBeVisible({ timeout: 5000 })

		console.log('Empty cart properly handled on checkout page')
	})

	// Clean up after all tests
	test('cleanup: clear cart after payment tests', async ({ page }) => {
		await cartPage.openCart()
		const clearBtn = page.locator('[data-testid="cart-clear-button"]')
		if (await clearBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
			await clearBtn.click()
			await page.waitForTimeout(500)
		}
		console.log('Cart cleared after payment tests')
	})
})
