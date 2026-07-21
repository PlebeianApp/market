import { finalizeEvent, type EventTemplate, type VerifiedEvent } from 'nostr-tools/pure'
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay'
import { hexToBytes } from '@noble/hashes/utils.js'
import WebSocket from 'ws'
import { devUser1, devUser2, WALLETED_USER_LUD16 } from '../../src/lib/fixtures'
import { RELAY_URL, TEST_APP_PRIVATE_KEY, TEST_APP_PUBLIC_KEY } from '../test-config'
import { isAddressableKind } from 'nostr-tools/kinds'
import { v4 as uuidv4 } from 'uuid'

useWebSocketImplementation(WebSocket)

export type ScenarioName = 'none' | 'base' | 'merchant' | 'marketplace'

// Track which scenarios have been seeded in this worker
const seededScenarios = new Set<ScenarioName>()

/**
 * Ensures a scenario has been seeded. Scenarios are cumulative and idempotent
 * within a worker process.
 */
export async function ensureScenario(scenario: ScenarioName): Promise<void> {
	if (scenario === 'none' || seededScenarios.has(scenario)) return

	const relay = await Relay.connect(RELAY_URL)

	try {
		switch (scenario) {
			case 'base':
				await seedBase(relay)
				break
			case 'merchant':
				await ensureScenario('base')
				await seedMerchant(relay)
				break
			case 'marketplace':
				await ensureScenario('merchant')
				await seedMarketplace(relay)
				break
		}

		seededScenarios.add(scenario)
	} finally {
		relay.close()
	}
}

// --- Helper to sign and publish ---

async function publish(relay: Relay, skHex: string, template: EventTemplate) {
	const skBytes = hexToBytes(skHex)
	const event = finalizeEvent(template, skBytes)
	await relay.publish(event)
	return event
}

export async function resetRemoteCartForUser(skHex: string): Promise<void> {
	const relay = await Relay.connect(RELAY_URL)

	try {
		await publish(relay, skHex, {
			kind: 30078,
			created_at: Math.floor(Date.now() / 1000),
			content: JSON.stringify({
				version: 1,
				updatedAt: Math.floor(Date.now() / 1000),
				items: [],
			}),
			tags: [['d', 'plebeian-market-cart']],
		})
	} finally {
		relay.close()
	}
}

// --- Seeding functions ---

async function seedBase(relay: Relay) {
	console.log('  Seeding: base (user profiles)')
	await seedUserProfile(relay, devUser1, 'TestMerchant', 'Test Merchant')
	await seedUserProfile(relay, devUser2, 'TestBuyer', 'Test Buyer')
	await seedUserProfile(relay, { sk: TEST_APP_PRIVATE_KEY, pk: TEST_APP_PUBLIC_KEY }, 'TestApp', 'Test App')

	// Add devUser1 to admin list so they can access app-settings routes
	await publish(relay, TEST_APP_PRIVATE_KEY, {
		kind: 30000,
		created_at: Math.floor(Date.now() / 1000),
		content: '',
		tags: [
			['d', 'admins'],
			['p', TEST_APP_PUBLIC_KEY],
			['p', devUser1.pk],
		],
	})
	console.log('    Published admin list with devUser1')
}

