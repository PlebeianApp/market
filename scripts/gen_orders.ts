import {
	ORDER_GENERAL_KIND,
	ORDER_MESSAGE_TYPE,
	ORDER_PROCESS_KIND,
	ORDER_STATUS,
	PAYMENT_RECEIPT_KIND,
	SHIPPING_STATUS,
	type OrderCreationSchema,
} from '@/lib/schemas/order'
import { faker } from '@faker-js/faker'
import NDK, { NDKEvent, type NDKPrivateKeySigner, type NDKTag } from '@nostr-dev-kit/ndk'
import type { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'

// V4V share interface for seeding
interface V4VRecipient {
	pubkey: string
	percentage: number
}

// Structure for payment request data with V4V support
interface PaymentRequestWithRecipient {
	recipientPubkey: string
	amount: string
	description: string
	isV4V: boolean
}

// Timestamps for seeding (seconds since epoch)
const MIN_SEED_TIMESTAMP = 1704067200 // January 1, 2024, 00:00:00 UTC
const MAX_SEED_TIMESTAMP = 1748927999 // June 3, 2025, 23:59:59 UTC

// Helper to get a random timestamp within the defined seeding range
function getRandomPastTimestamp(min = MIN_SEED_TIMESTAMP, max = MAX_SEED_TIMESTAMP): number {
	return faker.number.int({ min, max })
}

// Helper to create a small random time increment (e.g., 1 to 300 seconds)
function getRandomTimeIncrement(minSeconds = 1, maxSeconds = 300): number {
	return faker.number.int({ min: minSeconds, max: maxSeconds })
}

/**
 * Generates random data for an order creation event (kind 16, type 1)
 */
export function generateOrderCreationData(
	buyerPubkey: string,
	sellerPubkey: string,
	productRef: string,
	baseTimestamp?: number, // Optional base timestamp for sequential creation
): Omit<z.infer<typeof OrderCreationSchema>, 'tags'> & { tags: NDKTag[]; created_at: number } {
	const orderId = uuidv4()
	const quantity = faker.number.int({ min: 1, max: 5 }).toString()
	const priceInSats = faker.number.int({ min: 1000, max: 100000 }).toString() // Price in satoshis
	const totalAmount = (parseInt(priceInSats) * parseInt(quantity)).toString()

	let createdAt: number
	if (baseTimestamp) {
		createdAt = Math.min(baseTimestamp + getRandomTimeIncrement(1, 5), MAX_SEED_TIMESTAMP)
	} else {
		createdAt = getRandomPastTimestamp()
	}
	// Ensure it's not before MIN_SEED_TIMESTAMP, especially if baseTimestamp was very low (though unlikely with current setup)
	createdAt = Math.max(createdAt, MIN_SEED_TIMESTAMP)

	const tags: NDKTag[] = [
		// Required tags
		['p', sellerPubkey], // Merchant's pubkey
		['subject', `Order for ${productRef.split(':').pop()}`],
		['type', ORDER_MESSAGE_TYPE.ORDER_CREATION],
		['order', orderId],
		['amount', totalAmount],
		['item', productRef, quantity],

		// Optional tags
		['address', faker.location.streetAddress() + ', ' + faker.location.city() + ', ' + faker.location.country()],
		['email', faker.internet.email()],
		['phone', faker.phone.number()],
	]

	return {
		kind: ORDER_PROCESS_KIND,
		created_at: createdAt,
		content: faker.commerce.productDescription(),
		tags,
	}
}

/**
 * Creates and publishes an order creation event
 */
export async function createOrderEvent(
	signer: NDKPrivateKeySigner,
	ndk: NDK,
	orderData: ReturnType<typeof generateOrderCreationData>,
): Promise<{ eventId: string | null; createdAt: number }> {
	// Return createdAt
	const event = new NDKEvent(ndk)
	event.kind = orderData.kind
	event.content = orderData.content
	event.tags = orderData.tags
	event.created_at = orderData.created_at

	try {
		await event.sign(signer)
		await event.publish()
		console.log(`Published order creation: ${orderData.tags.find((tag) => tag[0] === 'order')?.[1]} at ${orderData.created_at}`)
		return { eventId: event.id, createdAt: orderData.created_at }
	} catch (error) {
		console.error(`Failed to publish order creation`, error)
		return { eventId: null, createdAt: orderData.created_at }
	}
}

/**
 * Generates data for a payment request event (kind 16, type 2)
 */
export function generatePaymentRequestData(
	buyerPubkey: string,
	orderId: string,
	amount: string,
	baseTimestamp?: number, // Optional base timestamp
	isManualProcessing: boolean = true,
	recipientLightningAddress?: string, // Optional real lightning address
): { kind: typeof ORDER_PROCESS_KIND; created_at: number; content: string; tags: NDKTag[] } {
	let createdAt: number
	if (baseTimestamp) {
		createdAt = Math.min(baseTimestamp + getRandomTimeIncrement(), MAX_SEED_TIMESTAMP)
	} else {
		// This case should ideally not happen if seed.ts provides a baseTimestamp from the order creation
		createdAt = getRandomPastTimestamp()
	}
	createdAt = Math.max(createdAt, MIN_SEED_TIMESTAMP)

	// Use real lightning address if provided, otherwise use the fixture default
	const lightningAddress = recipientLightningAddress || 'plebeianuser@coinos.io'

	const tags: NDKTag[] = [
		// Required tags
		['p', buyerPubkey], // Buyer's pubkey for manual processing
		['subject', 'order-payment'],
		['type', ORDER_MESSAGE_TYPE.PAYMENT_REQUEST],
		['order', orderId],
		['amount', amount],
		['payment', 'lightning', lightningAddress], // Use real lightning address
	]

	// Add expiration for lightning payments (1 hour from creation)
	const expirationTime = createdAt + 3600
	tags.push(['expiration', expirationTime.toString()])

	return {
		kind: ORDER_PROCESS_KIND,
		created_at: createdAt,
		content: `Please pay ${amount} sats using Lightning Network. Lightning address: ${lightningAddress}`,
		tags,
	}
}

/**
 * Creates and publishes a payment request event
 */
export async function createPaymentRequestEvent(
	signer: NDKPrivateKeySigner,
	ndk: NDK,
	paymentData: ReturnType<typeof generatePaymentRequestData>,
): Promise<{ eventId: string | null; createdAt: number }> {
	// Return createdAt
	const event = new NDKEvent(ndk)
	event.kind = paymentData.kind
	event.content = paymentData.content
	event.tags = paymentData.tags
	event.created_at = paymentData.created_at

	try {
		await event.sign(signer)
		await event.publish()
		console.log(
			`Published payment request for order: ${paymentData.tags.find((tag) => tag[0] === 'order')?.[1]} at ${paymentData.created_at}`,
		)
		return { eventId: event.id, createdAt: paymentData.created_at }
	} catch (error) {
		console.error(`Failed to publish payment request`, error)
		return { eventId: null, createdAt: paymentData.created_at }
	}
}

/**
 * Generates data for an order status update event (kind 16, type 3)
 */
export function generateOrderStatusData(
	buyerPubkey: string,
	orderId: string,
	status: (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS] = ORDER_STATUS.PENDING,
	baseTimestamp?: number, // Optional base timestamp
): { kind: typeof ORDER_PROCESS_KIND; created_at: number; content: string; tags: NDKTag[] } {
	let createdAt: number
	if (baseTimestamp) {
		createdAt = Math.min(baseTimestamp + getRandomTimeIncrement(), MAX_SEED_TIMESTAMP)
	} else {
		createdAt = getRandomPastTimestamp()
	}
	createdAt = Math.max(createdAt, MIN_SEED_TIMESTAMP)

	const tags: NDKTag[] = [
		// Required tags
		['p', buyerPubkey],
		['subject', 'order-info'],
		['type', ORDER_MESSAGE_TYPE.STATUS_UPDATE],
		['order', orderId],
		['status', status],
	]

	const statusMessages = {
		[ORDER_STATUS.PENDING]: 'Your order has been received and is waiting for payment.',
		[ORDER_STATUS.CONFIRMED]: 'Payment received! Your order is confirmed.',
		[ORDER_STATUS.PROCESSING]: 'We are preparing your order for shipment.',
		[ORDER_STATUS.COMPLETED]: 'Your order has been completed. Thank you for your business!',
		[ORDER_STATUS.CANCELLED]: 'Your order has been cancelled.',
	}

	return {
		kind: ORDER_PROCESS_KIND,
		created_at: createdAt,
		content: statusMessages[status] || `Order status updated to: ${status}`,
		tags,
	}
}

/**
 * Creates and publishes an order status event
 */
export async function createOrderStatusEvent(
	signer: NDKPrivateKeySigner,
	ndk: NDK,
	statusData: ReturnType<typeof generateOrderStatusData>,
): Promise<{ eventId: string | null; createdAt: number }> {
	// Return createdAt
	const event = new NDKEvent(ndk)
	event.kind = statusData.kind
	event.content = statusData.content
	event.tags = statusData.tags
	event.created_at = statusData.created_at

	try {
		await event.sign(signer)
		await event.publish()
		console.log(
			`Published order status update: ${statusData.tags.find((tag) => tag[0] === 'status')?.[1]} for order ${statusData.tags.find((tag) => tag[0] === 'order')?.[1]} at ${statusData.created_at}`,
		)
		return { eventId: event.id, createdAt: statusData.created_at }
	} catch (error) {
		console.error(`Failed to publish order status update`, error)
		return { eventId: null, createdAt: statusData.created_at }
	}
}

/**
 * Generates data for a shipping update event (kind 16, type 4)
 */
export function generateShippingUpdateData(
	buyerPubkey: string,
	orderId: string,
	status: (typeof SHIPPING_STATUS)[keyof typeof SHIPPING_STATUS] = SHIPPING_STATUS.PROCESSING,
	baseTimestamp?: number, // Optional base timestamp
): { kind: typeof ORDER_PROCESS_KIND; created_at: number; content: string; tags: NDKTag[] } {
	let createdAt: number
	if (baseTimestamp) {
		createdAt = Math.min(baseTimestamp + getRandomTimeIncrement(), MAX_SEED_TIMESTAMP)
	} else {
		createdAt = getRandomPastTimestamp()
	}
	createdAt = Math.max(createdAt, MIN_SEED_TIMESTAMP)

	const tags: NDKTag[] = [
		// Required tags
		['p', buyerPubkey],
		['subject', 'shipping-info'],
		['type', ORDER_MESSAGE_TYPE.SHIPPING_UPDATE],
		['order', orderId],
		['status', status],
	]

	// Add optional tracking info for shipped status
	if (status === SHIPPING_STATUS.SHIPPED || status === SHIPPING_STATUS.DELIVERED) {
		const carriers = ['FedEx', 'UPS', 'DHL', 'USPS', 'Royal Mail']
		const carrier = faker.helpers.arrayElement(carriers)
		const trackingNumber = faker.string.alphanumeric(12).toUpperCase()

		tags.push(['carrier', carrier])
		tags.push(['tracking', trackingNumber])

		// Add ETA for shipped status
		if (status === SHIPPING_STATUS.SHIPPED) {
			const etaTimestamp = createdAt + faker.number.int({ min: 86400, max: 604800 }) // 1-7 days from now
			tags.push(['eta', etaTimestamp.toString()])
		}
	}

	const statusMessages = {
		[SHIPPING_STATUS.PROCESSING]: 'Your order is being prepared for shipping.',
		[SHIPPING_STATUS.SHIPPED]: 'Your order has been shipped! Track your package using the provided information.',
		[SHIPPING_STATUS.DELIVERED]: 'Your order has been delivered. Thank you for your business!',
		[SHIPPING_STATUS.EXCEPTION]: 'There is an issue with your shipment. We will contact you shortly.',
	}

	return {
		kind: ORDER_PROCESS_KIND,
		created_at: createdAt,
		content: statusMessages[status] || `Shipping status updated to: ${status}`,
		tags,
	}
}

/**
 * Creates and publishes a shipping update event
 */
export async function createShippingUpdateEvent(
	signer: NDKPrivateKeySigner,
	ndk: NDK,
	shippingData: ReturnType<typeof generateShippingUpdateData>,
): Promise<{ eventId: string | null; createdAt: number }> {
	// Return createdAt
	const event = new NDKEvent(ndk)
	event.kind = shippingData.kind
	event.content = shippingData.content
	event.tags = shippingData.tags
	event.created_at = shippingData.created_at

	try {
		await event.sign(signer)
		await event.publish()
		console.log(
			`Published shipping update: ${shippingData.tags.find((tag) => tag[0] === 'status')?.[1]} for order ${shippingData.tags.find((tag) => tag[0] === 'order')?.[1]} at ${shippingData.created_at}`,
		)
		return { eventId: event.id, createdAt: shippingData.created_at }
	} catch (error) {
		console.error(`Failed to publish shipping update`, error)
		return { eventId: null, createdAt: shippingData.created_at }
	}
}

/**
 * Generates data for a general communication event (kind 14)
 */
export function generateGeneralCommunicationData(
	recipientPubkey: string,
	orderId?: string,
	baseTimestamp?: number, // Optional base timestamp
): { kind: typeof ORDER_GENERAL_KIND; created_at: number; content: string; tags: NDKTag[] } {
	let createdAt: number
	if (baseTimestamp) {
		createdAt = Math.min(baseTimestamp + getRandomTimeIncrement(), MAX_SEED_TIMESTAMP)
	} else {
		createdAt = getRandomPastTimestamp()
	}
	createdAt = Math.max(createdAt, MIN_SEED_TIMESTAMP)

	const tags: NDKTag[] = [
		// Required tags
		['p', recipientPubkey],
	]

	// Add optional subject (order ID)
	if (orderId) {
		tags.push(['subject', orderId])
	}

	return {
		kind: ORDER_GENERAL_KIND,
		created_at: createdAt,
		content: faker.lorem.paragraph(),
		tags,
	}
}

/**
 * Creates and publishes a general communication event
 */
export async function createGeneralCommunicationEvent(
	signer: NDKPrivateKeySigner,
	ndk: NDK,
	communicationData: ReturnType<typeof generateGeneralCommunicationData>,
): Promise<{ eventId: string | null; createdAt: number }> {
	// Return createdAt
	const event = new NDKEvent(ndk)
	event.kind = communicationData.kind
	event.content = communicationData.content
	event.tags = communicationData.tags
	event.created_at = communicationData.created_at

	try {
		await event.sign(signer)
		await event.publish()
		console.log(
			`Published general communication to: ${communicationData.tags.find((tag) => tag[0] === 'p')?.[1].substring(0, 8)} at ${communicationData.created_at}`,
		)
		return { eventId: event.id, createdAt: communicationData.created_at }
	} catch (error) {
		console.error(`Failed to publish general communication`, error)
		return { eventId: null, createdAt: communicationData.created_at }
	}
}

/**
 * Generates data for a payment receipt event (kind 17)
 */
export function generatePaymentReceiptData(
	merchantPubkey: string,
	orderId: string,
	amount: string,
	baseTimestamp?: number, // Optional base timestamp
): { kind: typeof PAYMENT_RECEIPT_KIND; created_at: number; content: string; tags: NDKTag[] } {
	let createdAt: number
	if (baseTimestamp) {
		createdAt = Math.min(baseTimestamp + getRandomTimeIncrement(), MAX_SEED_TIMESTAMP)
	} else {
		createdAt = getRandomPastTimestamp()
	}
	createdAt = Math.max(createdAt, MIN_SEED_TIMESTAMP)

	// Payment methods with their reference and proof formats
	const paymentOptions = [
		{
			medium: 'lightning',
			reference: faker.string.alphanumeric(64), // invoice
			proof: faker.string.hexadecimal({ length: 64 }), // preimage
		},
		{
			medium: 'bitcoin',
			reference: faker.string.hexadecimal({ length: 34 }), // address
			proof: faker.string.hexadecimal({ length: 64 }), // txid
		},
		{
			medium: 'ecash',
			reference: `${faker.internet.url()}/mint`, // mint URL
			proof: faker.string.hexadecimal({ length: 64 }), // token proof
		},
		{
			medium: 'fiat',
			reference: faker.string.alphanumeric(16), // payment identifier
			proof: faker.string.hexadecimal({ length: 32 }), // proof reference
		},
		{
			medium: 'other',
			reference: faker.string.alphanumeric(12), // generic reference
			proof: faker.string.hexadecimal({ length: 32 }), // generic proof
		},
	]

	const paymentOption = faker.helpers.arrayElement(paymentOptions)

	const tags: NDKTag[] = [
		// Required tags per Gamma Market Spec
		['p', merchantPubkey], // Merchant's pubkey
		['subject', 'order-receipt'],
		['order', orderId],
		['payment', paymentOption.medium, paymentOption.reference, paymentOption.proof],
		['amount', amount],
	]

	return {
		kind: PAYMENT_RECEIPT_KIND,
		created_at: createdAt,
		content: `Payment confirmation for order ${orderId}`,
		tags,
	}
}

/**
 * Creates and publishes a payment receipt event
 */
export async function createPaymentReceiptEvent(
	signer: NDKPrivateKeySigner,
	ndk: NDK,
	receiptData: ReturnType<typeof generatePaymentReceiptData>,
): Promise<{ eventId: string | null; createdAt: number }> {
	// Return createdAt
	const event = new NDKEvent(ndk)
	event.kind = receiptData.kind
	event.content = receiptData.content
	event.tags = receiptData.tags
	event.created_at = receiptData.created_at

	try {
		await event.sign(signer)
		await event.publish()
		console.log(
			`Published payment receipt for order: ${receiptData.tags.find((tag) => tag[0] === 'order')?.[1]} at ${receiptData.created_at}`,
		)
		return { eventId: event.id, createdAt: receiptData.created_at }
	} catch (error) {
		console.error(`Failed to publish payment receipt`, error)
		return { eventId: null, createdAt: receiptData.created_at }
	}
}

/**
 * Fetches V4V shares for a given seller pubkey
 */
export async function fetchV4VShares(ndk: NDK, sellerPubkey: string): Promise<V4VRecipient[]> {
	try {
		const v4vEvents = await ndk.fetchEvents({
			kinds: [30078],
			authors: [sellerPubkey],
			'#l': ['v4v_share'],
		})

		if (v4vEvents.size === 0) {
			return []
		}

		// Get the most recent V4V event
		const latestEvent = Array.from(v4vEvents).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0]

		if (!latestEvent.content) {
			return []
		}

		// Parse the JSON content to get zap tags
		const zapTags = JSON.parse(latestEvent.content) as string[][]

		return zapTags
			.filter((tag) => tag[0] === 'zap' && tag.length >= 3)
			.map((tag) => ({
				pubkey: tag[1],
				percentage: parseFloat(tag[2]) || 0,
			}))
			.filter((recipient) => recipient.percentage > 0)
	} catch (error) {
		console.error(`Failed to fetch V4V shares for ${sellerPubkey.substring(0, 8)}:`, error)
		return []
	}
}

