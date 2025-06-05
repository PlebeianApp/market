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
): { kind: typeof ORDER_PROCESS_KIND; created_at: number; content: string; tags: NDKTag[] } {
	let createdAt: number
	if (baseTimestamp) {
		createdAt = Math.min(baseTimestamp + getRandomTimeIncrement(), MAX_SEED_TIMESTAMP)
	} else {
		// This case should ideally not happen if seed.ts provides a baseTimestamp from the order creation
		createdAt = getRandomPastTimestamp()
	}
	createdAt = Math.max(createdAt, MIN_SEED_TIMESTAMP)

	// Payment methods
	const paymentMethods: ['lightning' | 'bitcoin' | 'ecash' | 'fiat' | 'other', string][] = [
		['lightning', faker.string.alphanumeric(64)], // Simulating a lightning invoice
		['bitcoin', faker.string.hexadecimal({ length: 34 })], // Simulating a BTC address
		['ecash', faker.string.alphanumeric(32)], // Simulating a cashu token
		['fiat', faker.finance.accountNumber()], // Simulating a fiat payment reference
		['other', faker.string.alphanumeric(16)], // Generic payment option
	]

	// Select a random payment method
	const [paymentMethod, paymentInfo] = faker.helpers.arrayElement(paymentMethods)

	const tags: NDKTag[] = [
		// Required tags
		['p', buyerPubkey], // Buyer's pubkey for manual processing
		['subject', 'order-payment'],
		['type', ORDER_MESSAGE_TYPE.PAYMENT_REQUEST],
		['order', orderId],
		['amount', amount],
		['payment', paymentMethod, paymentInfo],
	]

	// Add expiration if it's a lightning payment
	if (paymentMethod === 'lightning') {
		const expirationTime = createdAt + 3600 // 1 hour from now
		tags.push(['expiration', expirationTime.toString()])
	}

	return {
		kind: ORDER_PROCESS_KIND,
		created_at: createdAt,
		content: `Please pay ${amount} sats using the provided ${paymentMethod} details.`,
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
