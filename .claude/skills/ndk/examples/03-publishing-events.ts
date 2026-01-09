/**
 * NDK Event Publishing Patterns
 *
 * Examples from: src/publish/orders.tsx, scripts/gen_products.ts
 */

import NDK, { NDKEvent, NDKTag } from '@nostr-dev-kit/ndk'

// ============================================================
// BASIC EVENT PUBLISHING
// ============================================================

const publishBasicNote = async (ndk: NDK, content: string) => {
	// Create event
	const event = new NDKEvent(ndk)
	event.kind = 1 // Text note
	event.content = content
	event.tags = []

	// Sign and publish
	await event.sign()
	await event.publish()

	console.log('✅ Published note:', event.id)
	return event.id
}

// ============================================================
// EVENT WITH TAGS
// ============================================================

const publishNoteWithTags = async (
	ndk: NDK,
	content: string,
	options: {
		mentions?: string[] // pubkeys to mention
		hashtags?: string[]
		replyTo?: string // event ID
	},
) => {
	const event = new NDKEvent(ndk)
	event.kind = 1
	event.content = content
	event.tags = []

	// Add mentions
	if (options.mentions) {
		options.mentions.forEach((pubkey) => {
			event.tags.push(['p', pubkey])
		})
	}

	// Add hashtags
	if (options.hashtags) {
		options.hashtags.forEach((tag) => {
			event.tags.push(['t', tag])
		})
	}

	// Add reply
	if (options.replyTo) {
		event.tags.push(['e', options.replyTo, '', 'reply'])
	}

	await event.sign()
	await event.publish()

	return event.id
}

// ============================================================
// PRODUCT LISTING (PARAMETERIZED REPLACEABLE EVENT)
// ============================================================

interface ProductData {
	slug: string // Unique identifier
	title: string
	description: string
	price: number
	currency: string
	images: string[]
	shippingRefs?: string[]
	category?: string
}

const publishProduct = async (ndk: NDK, product: ProductData) => {
	const event = new NDKEvent(ndk)
	event.kind = 30402 // Product listing kind
	event.content = product.description

	// Build tags
	event.tags = [
		['d', product.slug], // Unique identifier (required for replaceable)
		['title', product.title],
		['price', product.price.toString(), product.currency],
	]

	// Add images
	product.images.forEach((image) => {
		event.tags.push(['image', image])
	})

	// Add shipping options
	if (product.shippingRefs) {
		product.shippingRefs.forEach((ref) => {
			event.tags.push(['shipping', ref])
		})
	}

	// Add category
	if (product.category) {
		event.tags.push(['t', product.category])
	}

	// Optional: set custom timestamp
	event.created_at = Math.floor(Date.now() / 1000)

	await event.sign()
	await event.publish()

	console.log('✅ Published product:', product.title)
	return event.id
}

// ============================================================
// ORDER CREATION EVENT
// ============================================================

interface OrderData {
	orderId: string
	sellerPubkey: string
	productRef: string
	quantity: number
	totalAmount: string
	currency: string
	shippingRef?: string
	shippingAddress?: string
	email?: string
	phone?: string
	notes?: string
}

const createOrder = async (ndk: NDK, order: OrderData) => {
	const event = new NDKEvent(ndk)
	event.kind = 16 // Order processing kind
	event.content = order.notes || ''

	// Required tags per spec
	event.tags = [
		['p', order.sellerPubkey],
		['subject', `Order ${order.orderId.substring(0, 8)}`],
		['type', 'order-creation'],
		['order', order.orderId],
		['amount', order.totalAmount],
		['item', order.productRef, order.quantity.toString()],
	]

	// Optional tags
	if (order.shippingRef) {
		event.tags.push(['shipping', order.shippingRef])
	}

	if (order.shippingAddress) {
		event.tags.push(['address', order.shippingAddress])
	}

	if (order.email) {
		event.tags.push(['email', order.email])
	}

	if (order.phone) {
		event.tags.push(['phone', order.phone])
	}

	try {
		await event.sign()
		await event.publish()

		console.log('✅ Order created:', order.orderId)
		return { success: true, eventId: event.id }
	} catch (error) {
		console.error('❌ Failed to create order:', error)
		return { success: false, error }
	}
}

// ============================================================
// STATUS UPDATE EVENT
// ============================================================