async function seedMerchant(relay: Relay) {
	console.log('  Seeding: merchant (shipping, payments, products)')

	await seedShippingOption(relay, devUser1.sk, {
		title: 'Worldwide Standard',
		price: '5000',
		currency: 'sats',
		service: 'standard',
		countries: ['US', 'CA', 'GB', 'DE'],
	})

	await seedShippingOption(relay, devUser1.sk, {
		title: 'Digital Delivery',
		price: '0',
		currency: 'sats',
		service: 'digital',
		countries: [],
	})

	await seedShippingOption(relay, devUser1.sk, {
		title: 'Local Pickup - Bitcoin Store',
		price: '0',
		currency: 'sats',
		service: 'pickup',
		countries: [],
		pickupAddress: {
			street: '456 Satoshi Lane',
			city: 'Austin',
			state: 'TX',
			postalCode: '78701',
			country: 'US',
		},
	})

	await seedPaymentDetail(relay, devUser1.sk, TEST_APP_PUBLIC_KEY, {
		method: 'LIGHTNING_NETWORK',
		detail: WALLETED_USER_LUD16,
	})

	// Seed V4V shares with 10% going to the app (community share)
	await seedV4VShares(relay, devUser1.sk, [['zap', TEST_APP_PUBLIC_KEY, '0.1']])

	const user1ShippingRefs = [`30406:${devUser1.pk}:worldwide-standard`, `30406:${devUser1.pk}:digital-delivery`]

	await seedProduct(relay, devUser1.sk, {
		title: 'Bitcoin Hardware Wallet',
		description: 'Secure cold storage for your sats. Keep your bitcoin safe with this hardware wallet.',
		price: '50000',
		currency: 'SATS',
		status: 'on-sale',
		category: 'Bitcoin',
		stock: '10',
		shippingOptions: user1ShippingRefs,
	})

	await seedProduct(relay, devUser1.sk, {
		title: 'Nostr T-Shirt',
		description: 'Show your love for the Nostr protocol with this comfortable cotton t-shirt.',
		price: '15000',
		currency: 'SATS',
		status: 'on-sale',
		category: 'Clothing',
		stock: '10',
		shippingOptions: user1ShippingRefs,
	})

	// Digital-only product
	await seedProduct(relay, devUser1.sk, {
		title: 'Bitcoin E-Book',
		description: 'A comprehensive guide to Bitcoin. Digital delivery - no shipping required.',
		price: '5000',
		currency: 'SATS',
		status: 'on-sale',
		category: 'Bitcoin',
		stock: '100',
		shippingOptions: [`30406:${devUser1.pk}:digital-delivery`],
	})

	// Pickup-only product
	await seedProduct(relay, devUser1.sk, {
		title: 'Bitcoin Conference Ticket',
		description: 'Attend the local Bitcoin meetup. Pick up your ticket at the Bitcoin Store.',
		price: '10000',
		currency: 'SATS',
		status: 'on-sale',
		category: 'Bitcoin',
		stock: '50',
		shippingOptions: [`30406:${devUser1.pk}:local-pickup---bitcoin-store`],
	})
}

async function seedMarketplace(relay: Relay) {
	console.log('  Seeding: marketplace (second merchant)')

	await seedShippingOption(relay, devUser2.sk, {
		title: 'Express Shipping',
		price: '10000',
		currency: 'sats',
		service: 'express',
		countries: ['US'],
	})

	await seedShippingOption(relay, devUser2.sk, {
		title: 'Digital Delivery',
		price: '0',
		currency: 'sats',
		service: 'digital',
		countries: [],
	})

	await seedPaymentDetail(relay, devUser2.sk, TEST_APP_PUBLIC_KEY, {
		method: 'LIGHTNING_NETWORK',
		detail: WALLETED_USER_LUD16,
	})

	// Seed V4V shares for second merchant (10% to app, matching devUser1)
	await seedV4VShares(relay, devUser2.sk, [['zap', TEST_APP_PUBLIC_KEY, '0.1']])

	await seedProduct(relay, devUser2.sk, {
		title: 'Lightning Node Setup Guide',
		description: 'Comprehensive guide to setting up your own Lightning Network node.',
		price: '25000',
		currency: 'SATS',
		status: 'on-sale',
		category: 'Bitcoin',
		stock: '10',
		shippingOptions: [`30406:${devUser2.pk}:express-shipping`, `30406:${devUser2.pk}:digital-delivery`],
	})
}

// --- Low-level seed helpers ---

async function seedUserProfile(relay: Relay, user: { sk: string; pk: string }, name: string, displayName: string) {
	await publish(relay, user.sk, {
		kind: 0,
		created_at: Math.floor(Date.now() / 1000),
		content: JSON.stringify({
			name,
			display_name: displayName,
			about: `Test user ${name}`,
			lud16: WALLETED_USER_LUD16,
		}),
		tags: [],
	})
	console.log(`    Published profile: ${name}`)
}

async function seedShippingOption(
	relay: Relay,
	skHex: string,
	opts: {
		title: string
		price: string
		currency: string
		service: string
		countries: string[]
		pickupAddress?: { street: string; city: string; state?: string; postalCode?: string; country?: string }
	},
) {
	const pickupTags: string[][] = []
	if (opts.pickupAddress) {
		if (opts.pickupAddress.street) pickupTags.push(['pickup-street', opts.pickupAddress.street])
		if (opts.pickupAddress.city) pickupTags.push(['pickup-city', opts.pickupAddress.city])
		if (opts.pickupAddress.state) pickupTags.push(['pickup-state', opts.pickupAddress.state])
		if (opts.pickupAddress.postalCode) pickupTags.push(['pickup-postal-code', opts.pickupAddress.postalCode])
		if (opts.pickupAddress.country) pickupTags.push(['pickup-country', opts.pickupAddress.country])
		// Legacy combined address
		const combined = [
			opts.pickupAddress.street,
			opts.pickupAddress.city,
			opts.pickupAddress.state,
			opts.pickupAddress.postalCode,
			opts.pickupAddress.country,
		]
			.filter(Boolean)
			.join(', ')
		if (combined) pickupTags.push(['pickup-address', combined])
	}

	await publish(relay, skHex, {
		kind: 30406,
		created_at: Math.floor(Date.now() / 1000),
		content: `Shipping: ${opts.title}`,
		tags: [
			['d', opts.title.toLowerCase().replace(/\s+/g, '-')],
			['title', opts.title],
			['price', opts.price, opts.currency],
			['service', opts.service],
			...opts.countries.map((c) => ['country', c]),
			...pickupTags,
		],
	})
	console.log(`    Published shipping: ${opts.title}`)
}