/**
 * Calculates payment breakdown including V4V shares
 */
export function calculatePaymentBreakdown(
	totalAmountSats: number,
	v4vRecipients: V4VRecipient[],
): { merchantAmount: number; v4vPayments: Array<{ pubkey: string; amount: number; percentage: number }> } {
	if (v4vRecipients.length === 0) {
		return { merchantAmount: totalAmountSats, v4vPayments: [] }
	}

	// Calculate total V4V percentage
	const totalV4VPercentage = v4vRecipients.reduce((total, recipient) => {
		// Handle both decimal (0.05) and percentage (5) formats
		const percentage = recipient.percentage > 1 ? recipient.percentage / 100 : recipient.percentage
		return total + percentage
	}, 0)

	// Ensure total V4V percentage doesn't exceed 100%
	const normalizedV4VPercentage = Math.min(totalV4VPercentage, 1)

	// Calculate V4V amounts
	const v4vPayments = v4vRecipients.map((recipient) => {
		const percentage = recipient.percentage > 1 ? recipient.percentage / 100 : recipient.percentage
		const amount = Math.max(1, Math.floor(totalAmountSats * percentage))
		return {
			pubkey: recipient.pubkey,
			amount,
			percentage: percentage * 100, // Convert back to percentage for display
		}
	})

	// Calculate merchant amount (total - V4V amounts)
	const totalV4VAmount = v4vPayments.reduce((sum, payment) => sum + payment.amount, 0)
	const merchantAmount = Math.max(0, totalAmountSats - totalV4VAmount)

	return { merchantAmount, v4vPayments }
}

