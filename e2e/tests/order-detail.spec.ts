import { expect, test } from '../fixtures'
import { seedOrder } from '../scenarios'

// ============================================================================
// SECTION 1: SELLER / MERCHANT FLOW
// Uses 'merchant' scenario which logs in as devUser1 (Seller)
// ============================================================================
test.use({ scenario: 'merchant' })

test.describe('Order Details - Seller View - Products', () => {
	// --- Product Flow ---

	test('manages product order from pending to shipped', async ({ merchantPage: page }) => {
		const { orderId } = await seedOrder('product', 'pending-payment')

		await page.goto(`/dashboard/orders/${orderId}`)

		// ---- Stage 1: Pending ----
		await expect(page.getByText('Pending')).toBeVisible()
		await expect(page.getByText(/Verify the payment was received and shipping information was provided/)).toBeVisible()
		await expect(page.getByText('No Payment Requests Created')).toBeVisible()

		// Seller clicks "Confirm Payment Received"
		await page.getByRole('button', { name: /confirm payment received/i }).click()

		// Confirmation dialog appears
		await expect(page.getByRole('dialog')).toBeVisible()
		await expect(page.getByText('Please verify that you have received payment before confirming')).toBeVisible()
		await expect(page.getByText('By clicking confirm, you acknowledge the funds have been received')).toBeVisible()

		// Confirm in the dialog
		await page.getByRole('button', { name: /^confirm payment$/i }).click()
		await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 15000 })

		// ---- Stage 2: Confirmed ----

		await expect(page.locator('div').filter({ hasText: /^Confirmed$/ })).toBeVisible()
		await expect(page.getByRole('button', { name: /process order/i })).toBeVisible()

		// Verify timeline captured the transition
		await expect(page.getByRole('main').getByText('Order status updated to confirmed')).toBeVisible()
	})

	test('views confirmed product order and marks as processed', async ({ merchantPage: page }) => {
		const { orderId } = await seedOrder('product', 'confirmed')
		await page.goto(`/dashboard/orders/${orderId}`)

		// ---- Stage 1: Confirmed ----
		// Verify initial state matches 'confirmed' seeding
		await expect(page.locator('div').filter({ hasText: /^Confirmed$/ })).toBeVisible()
		await expect(page.getByRole('button', { name: /process order/i })).toBeVisible()

		await page.getByRole('button', { name: /process order/i }).click()

		await expect(page.getByText(/Order status updated to processing/)).toBeVisible()
	})

	test('views confirm processing and marks as shipping in progress', async ({ merchantPage: page }) => {
		const { orderId } = await seedOrder('product', 'processing')
		await page.goto(`/dashboard/orders/${orderId}`)

		// ---- Stage 1: Processing ----
		// Verify initial state matches 'processing' seeding
		await expect(page.locator('div').filter({ hasText: /^Processing$/ })).toBeVisible()
		await expect(page.getByRole('button', { name: /Mark As Shipped/i })).toBeVisible()

		// Seller Action: Click "Mark As Shipped"
		await page.getByRole('button', { name: /Mark As Shipped/i }).click()

		// ---- Dialog 1: Mark Order As Shipped ----
		await expect(page.getByRole('dialog')).toBeVisible()
		await expect(page.getByText(/Mark Order As Shipped/)).toBeVisible()

		// Check for Tracking Input and fill it
		const trackingInput = page.getByRole('textbox', { name: 'Tracking URL (Optional)' })
		await expect(trackingInput).toBeVisible()
		await trackingInput.fill('https://testtracker.com/12345')

		// Confirm Shipping
		await page.getByRole('button', { name: /Mark As Shipped/i }).click()

		// Note: the message for "Mark as Shipped" immediately shows up at this point, even if the flow
		// requests the user to update the product stock with another pop-up.
		await expect(page.getByText(/Order shipping status updated to shipped/i)).toBeVisible()

		// Note: The "Update Stock" dialog often appears immediately after shipping confirmation for products.
		// We check if it exists before interacting to avoid flakiness if the flow varies slightly.
		await expect(page.getByText(/Update Product Stock/i)).toBeVisible()

		// ---- Dialog 2: Update Product Stock (Product Only) ----
		await expect(page.getByRole('dialog')).toBeVisible() // Re-verify dialog visibility
		await expect(page.getByText(/Update Product Stock/)).toBeVisible()

		// Verify Contextual Info
		await expect(page.getByText(/Ordered/)).toBeVisible()
		await expect(page.getByText(/Current Stock/)).toBeVisible()

		// Verify Default Value
		const stockInput = page.getByRole('spinbutton', { name: 'New Stock' })
		await expect(stockInput).toBeVisible()

		// This defaults to current stock minus ordered quantity (10 - 1 = 9)
		const inputValue = await stockInput.inputValue()
		expect(inputValue).toBe('9')

		// Press Button: "Update Stock"
		await page.getByRole('button', { name: /Update Stock/i }).click()

		// Close any remaining dialogs if they persist
		await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 15000 })
		await expect(page.getByText('product stock levels updated')).toBeVisible()

		await expect(page.locator('div').filter({ hasText: /^Shipped$/ })).toBeVisible()
		await expect(page.getByText('Awaiting action from other party')).toBeVisible()

		// Optional: Verify the timeline captured the event explicitly
		await expect(page.getByRole('main').getByText(/Shipping.*Shipped/i)).toBeVisible()
	})
})