async function seedPaymentDetail(relay: Relay, skHex: string, appPubkey: string, opts: { method: string; detail: string }) {
	await publish(relay, skHex, {
		kind: 30078,
		created_at: Math.floor(Date.now() / 1000),
		content: JSON.stringify({
			payment_method: opts.method,
			payment_detail: opts.detail,
			stall_id: null,
			stall_name: 'General',
			is_default: true,
		}),
		tags: [
			['d', `payment-${Date.now()}`],
			['l', 'payment_detail'],
			['p', appPubkey],
		],
	})
	console.log(`    Published payment: ${opts.method}`)
}

export async function seedShippingOptionForUser(skUser: string) {
	const relay = await Relay.connect(RELAY_URL)

	const id = `shipping_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`

	await publish(relay, skUser, {
		kind: 30402,
		created_at: Math.floor(Date.now() / 1000),
		content: '',
		tags: [
			['d', id],
			['title', 'seeded shipping option - digital'],
			['price', '0', 'USD'],
			['service', 'digital'],
		],
	})

	console.log(`    Published shipping option with ID: ${id}`)
}

export async function seedProduct(
	relay: Relay,
	skHex: string,
	opts: {
		title: string
		description: string
		price: string
		currency: string
		status: string
		category: string
		stock?: string
		shippingOptions?: string[]
		dTag?: string
	},
): Promise<VerifiedEvent> {
	const dTag = opts.dTag ?? opts.title.toLowerCase().replace(/\s+/g, '-')
	const event = await publish(relay, skHex, {
		kind: 30402,
		created_at: Math.floor(Date.now() / 1000),
		content: opts.description,
		tags: [
			['d', dTag],
			['title', opts.title],
			['price', opts.price, opts.currency],
			['status', opts.status],
			['t', opts.category],
			['image', 'https://cdn.satellite.earth/f8f1513ec22f966626dc05342a3bb1f36096d28dd0e6eeae640b5df44f2c7c84.png'],
			...(opts.stock ? [['stock', opts.stock]] : []),
			...(opts.shippingOptions ? opts.shippingOptions.map((ref) => ['shipping_option', ref]) : []),
		],
	})

	console.log(`    Published product: ${opts.title}`)
	return event
}