/**
 * Generates multiple payment requests for an order (merchant + V4V recipients)
 */
export async function generateMultiplePaymentRequests(
	ndk: NDK,
	buyerPubkey: string,
	sellerPubkey: string,
	orderId: string,
	totalAmount: string,
	baseTimestamp?: number,
): Promise<PaymentRequestWithRecipient[]> {
	const totalAmountSats = parseInt(totalAmount)

	// Fetch V4V shares for the seller
	const v4vRecipients = await fetchV4VShares(ndk, sellerPubkey)

	// Calculate payment breakdown
	const { merchantAmount, v4vPayments } = calculatePaymentBreakdown(totalAmountSats, v4vRecipients)

	const paymentRequests: PaymentRequestWithRecipient[] = []

	// Add merchant payment request
	paymentRequests.push({
		recipientPubkey: sellerPubkey,
		amount: merchantAmount.toString(),
		description: `Merchant payment (${((merchantAmount / totalAmountSats) * 100).toFixed(1)}%)`,
		isV4V: false,
	})

	// Add V4V payment requests
	for (const v4vPayment of v4vPayments) {
		if (v4vPayment.amount > 0) {
			paymentRequests.push({
				recipientPubkey: v4vPayment.pubkey,
				amount: v4vPayment.amount.toString(),
				description: `V4V payment (${v4vPayment.percentage.toFixed(1)}%)`,
				isV4V: true,
			})
		}
	}

	console.log(`💰 Order ${orderId}: Generated ${paymentRequests.length} payment requests (1 merchant + ${v4vPayments.length} V4V)`)
	console.log(`   Total: ${totalAmountSats} sats | Merchant: ${merchantAmount} sats | V4V: ${totalAmountSats - merchantAmount} sats`)

	return paymentRequests
}