const publishStatusUpdate = async (
	ndk: NDK,
	orderId: string,
	recipientPubkey: string,
	status: 'pending' | 'paid' | 'shipped' | 'delivered' | 'cancelled',
	notes?: string,
) => {
	const event = new NDKEvent(ndk)
	event.kind = 16
	event.content = notes || `Order status updated to ${status}`
	event.tags = [
		['p', recipientPubkey],
		['subject', 'order-info'],
		['type', 'status-update'],
		['order', orderId],
		['status', status],
	]

	await event.sign()
	await event.publish()

	return event.id
}

// ============================================================
// BATCH PUBLISHING
// ============================================================

const publishMultipleEvents = async (ndk: NDK, events: Array<{ kind: number; content: string; tags: NDKTag[] }>) => {
	const results = []

	for (const eventData of events) {
		try {
			const event = new NDKEvent(ndk)
			event.kind = eventData.kind
			event.content = eventData.content
			event.tags = eventData.tags

			await event.sign()
			await event.publish()

			results.push({ success: true, eventId: event.id })
		} catch (error) {
			results.push({ success: false, error })
		}
	}

	return results
}

// ============================================================
// PUBLISH WITH CUSTOM SIGNER
// ============================================================

import { NDKSigner } from '@nostr-dev-kit/ndk'

const publishWithCustomSigner = async (ndk: NDK, signer: NDKSigner, eventData: { kind: number; content: string; tags: NDKTag[] }) => {
	const event = new NDKEvent(ndk)
	event.kind = eventData.kind
	event.content = eventData.content
	event.tags = eventData.tags

	// Sign with specific signer (not ndk.signer)
	await event.sign(signer)
	await event.publish()

	return event.id
}

// ============================================================
// ERROR HANDLING PATTERN
// ============================================================

const publishWithErrorHandling = async (ndk: NDK, eventData: { kind: number; content: string; tags: NDKTag[] }) => {
	// Validate NDK
	if (!ndk) {
		throw new Error('NDK not initialized')
	}

	// Validate signer
	if (!ndk.signer) {
		throw new Error('No active signer. Please login first.')
	}

	try {
		const event = new NDKEvent(ndk)
		event.kind = eventData.kind
		event.content = eventData.content
		event.tags = eventData.tags

		// Sign
		await event.sign()

		// Verify signature
		if (!event.sig) {
			throw new Error('Event signing failed')
		}

		// Publish
		await event.publish()

		// Verify event ID
		if (!event.id) {
			throw new Error('Event ID not generated')
		}

		return {
			success: true,
			eventId: event.id,
			pubkey: event.pubkey,
		}
	} catch (error) {
		console.error('Publishing failed:', error)

		if (error instanceof Error) {
			// Handle specific error types
			if (error.message.includes('relay')) {
				throw new Error('Failed to publish to relays. Check connection.')
			}
			if (error.message.includes('sign')) {
				throw new Error('Failed to sign event. Check signer.')
			}
		}

		throw error
	}
}

// ============================================================
// USAGE EXAMPLE
// ============================================================

async function publishingExample(ndk: NDK) {
	// Simple note
	await publishBasicNote(ndk, 'Hello Nostr!')

	// Note with tags
	await publishNoteWithTags(ndk, 'Check out this product!', {
		hashtags: ['marketplace', 'nostr'],
		mentions: ['pubkey123...'],
	})

	// Product listing
	await publishProduct(ndk, {
		slug: 'bitcoin-tshirt',
		title: 'Bitcoin T-Shirt',
		description: 'High quality Bitcoin t-shirt',
		price: 25,
		currency: 'USD',
		images: ['https://example.com/image.jpg'],
		category: 'clothing',
	})

	// Order
	await createOrder(ndk, {
		orderId: 'order-123',
		sellerPubkey: 'seller-pubkey',
		productRef: '30402:pubkey:bitcoin-tshirt',
		quantity: 1,
		totalAmount: '25.00',
		currency: 'USD',
		email: 'customer@example.com',
	})
}

export {
	publishBasicNote,
	publishNoteWithTags,
	publishProduct,
	createOrder,
	publishStatusUpdate,
	publishMultipleEvents,
	publishWithCustomSigner,
	publishWithErrorHandling,
}