export async function seedComment(
	relay: Relay,
	skHex: string,
	opts: {
		content: string
		// Root scope (what we're commenting on)
		rootEventId: string
		rootEventPubkey: string
		rootEventDTag?: string
		rootKind: number // e.g., 30402 for products
		// Parent scope (for replies - optional for top-level comments)
		parentEventId?: string
		parentEventPubkey?: string
		parentEventDTag?: string
		parentKind?: number
		// Relay hints
		relayUrl?: string
	},
): Promise<VerifiedEvent> {
	const tags: string[][] = []

	// === ROOT SCOPE TAGS (uppercase) ===

	// Root event reference

	// Addressable events - use A tag
	if (opts.rootKind === 30402 || opts.rootKind === 1111) {
		const dTag = opts.rootEventDTag ?? opts.rootEventId
		tags.push(['A', `${opts.rootKind}:${opts.rootEventPubkey}:${dTag}`, opts.relayUrl || '', opts.rootEventPubkey])
	}

	// Root ID
	tags.push(['E', opts.rootEventId, opts.relayUrl || '', opts.rootEventPubkey])

	// Root kind
	tags.push(['K', opts.rootKind.toString()])

	// Root author pubkey
	tags.push(['P', opts.rootEventPubkey, opts.relayUrl || ''])

	// === PARENT SCOPE TAGS (lowercase) ===

	// For top-level comments, parent = root
	// For replies, parent = the comment we're replying to

	if (opts.parentEventId && opts.parentEventPubkey && opts.parentKind) {
		// Parent A tag (For addressable events)
		if (opts.parentKind === 1111 || opts.parentKind == 30402) {
			const dTag = opts.parentEventDTag ?? opts.parentEventId
			tags.push(['a', `${opts.parentKind}:${opts.parentEventPubkey}:${dTag}`, opts.relayUrl || '', opts.parentEventPubkey])
			// Replying to a comment - use E tag for the comment event
			tags.push(['e', opts.parentEventId, opts.relayUrl || '', opts.parentEventPubkey])
		}

		// Parent ID
		tags.push(['e', opts.parentEventId, opts.relayUrl || '', opts.parentEventPubkey])

		// Parent kind
		tags.push(['k', opts.parentKind.toString()])

		// Parent author pubkey
		tags.push(['p', opts.parentEventPubkey, opts.relayUrl || ''])
	} else {
		// Top-level comment - parent = root
		if (opts.rootKind === 30402) {
			const dTag = opts.rootEventId.split(':')[2] || opts.rootEventId
			tags.push(['a', `${opts.rootKind}:${opts.rootEventPubkey}:${dTag}`, opts.relayUrl || '', opts.rootEventPubkey])
		} else {
			tags.push(['e', opts.rootEventId, opts.relayUrl || '', opts.rootEventPubkey])
		}

		// Parent kind (same as root for top-level)
		tags.push(['k', opts.rootKind.toString()])

		// Parent author pubkey (same as root for top-level)
		tags.push(['p', opts.rootEventPubkey, opts.relayUrl || ''])
	}

	const event = await publish(relay, skHex, {
		kind: 1111,
		created_at: Math.floor(Date.now() / 1000),
		content: opts.content,
		tags,
	})

	console.log(`    Published comment: "$${opts.content.substring(0, 30)}$${opts.content.length > 30 ? '...' : ''}"`)
	return event
}

export async function seedReaction(
	relay: Relay,
	skHex: string,
	opts: {
		emoji: string
		targetEventId: string
		targetEventPubkey: string
		targetKind: number
		targetDTag?: string // Optional: Provide if known (critical for addressable events like products)
		relayUrl?: string
	},
): Promise<VerifiedEvent> {
	const tags: string[][] = []

	// 1. 'e' tag
	tags.push(['e', opts.targetEventId, opts.relayUrl || '', opts.targetEventPubkey])

	// 2. 'a' tag (for addressable events: 30402, 1111, etc.)
	if (isAddressableKind(opts.targetKind)) {
		if (!opts.targetDTag) {
			// We will throw an error if 'd' tag is missing for addressable events.
			throw new Error(`targetDTag is required for addressable event kind ${opts.targetKind}. Please provide it or fetch the event first.`)
		}
		const aTagValue = `${opts.targetKind}:${opts.targetEventPubkey}:${opts.targetDTag}`
		tags.push(['a', aTagValue, opts.relayUrl || '', opts.targetEventPubkey])
	}

	// 3. 'p' tag
	tags.push(['p', opts.targetEventPubkey, opts.relayUrl || ''])

	// 4. 'k' tag
	tags.push(['k', opts.targetKind.toString()])

	const unsignedEvent = {
		kind: 7, // NIP-25 Reaction
		content: opts.emoji,
		created_at: Math.floor(Date.now() / 1000),
		pubkey: skHex, // Note: In seed functions, we usually sign with the secret key directly
		tags,
	}

	// Sign and publish
	const event = await publish(relay, skHex, unsignedEvent)

	console.log(`    Published reaction: "${opts.emoji}" on event ${opts.targetEventId}`)
	return event
}

/**
 * Resets entire blacklist (Users, Products, Collections) using admin secret key
 */
export async function resetAppBlacklist() {
	const relay = await Relay.connect(RELAY_URL)
	const skAdmin = devUser1.sk

	await publish(relay, skAdmin, {
		kind: 10000, // NIP-51 mute list
		created_at: Math.floor(Date.now() / 1000),
		content: '',
		tags: [],
	})

	console.log(`    Reset app Blacklist.`)
}

export async function resetAppFeaturedList() {
	const relay = await Relay.connect(RELAY_URL)
	const skAdmin = devUser1.sk

	await Promise.all([
		// Products
		publish(relay, skAdmin, {
			kind: 30405,
			created_at: Math.floor(Date.now() / 1000),
			content: '',
			tags: [['d', 'featured_products']],
		}),
		// Collections
		publish(relay, skAdmin, {
			kind: 30003,
			created_at: Math.floor(Date.now() / 1000),
			content: '',
			tags: [['d', 'featured_collections']],
		}),
		// Users
		publish(relay, skAdmin, {
			kind: 30000,
			created_at: Math.floor(Date.now() / 1000),
			content: '',
			tags: [['d', 'featured_users']],
		}),
	])

	console.log(`    Reset app Featured list.`)
}