/**
 * Creates and publishes multiple payment request events for an order
 */
export async function createMultiplePaymentRequestEvents(
	signer: NDKPrivateKeySigner,
	ndk: NDK,
	buyerPubkey: string,
	sellerPubkey: string,
	orderId: string,
	totalAmount: string,
	baseTimestamp?: number,
): Promise<Array<{ eventId: string | null; createdAt: number; isV4V: boolean; amount: string; recipientPubkey: string }>> {
	const paymentRequests = await generateMultiplePaymentRequests(ndk, buyerPubkey, sellerPubkey, orderId, totalAmount, baseTimestamp)

	const results: Array<{ eventId: string | null; createdAt: number; isV4V: boolean; amount: string; recipientPubkey: string }> = []
	let currentTimestamp = baseTimestamp || getRandomPastTimestamp()

	for (const request of paymentRequests) {
		// Fetch the recipient's profile to get their lightning address (for testing, we use the fixture)
		// In a real scenario, you'd fetch: const profile = await fetchProfileByIdentifier(request.recipientPubkey)
		// const lightningAddress = profile?.lud16 || profile?.lud06 || 'plebeianuser@coinos.io'
		const lightningAddress = 'plebeianuser@coinos.io' // Using fixture for seeding consistency

		// Generate payment request data for this specific recipient
		const paymentData = generatePaymentRequestData(
			buyerPubkey,
			orderId,
			request.amount,
			currentTimestamp,
			true, // manual processing
			lightningAddress,
		)

		// Override the recipient pubkey (p tag) for V4V payments
		const pTagIndex = paymentData.tags.findIndex((tag) => tag[0] === 'p')
		if (pTagIndex !== -1) {
			paymentData.tags[pTagIndex][1] = request.recipientPubkey
		}

		// Add recipient tag for proper matching
		paymentData.tags.push(['recipient', request.recipientPubkey])

		// Update content to reflect the payment type
		paymentData.content = `${request.description}: ${request.amount} sats using Lightning Network. Address: ${lightningAddress}`

		// Create and publish the event
		const { eventId, createdAt } = await createPaymentRequestEvent(signer, ndk, paymentData)

		results.push({
			eventId,
			createdAt,
			isV4V: request.isV4V,
			amount: request.amount,
			recipientPubkey: request.recipientPubkey,
		})

		// Increment timestamp for next payment request
		currentTimestamp = createdAt + getRandomTimeIncrement(1, 10)
	}

	return results
}

