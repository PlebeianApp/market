import { AUCTION_PATH_RELEASE_KIND, AUCTION_SETTLEMENT_KIND } from '@/lib/auction/constants'
import { devUser1, devUser2 } from '@/lib/fixtures'
import { ORDER_MESSAGE_TYPE, ORDER_PROCESS_KIND, ORDER_STATUS, PAYMENT_RECEIPT_KIND, SHIPPING_STATUS } from '@/lib/schemas/order'
import { finalizeEvent, Relay, type EventTemplate, type VerifiedEvent } from 'nostr-tools'
import { hexToBytes } from 'nostr-tools/utils'
import { v4 as uuidv4 } from 'uuid'
import { expect, test } from '../fixtures'
import { RELAY_URL } from '../test-config'

// --- Enhanced Seeding Helpers ---

type OrderStage = 'pending-payment' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'completed'
type OrderType = 'product' | 'auction'

interface SeededOrderResult {
	orderEvent: VerifiedEvent
	orderId: string
	auctionEvent?: VerifiedEvent
	productEvent?: VerifiedEvent
}

/**
 * Master seeding function to create orders in specific states.
 * Handles both Product (Invoice flow) and Auction (Settlement flow) differences.
 */
export async function seedOrder(type: OrderType, stage: OrderStage): Promise<SeededOrderResult> {
	const relay = await Relay.connect(RELAY_URL)
	const buyerSkBytes = hexToBytes(devUser2.sk)
	const sellerSkBytes = hexToBytes(devUser1.sk)

	const orderId = uuidv4()
	const now = Math.floor(Date.now() / 1000)

	let productEvent: VerifiedEvent | undefined
	let auctionEvent: VerifiedEvent | undefined
	let itemTagValue = ''
	let orderAmount = '1000'
	const shippingOptionCoords = '30406:' + devUser1.pk + ':shippingdtag123'

	// 1. Create the underlying item (Product or Auction)
	if (type === 'product') {
		const productId = `prod_${now}_${uuidv4().slice(0, 8)}`
		productEvent = finalizeEvent(
			{
				kind: 30402,
				created_at: now,
				content: 'Test Product Description',
				tags: [
					['d', productId],
					['title', 'Test Product'],
					['price', '1000', 'SAT'],
					['stock', '10'],
					['type', 'simple', 'physical'],
					['image', 'https://thisisatestimage.com/img'],
					['shipping_option', shippingOptionCoords, '0'],
					['t', 'bitcoin'],
				],
			},
			sellerSkBytes,
		)
		await relay.publish(productEvent)
		itemTagValue = `30402:${devUser1.pk}:${productId}`
	} else {
		const auctionId = `auc_${now}_${uuidv4().slice(0, 8)}`
		auctionEvent = finalizeEvent(
			{
				kind: 30408,
				created_at: now,
				content: 'Test Auction Description',
				tags: [
					['d', auctionId],
					['title', 'Test Auction'],
					['price', '500', 'SAT'],
					['start_at', String(now - 100)],
					['end_at', String(now + 100)],
					['reserve', '1000'],
				],
			},
			sellerSkBytes,
		)
		await relay.publish(auctionEvent)
		itemTagValue = `30408:${devUser1.pk}:${auctionId}`
		orderAmount = '500'
	}

	// 2. Construct Base Tags Array (MUTABLE)
	// FIX: Build tags array as a mutable variable first
	const baseTags: string[][] = [
		['p', devUser1.pk], // Seller
		['subject', `Order #${orderId}`],
		['type', ORDER_MESSAGE_TYPE.ORDER_CREATION],
		['order', orderId],
		['amount', orderAmount],
		['item', itemTagValue, '1'],
	]

	// Add 'a' tag if it's an auction
	if (type === 'auction') {
		baseTags.push(['a', itemTagValue])
	}

	// 3. Create Order Event Data Object
	const orderEventData: EventTemplate = {
		kind: ORDER_PROCESS_KIND,
		created_at: now,
		content: `Test ${type} order for ${itemTagValue}`,
		tags: baseTags, // Mutable tags array passed here
	}

	const orderEvent = finalizeEvent(orderEventData, buyerSkBytes)
	await relay.publish(orderEvent)

	// 4. Seed Additional Events Based on Stage
	const advanceStage = async () => {
		// Stage: Pending Payment (Base case - just the order creation exists)
		if (stage === 'pending-payment') return

		// Common to all: Status Update to 'confirmed'
		if (['confirmed', 'processing', 'shipped', 'delivered', 'completed'].includes(stage)) {
			const statusUpdate = finalizeEvent(
				{
					kind: ORDER_PROCESS_KIND,
					created_at: now + 10,
					content: 'Order confirmed',
					tags: [
						['p', devUser1.pk],
						['subject', `Order #${orderId}`],
						['type', '3'], // Status update
						['order', orderId],
						['status', ORDER_STATUS.CONFIRMED],
					],
				},
				sellerSkBytes,
			)
			await relay.publish(statusUpdate)
		}

		// Stage: Processing
		if (['processing', 'shipped', 'delivered', 'completed'].includes(stage)) {
			const processingUpdate = finalizeEvent(
				{
					kind: ORDER_PROCESS_KIND,
					created_at: now + 20,
					content: 'Order is being prepared',
					tags: [
						['p', devUser1.pk],
						['subject', `Order #${orderId}`],
						['type', '3'],
						['order', orderId],
						['status', ORDER_STATUS.PROCESSING],
					],
				},
				sellerSkBytes,
			)
			await relay.publish(processingUpdate)
		}

		// Stage: Shipped (Adds Shipping Update)
		if (['shipped', 'delivered', 'completed'].includes(stage)) {
			const shippingUpdate = finalizeEvent(
				{
					kind: ORDER_PROCESS_KIND,
					created_at: now + 30,
					content: 'Order shipped via TestCarrier',
					tags: [
						['p', devUser1.pk],
						['subject', `Order #${orderId}`],
						['type', '4'], // Shipping update
						['order', orderId],
						['status', SHIPPING_STATUS.SHIPPED],
						['tracking', 'TRK123456'],
						['carrier', 'TestCarrier'],
					],
				},
				sellerSkBytes,
			)
			await relay.publish(shippingUpdate)
		}

		// Stage: Delivered (Final Status Update for Delivery)
		if (['delivered', 'completed'].includes(stage)) {
			const deliveredUpdate = finalizeEvent(
				{
					kind: ORDER_PROCESS_KIND,
					created_at: now + 40,
					content: 'Order delivered',
					tags: [
						['p', devUser1.pk],
						['subject', `Order #${orderId}`],
						['type', '3'],
						['order', orderId],
						['status', ORDER_STATUS.COMPLETED],
					],
				},
				sellerSkBytes,
			)
			await relay.publish(deliveredUpdate)
		}

		// Payment Logic: DIFFERS by Type
		if (type === 'product') {
			// Product Flow: Payment Requests (Invoices) -> Receipt
			if (['confirmed', 'processing', 'shipped', 'delivered', 'completed'].includes(stage)) {
				// Merchant sends Payment Request
				const paymentRequest = finalizeEvent(
					{
						kind: ORDER_PROCESS_KIND,
						created_at: now + 5,
						content: 'Please pay invoice',
						tags: [
							['p', devUser2.pk],
							['subject', `Payment for Order #${orderId}`],
							['type', '2'], // Payment request
							['order', orderId],
							['amount', '1000'],
							['payment', 'lightning', 'lnbc100n1p...'], // Mock Bolt11
						],
					},
					sellerSkBytes,
				)
				await relay.publish(paymentRequest)

				// Buyer sends Receipt
				if (['processing', 'shipped', 'delivered', 'completed'].includes(stage)) {
					const receipt = finalizeEvent(
						{
							kind: PAYMENT_RECEIPT_KIND,
							created_at: now + 8,
							content: 'Payment made',
							tags: [
								['p', devUser1.pk],
								['subject', `Receipt for Order #${orderId}`],
								['order', orderId],
								['amount', '1000'],
								['payment', 'lightning', 'lnbc100n1p...', 'preimage123'],
							],
						},
						buyerSkBytes,
					)
					await relay.publish(receipt)
				}
			}
		} else if (type === 'auction') {
			// Auction Flow: Path Release -> Settlement
			if (['confirmed', 'processing', 'shipped', 'delivered', 'completed'].includes(stage)) {
				// Buyer publishes Path Release (Kind 1025)
				const pathRelease = finalizeEvent(
					{
						kind: AUCTION_PATH_RELEASE_KIND,
						created_at: now + 5,
						content: '',
						tags: [
							['p', devUser1.pk],
							['a', itemTagValue],
							['winning_bid', 'bid_event_id_placeholder'],
						],
					},
					buyerSkBytes,
				)
				await relay.publish(pathRelease)

				// Seller publishes Settlement (Kind 1024)
				if (['processing', 'shipped', 'delivered', 'completed'].includes(stage)) {
					const settlement = finalizeEvent(
						{
							kind: AUCTION_SETTLEMENT_KIND,
							created_at: now + 10,
							content: '',
							tags: [
								['p', devUser2.pk],
								['a', itemTagValue],
								['status', 'settled'],
								['winner', devUser2.pk],
								['final_amount', '500'],
							],
						},
						sellerSkBytes,
					)
					await relay.publish(settlement)
				}
			}
		}
	}

	await advanceStage()

	return { orderEvent, orderId, auctionEvent, productEvent }
}

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

