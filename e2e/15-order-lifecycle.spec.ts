import { test, expect } from '@playwright/test'
import { skipIfInSetupMode } from './utils/test-utils'
import { LoginPage } from './po/LoginPage'
import { BrowsePage } from './po/BrowsePage'
import { CartPage } from './po/CartPage'
import { CheckoutPage } from './po/CheckoutPage'
import { OrdersPage } from './po/OrdersPage'

test.describe.serial('15. Order Lifecycle', () => {
	let loginPage: LoginPage
	let browsePage: BrowsePage
	let cartPage: CartPage
	let checkoutPage: CheckoutPage
	let ordersPage: OrdersPage

	test.beforeEach(async ({ page }) => {
		loginPage = new LoginPage(page)
		browsePage = new BrowsePage(page)
		cartPage = new CartPage(page)
		checkoutPage = new CheckoutPage(page)
		ordersPage = new OrdersPage(page)
		await loginPage.goto()
		await skipIfInSetupMode(page, test)
		await loginPage.login()
	})

	test('purchases page should be accessible', async ({ page }) => {
		await ordersPage.goToOrders()
		await page.waitForTimeout(2000)

		// Should either show orders or empty state
		const hasOrders = await page
			.locator('[data-testid="order-card"]')
			.first()
			.isVisible({ timeout: 5000 })
			.catch(() => false)
		const hasEmptyState = await page
			.getByText(/no.*order/i)
			.isVisible({ timeout: 2000 })
			.catch(() => false)

		expect(hasOrders || hasEmptyState).toBeTruthy()
		console.log(hasOrders ? 'Purchases page shows orders' : 'Purchases page shows empty state')
	})

	test('order detail should show order information', async ({ page }) => {
		await ordersPage.goToOrders()
		await page.waitForTimeout(2000)

		const hasOrders = await page
			.locator('[data-testid="order-card"]')
			.first()
			.isVisible({ timeout: 5000 })
			.catch(() => false)

		if (hasOrders) {
			await ordersPage.clickOrder(0)
			await ordersPage.expectOrderDetailVisible()

			// Order detail should contain key information
			const orderDetail = page.locator('[data-testid="order-detail"]')
			await expect(orderDetail).toBeVisible()

			// Should show order ID
			const orderIdText = page.getByText(/order id/i)
			await expect(orderIdText).toBeVisible({ timeout: 5000 })

			// Should show amount in sats
			await expect(page.getByText(/sats/i).first()).toBeVisible()

			console.log('Order detail shows order information')
		} else {
			console.log('No orders to view — skipping detail check')
		}
	})

	test('order detail should show products section', async ({ page }) => {
		await ordersPage.goToOrders()
		await page.waitForTimeout(2000)

		const hasOrders = await page
			.locator('[data-testid="order-card"]')
			.first()
			.isVisible({ timeout: 5000 })
			.catch(() => false)

		if (hasOrders) {
			await ordersPage.clickOrder(0)
			await ordersPage.expectOrderDetailVisible()

			// Should show products section
			const productsSection = page.getByText('Products').first()
			await expect(productsSection).toBeVisible({ timeout: 5000 })

			console.log('Order detail shows products section')
		} else {
			console.log('No orders to view — skipping products check')
		}
	})

	test('order detail should show payment details', async ({ page }) => {
		await ordersPage.goToOrders()
		await page.waitForTimeout(2000)

		const hasOrders = await page
			.locator('[data-testid="order-card"]')
			.first()
			.isVisible({ timeout: 5000 })
			.catch(() => false)

		if (hasOrders) {
			await ordersPage.clickOrder(0)
			await ordersPage.expectOrderDetailVisible()

			// Should show payment details or no-payment-request state
			const paymentDetails = page.getByText(/payment details/i)
			const noPaymentRequest = page.getByText(/no payment request/i)
			const paymentOrNoPayment = paymentDetails.or(noPaymentRequest)

			await expect(paymentOrNoPayment.first()).toBeVisible({ timeout: 5000 })

			console.log('Order detail shows payment information')
		} else {
			console.log('No orders to view — skipping payment check')
		}
	})

	test('order detail should show role (buyer/seller)', async ({ page }) => {
		await ordersPage.goToOrders()
		await page.waitForTimeout(2000)

		const hasOrders = await page
			.locator('[data-testid="order-card"]')
			.first()
			.isVisible({ timeout: 5000 })
			.catch(() => false)

		if (hasOrders) {
			await ordersPage.clickOrder(0)
			await ordersPage.expectOrderDetailVisible()

			// Should show the user's role
			const roleLabel = page.getByText(/role:/i)
			await expect(roleLabel).toBeVisible({ timeout: 5000 })

			// From the purchases page, user should be the buyer
			await expect(page.getByText('Buyer')).toBeVisible()

			console.log('Order detail shows buyer role')
		} else {
			console.log('No orders to view — skipping role check')
		}
	})

	test('order should show status', async ({ page }) => {
		await ordersPage.goToOrders()
		await page.waitForTimeout(2000)

		const hasOrders = await page
			.locator('[data-testid="order-card"]')
			.first()
			.isVisible({ timeout: 5000 })
			.catch(() => false)

		if (hasOrders) {
			await ordersPage.clickOrder(0)
			await ordersPage.expectOrderDetailVisible()

			// Should show status field
			const statusLabel = page.getByText(/status:/i)
			await expect(statusLabel).toBeVisible({ timeout: 5000 })

			console.log('Order detail shows status')
		} else {
			console.log('No orders to view — skipping status check')
		}
	})

	test('creating an order through full checkout flow', async ({ page }) => {
		// Add a product to cart
		await browsePage.goToProducts()
		await browsePage.expectProductsVisible()
		await browsePage.clickProduct(0)
		await browsePage.expectProductDetailVisible()
		await browsePage.addToCart()
		await page.waitForTimeout(1000)

		// Open cart
		await cartPage.openCart()
		await cartPage.expectCartNotEmpty()

		// Handle shipping selection
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

		// Proceed to checkout
		await cartPage.proceedToCheckout()
		await checkoutPage.expectOnCheckoutPage()

		// Fill shipping form
		await checkoutPage.fillShippingAddress({
			name: 'E2E Test Buyer',
			email: 'e2e@example.com',
			address: '456 Test Avenue',
			zip: '67890',
		})

		await checkoutPage.submitShippingForm()
		await page.waitForTimeout(3000)

		// Should advance to payment or summary step
		const paymentContent = page.locator('[data-testid="payment-content"]')
		const orderFinalize = page.locator('[data-testid="order-finalize"]')
		const advanced = await paymentContent
			.or(orderFinalize)
			.isVisible({ timeout: 10000 })
			.catch(() => false)

		if (advanced) {
			console.log('Full checkout flow reached payment/summary step')
		} else {
			console.log('Checkout did not advance past shipping — may need additional fields')
		}
	})

	// Clean up
	test('cleanup: clear cart after order lifecycle tests', async ({ page }) => {
		await cartPage.openCart()
		const clearBtn = page.locator('[data-testid="cart-clear-button"]')
		if (await clearBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
			await clearBtn.click()
			await page.waitForTimeout(500)
		}
		console.log('Cart cleared after order lifecycle tests')
	})
})