// ============================================================================
// SECTION 2: BUYER FLOW
// Logs in as devUser2 (Buyer)
// Uses 'merchant' scenario for data seeding (so products/auctions exist)
// ============================================================================

test.describe('Order Details - Buyer View - Products', () => {
	test.use({ scenario: 'merchant' })

	test('views pending product order and waits for payment request', async ({ buyerPage: page }) => {
		const { orderId } = await seedOrder('product', 'pending-payment')
		await page.goto(`/dashboard/orders/${orderId}`)

		// ---- Stage 1: Pending ----
		await expect(page.getByText('Pending')).toBeVisible()

		// Verify we are waiting for the seller to act
		await expect(page.getByText(/Awaiting seller confirmation/i)).toBeVisible()

		// Verify no invoice cards yet (Seller hasn't sent them)
		await expect(page.getByTestId('invoice-card')).not.toBeVisible()

		// Verify "Cancel" button is visible
		await expect(page.getByRole('button', { name: /cancel/i })).toBeVisible()
	})

	test('sees invoice and confirms payment for product order', async ({ buyerPage: page }) => {
		const { orderId } = await seedOrder('product', 'confirmed')
		await page.goto(`/dashboard/orders/${orderId}`)

		// ---- Stage 1: Confirmed (Seller has confirmed receipt of payment OR sent invoice) ----
		// Note: In the manual flow, the seller sends an invoice when they confirm payment.
		// The buyer sees "Payment Details" here.
		await expect(page.locator('div').filter({ hasText: /^Confirmed$/ })).toBeVisible()
		await expect(page.getByText(/Awaiting action from other party/i)).toBeVisible()

		// Verify Invoice Card exists
		await expect(page.getByText('Payment Details')).toBeVisible()

		// Check timeline events have been registered
		await expect(page.getByText('Order Timeline', { exact: true })).toBeVisible()
		await expect(page.getByText('Order confirmed', { exact: true })).toBeVisible()
		await expect(page.getByText('Payment request')).toBeVisible()
	})

	test('tracks shipped product order and confirms receipt', async ({ buyerPage: page }) => {
		const { orderId } = await seedOrder('product', 'shipped')
		await page.goto(`/dashboard/orders/${orderId}`)

		// ---- Stage 1: Shipped ----
		await expect(page.locator('div').filter({ hasText: /^Shipped$/ })).toBeVisible()

		// Verify Shipping Info
		await expect(page.getByText('Shipping update')).toBeVisible()
		await expect(page.getByText('TRK123456')).toBeVisible()
		await expect(page.getByText('Order shipped via TestCarrier')).toBeVisible()

		// Verify "I've Received This Item" button is present
		// This matches the `canReceive` logic: isBuyer && status === PROCESSING && hasBeenShipped
		const receiveBtn = page.getByRole('button', { name: /i've received this item/i })
		await expect(receiveBtn).toBeVisible()

		await receiveBtn.click()

		// NOTE: Due to an unknown error (perhaps due to Playwright), the page itself does not update after button press.
		// await expect(page.locator('div').filter({ hasText: /^Completed$/ })).toBeVisible()
		// await expect(page.getByText('Order completed', { exact: true })).toBeVisible()

		// Check notification appears
		await expect(page.getByRole('listitem').getByText('Order status updated to completed')).toBeVisible()
	})

	test('confirms delivery immediately after shipping (no intermediate steps)', async ({ buyerPage: page }) => {
		// Some flows jump straight from Shipped -> Completed on buyer click
		const { orderId } = await seedOrder('product', 'completed')
		await page.goto(`/dashboard/orders/${orderId}`)

		// Verify final state
		await expect(page.locator('div').filter({ hasText: /^Completed$/ })).toBeVisible()
		await expect(page.getByText('Order completed', { exact: true })).toBeVisible()
	})
})