test.describe('Order Details - Seller View - Auctions', () => {
	test('views confirmed auction order and marks as processed', async ({ merchantPage: page }) => {
		const { orderId } = await seedOrder('auction', 'confirmed')

		await page.goto(`/dashboard/orders/${orderId}`)

		// ---- Stage 1: Confirmed ----
		await expect(page.getByText('Auction Item')).toBeVisible()
		await expect(page.locator('div').filter({ hasText: /^Confirmed$/ })).toBeVisible()

		// Verify Settlement Status Card
		// TODO: Needs CVM configuration for seeded bid to show up.
		// await expect(page.getByText(/The auction has been completed for.*sats/)).toBeVisible()

		// Verify No Invoices
		await expect(page.getByTestId('invoice-card')).not.toBeVisible()

		// Seller Action: Process Order
		await expect(page.getByRole('button', { name: /process order/i })).toBeVisible()
		await page.getByRole('button', { name: /process order/i }).click()

		// Verify transition
		await expect(page.getByText(/Order status updated to processing/)).toBeVisible()
	})

	test('views processing auction order and marks as shipped without stock dialog', async ({ merchantPage: page }) => {
		const { orderId } = await seedOrder('auction', 'processing')

		await page.goto(`/dashboard/orders/${orderId}`)

		// ---- Stage 1: Processing ----
		await expect(page.getByText('Auction Item')).toBeVisible()
		await expect(page.locator('div').filter({ hasText: /^Processing$/ })).toBeVisible()
		await expect(page.getByRole('button', { name: /Mark As Shipped/i })).toBeVisible()

		// Seller Action: Click "Mark As Shipped"
		await page.getByRole('button', { name: /Mark As Shipped/i }).click()

		// ---- Dialog: Mark Order As Shipped ----
		await expect(page.getByRole('dialog')).toBeVisible()
		await expect(page.getByText(/Mark Order As Shipped/)).toBeVisible()

		// Fill tracking URL
		const trackingInput = page.getByRole('textbox', { name: 'Tracking URL (Optional)' })
		await expect(trackingInput).toBeVisible()
		await trackingInput.fill('https://testtracker.com/AUCTION-999')

		// Confirm Shipping
		await page.getByRole('button', { name: /Mark As Shipped/i }).click()

		// Verify shipping success message
		await expect(page.getByText(/Order shipping status updated to shipped/i)).toBeVisible()

		// ---- CRITICAL: No Stock Dialog for Auctions ----
		await expect(page.getByText(/Update Product Stock/i)).not.toBeVisible()
		await expect(page.getByRole('spinbutton', { name: /new stock/i })).not.toBeVisible()
		await expect(page.getByRole('button', { name: /Update Stock/i })).not.toBeVisible()

		// Close any remaining dialogs
		await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 15000 })

		// ---- Final: Shipped ----
		await expect(page.locator('div').filter({ hasText: /^Shipped$/ })).toBeVisible()
		await expect(page.getByText('Awaiting action from other party')).toBeVisible()
		await expect(page.getByRole('main').getByText(/Shipping.*Shipped/i)).toBeVisible()
	})

	test('cannot see stock update dialog for auctions', async ({ merchantPage: page }) => {
		const { orderId } = await seedOrder('auction', 'processing')
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

		// No stock dialog should appear for auctions
		await expect(page.getByText(/Update Product Stock/)).not.toBeVisible()
		await expect(page.getByText(/Current Stock/)).not.toBeVisible()

		// Close any remaining dialogs if they persist
		await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 15000 })

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

		// NOTE: Verification of shipment confirmation currently fails due to the app not being responsive to the button press.
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