/**
 * Creates payment receipts for all payment requests of an order
 */
export async function createPaymentReceiptsForOrder(
	signer: NDKPrivateKeySigner,
	ndk: NDK,
	orderId: string,
	paymentRequestResults: Array<{ eventId: string | null; createdAt: number; isV4V: boolean; amount: string; recipientPubkey?: string }>,
	baseTimestamp?: number,
): Promise<Array<{ eventId: string | null; createdAt: number }>> {
	const results: Array<{ eventId: string | null; createdAt: number }> = []
	let currentTimestamp = baseTimestamp || getRandomPastTimestamp()

	for (const paymentRequest of paymentRequestResults) {
		if (!paymentRequest.eventId) continue

		// Use the recipient pubkey from the payment request, fallback to signer's pubkey
		const recipientPubkey = paymentRequest.recipientPubkey || (await signer.user()).pubkey

		// Generate payment receipt data
		const receiptData = generatePaymentReceiptData(recipientPubkey, orderId, paymentRequest.amount, currentTimestamp)

		// Create and publish the receipt
		const { eventId, createdAt } = await createPaymentReceiptEvent(signer, ndk, receiptData)

		results.push({ eventId, createdAt })

		// Increment timestamp for next receipt
		currentTimestamp = createdAt + getRandomTimeIncrement(1, 5)
	}

	console.log(`📄 Created ${results.length} payment receipts for order ${orderId}`)
	return results
}