async function seedV4VShares(relay: Relay, skHex: string, shares: string[][] = []) {
	await publish(relay, skHex, {
		kind: 30078,
		created_at: Math.floor(Date.now() / 1000),
		content: JSON.stringify(shares),
		tags: [
			['d', 'v4v-default'],
			['l', 'v4v_share'],
		],
	})
	const pct = shares.length > 0 ? shares.reduce((sum, s) => sum + parseFloat(s[2] || '0') * 100, 0) : 0
	console.log(`    Published V4V shares (${pct}% to community)`)
}

/**
 * Reset V4V shares for a user by publishing an empty Kind 30078 event.
 * This replaces any existing V4V shares so the V4V setup dialog will appear
 * during product creation.
 */
export async function resetV4VForUser(skHex: string): Promise<void> {
	const relay = await Relay.connect(RELAY_URL)
	try {
		await seedV4VShares(relay, skHex)
	} finally {
		relay.close()
	}
}

/**
 * Seed V4V shares with specific recipients for a user.
 * Each recipient is a tuple of [pubkey, percentage] where percentage is a
 * decimal fraction (e.g. 0.1 for 10%).
 */
export async function seedV4VWithRecipients(skHex: string, recipients: Array<{ pubkey: string; percentage: number }>): Promise<void> {
	const relay = await Relay.connect(RELAY_URL)
	try {
		const shares = recipients.map((r) => ['zap', r.pubkey, String(r.percentage)])
		await seedV4VShares(relay, skHex, shares)
	} finally {
		relay.close()
	}
}

export async function seedAuction(
	relay: Relay,
	skHex: string,
	opts: {
		title?: string
		description?: string
		startingBid?: number
		bidIncrement?: number
		reserve?: number
		shippingOptions?: Array<{ shippingRef: string; extraCost?: string }>
	},
): Promise<VerifiedEvent> {
	const now = Math.floor(Date.now() / 1000)
	const auctionId = `e2e-auction-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
	const startingBid = opts.startingBid ?? 1000
	const bidIncrement = opts.bidIncrement ?? 100
	const reserve = opts.reserve ?? 0

	const shippingTags: string[][] = []
	for (const so of opts.shippingOptions ?? []) {
		if (so.extraCost) {
			shippingTags.push(['shipping_option', so.shippingRef, so.extraCost])
		} else {
			shippingTags.push(['shipping_option', so.shippingRef])
		}
	}

	const event = await publish(relay, skHex, {
		kind: 30408,
		created_at: now,
		content: opts.description ?? 'E2E test auction description.',
		tags: [
			['d', auctionId],
			['title', opts.title ?? `Test Auction ${auctionId}`],
			['summary', 'E2E test auction'],
			['auction_type', 'english'],
			['start_at', String(now)],
			['end_at', String(now + 86400)],
			['currency', 'SAT'],
			['price', String(startingBid), 'SAT'],
			['starting_bid', String(startingBid), 'SAT'],
			['bid_increment', String(bidIncrement)],
			['reserve', String(reserve)],
			['mint', 'https://nofees.testnut.cashu.space'],
			['escrow_pubkey', '02' + '00'.repeat(32)],
			['key_scheme', 'hd_p2pk'],
			['p2pk_xpub', 'xpub' + '0'.repeat(100)],
			['settlement_policy', 'cashu_p2pk_v1'],
			['schema', 'auction_v1'],
			['image', 'https://cdn.satellite.earth/f8f1513ec22f966626dc05342a3bb1f36096d28dd0e6eeae640b5df44f2c7c84.png'],
			['t', 'Bitcoin'],
			...shippingTags,
		],
	})

	console.log(`    Published auction: ${opts.title ?? auctionId}`)
	return event
}

import { ORDER_MESSAGE_TYPE, ORDER_PROCESS_KIND, ORDER_STATUS, PAYMENT_RECEIPT_KIND, SHIPPING_STATUS } from '@/lib/schemas/order'
import { AUCTION_PATH_RELEASE_KIND, AUCTION_SETTLEMENT_KIND } from '@/lib/auction/constants'

export type OrderStage = 'pending-payment' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'completed'
export type OrderType = 'product' | 'auction'

export interface SeededOrderResult {
	orderEvent: VerifiedEvent
	orderId: string
	productEvent?: VerifiedEvent
	auctionEvent?: VerifiedEvent
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