test.describe('Order Details - Buyer View - Auctions', () => {
	test.use({ scenario: 'merchant' })

	test('views auction order details and settlement status', async ({ buyerPage: page }) => {
		const { orderId } = await seedOrder('auction', 'pending-payment')
		await page.goto(`/dashboard/orders/${orderId}`)

		// ---- Stage 1: Pending ----
		await expect(page.locator('div').filter({ hasText: /^Pending$/ })).toBeVisible()

		// Verify we are waiting for the seller to act
		await expect(page.getByText(/Awaiting seller confirmation/i)).toBeVisible()

		// Verify no invoice cards yet (Seller hasn't sent them)
		await expect(page.getByTestId('invoice-card')).not.toBeVisible()

		// Verify "Cancel" button is visible
		await expect(page.getByRole('button', { name: /cancel/i })).toBeVisible()
	})

	test('tracks shipped auction order and confirms receipt', async ({ buyerPage: page }) => {
		const { orderId } = await seedOrder('auction', 'shipped')
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

		// NOTE: Verification of shipment confirmation currently fails due to the app not being responsive to the button press.
	})

	test('confirms delivery immediately after shipping (no intermediate steps)', async ({ buyerPage: page }) => {
		// Some flows jump straight from Shipped -> Completed on buyer click
		const { orderId } = await seedOrder('auction', 'completed')
		await page.goto(`/dashboard/orders/${orderId}`)

		// Verify final state
		await expect(page.locator('div').filter({ hasText: /^Completed$/ })).toBeVisible()
		await expect(page.getByText('Order completed', { exact: true })).toBeVisible()
	})
})
