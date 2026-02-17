import { finalizeEvent, type EventTemplate } from 'nostr-tools/pure'
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay'
import { hexToBytes } from '@noble/hashes/utils'
import WebSocket from 'ws'
import { devUser1, devUser2, WALLETED_USER_LUD16 } from '../../src/lib/fixtures'
import { RELAY_URL, TEST_APP_PRIVATE_KEY, TEST_APP_PUBLIC_KEY } from '../test-config'

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

// --- Seeding functions ---

async function seedBase(relay: Relay) {
	console.log('  Seeding: base (user profiles)')
	await seedUserProfile(relay, devUser1, 'TestMerchant', 'Test Merchant')
	await seedUserProfile(relay, devUser2, 'TestBuyer', 'Test Buyer')
	await seedUserProfile(relay, { sk: TEST_APP_PRIVATE_KEY, pk: TEST_APP_PUBLIC_KEY }, 'TestApp', 'Test App')
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

	await seedPaymentDetail(relay, devUser2.sk, TEST_APP_PUBLIC_KEY, {
		method: 'LIGHTNING_NETWORK',
		detail: WALLETED_USER_LUD16,
	})

	await seedProduct(relay, devUser2.sk, {
		title: 'Lightning Node Setup Guide',
		description: 'Comprehensive guide to setting up your own Lightning Network node.',
		price: '25000',
		currency: 'SATS',
		status: 'on-sale',
		category: 'Bitcoin',
		stock: '10',
		shippingOptions: [`30406:${devUser2.pk}:express-shipping`],
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

async function seedProduct(
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
	},
) {
	const dTag = opts.title.toLowerCase().replace(/\s+/g, '-')
	await publish(relay, skHex, {
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
