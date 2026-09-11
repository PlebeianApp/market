import { finalizeEvent, getPublicKey, type EventTemplate, type VerifiedEvent } from 'nostr-tools/pure'
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { getEncodedToken } from '@cashu/cashu-ts'
import WebSocket from 'ws'
import { devUser1, devUser2, devUser3, WALLETED_USER_LUD16, XPUB } from '../../src/lib/fixtures'
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
			['mint', 'http://localhost:3338'],
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
import {
	AUCTION_BID_KIND,
	AUCTION_KIND,
	AUCTION_PATH_RELEASE_KIND,
	AUCTION_SETTLEMENT_KIND,
	VALIDATOR_VERDICT_KIND,
} from '@/lib/auction/constants'
import {
	buildAuctionEventTags,
	buildBidEventTags,
	buildPathReleaseTags,
	buildSettlementTags,
	buildValidatorVerdictTags,
} from '@/lib/auction/tagBuilders'
import { deriveAuctionChildP2pkPubkeyFromXpub } from '@/lib/auctionP2pk'
import { hashToCurveHexFromString } from '@/lib/cashu/hashToCurve'
import { computeValidatedBids } from '@/lib/auction/bidValidation'
import { validatePathRelease, validateSettlementCompleteness } from '@/lib/auction/validation'
import { parseAuctionEvent } from '@/lib/schemas/auction/auctionEvent'
import { parseBidEvent } from '@/lib/schemas/auction/bidEvent'
import { parsePathReleaseEvent, parseSettlementEvent } from '@/lib/schemas/auction/settlementEvents'
import { parseValidatorVerdictEvent } from '@/lib/schemas/auction/validatorEvents'

// ============================================================================
// Auction order fixture (kind 30408 → 1023 → 30440 → 1025 → 1024 → claim order)
// ============================================================================

/**
 * The mint the seeded auction lists and the winning bid locks against. This is
 * the local nutshell mint the e2e harness starts (`e2e/start-local-mint.sh`,
 * `APP_DEV_TEST_MINT_URL`), so the seeded events reference a mint the app is
 * actually configured with — no external network egress.
 */
const E2E_AUCTION_MINT_URL = 'http://localhost:3338'

/** FakeWallet keyset id of the local mint; only used to shape a decodable token. */
const E2E_AUCTION_KEYSET_ID = '009a1f293253e41e'

/**
 * 5 non-hardened BIP-32 levels, matching AUCTION_PATH_HD_DEPTH (the path
 * entropy the protocol requires of a bidder-generated release path).
 */
const E2E_AUCTION_DERIVATION_PATH = 'm/0/1/2/3/4'

const E2E_AUCTION_SETTLEMENT_GRACE_SECONDS = 3600
/** The seeded auction closed half an hour before the fixture is built. */
const E2E_AUCTION_CLOSED_SECONDS_AGO = 1800
const E2E_AUCTION_OPENED_SECONDS_AGO = 7200
const E2E_AUCTION_RESERVE_SATS = 1000
const E2E_AUCTION_STARTING_BID_SATS = 1000
const E2E_AUCTION_WINNING_BID_SATS = 1500

export interface AuctionOrderFixture {
	/** kind-30408 auction listing, seller-signed, canonical (first) publish. */
	auctionEvent: VerifiedEvent
	/** kind-1023 winning bid, bidder-signed, real lock over a derived P2PK child key. */
	bidEvent: VerifiedEvent
	/** kind-30440 auditor verdict confirming the winning bid (`auditor_quorum` = 1). */
	verdictEvent: VerifiedEvent
	/** kind-1025 path release for the winning bid, carrying the locked proofs as a cashu token. */
	pathReleaseEvent: VerifiedEvent
	/** kind-1024 settled settlement, seller-signed. */
	settlementEvent: VerifiedEvent
	/** Addressable coordinate `30408:<seller>:<d>` used as the order's `item`/`a` value. */
	itemTagValue: string
	/** Settlement amount in sats — the buyer's claim order must declare the same amount. */
	amount: number
	/** The unix-second `now` the chain was built against (validation clock). */
	now: number
}

const compressedPubkeyFromSecretKey = (secretKeyHex: string): string => bytesToHex(secp256k1.getPublicKey(hexToBytes(secretKeyHex), true))

/**
 * Build the NUT-10/NUT-11 P2PK well-known secret a bidder locks a bid's proofs
 * with under `cashu_p2pk_bidder_path_v1` (§5.3): single child pubkey, single
 * refund key, `n_sigs = n_sigs_refund = 1`, `SIG_INPUTS`, mandatory locktime.
 */
const buildAuctionLockSecret = (input: { childPubkey: string; refundPubkey: string; locktime: number; nonce: string }): string =>
	JSON.stringify([
		'P2PK',
		{
			nonce: input.nonce,
			data: input.childPubkey,
			tags: [
				['sigflag', 'SIG_INPUTS'],
				['locktime', String(input.locktime)],
				['refund', input.refundPubkey],
				['n_sigs', '1'],
				['n_sigs_refund', '1'],
			],
		},
	])

/**
 * Build the full, production-valid auction chain behind an auction order:
 * a *closed* kind-30408 listing, a real kind-1023 winning bid locked to a
 * derived seller child key, the auditor kind-30440 confirmation that makes the
 * bid the canonical winner, the winner's kind-1025 path release (referencing
 * the real bid event id and carrying the locked proofs), and the seller's
 * settled kind-1024 settlement (`close_at` after `max_end_at`, `final_amount`
 * >= `reserve`, payout for the winning leg).
 *
 * Every event is signed locally (deterministic ids, no relay, no mint, no
 * network) and is shaped by the same tag builders production publishes with, so
 * the app's own parsers/validators (`parseAuctionEvent`, `parseBidEvent`,
 * `parseValidatorVerdictEvent`, `parsePathReleaseEvent`, `parseSettlementEvent`,
 * `validateBid`, `validatePathRelease`, `validateSettlementCompleteness`,
 * `computeValidatedBids`) accept the result. See
 * `e2e/scenarios/auctionOrderFixture.test.ts` for that cross-validation.
 */
export function buildAuctionOrderFixture(input: { now: number; title?: string; description?: string }): AuctionOrderFixture {
	const { now } = input
	const title = input.title ?? 'Test Auction'

	const startAt = now - E2E_AUCTION_OPENED_SECONDS_AGO
	const endAt = now - E2E_AUCTION_CLOSED_SECONDS_AGO
	// No anti-snipe extension: the auction closes at end_at/max_end_at.
	const maxEndAt = endAt
	const settlementGrace = E2E_AUCTION_SETTLEMENT_GRACE_SECONDS
	const reserve = E2E_AUCTION_RESERVE_SATS
	const amount = E2E_AUCTION_WINNING_BID_SATS
	const locktime = maxEndAt + settlementGrace

	const auctionId = `auc_${now}_${uuidv4().slice(0, 8)}`
	const auctionTags = buildAuctionEventTags({
		dTag: auctionId,
		title,
		startAt,
		endAt,
		maxEndAt,
		settlementGrace,
		reserve,
		startingBid: E2E_AUCTION_STARTING_BID_SATS,
		bidIncrement: 100,
		mints: [E2E_AUCTION_MINT_URL],
		p2pkXpub: XPUB,
		auditors: [devUser3.pk],
		auditorQuorum: 1,
		minBidCurve: { shape: 'none', peakMultiplier: 1, raw: '' },
		summary: 'E2E test auction',
		categories: ['bitcoin'],
	})
	// Display-only tag the auction surfaces use for pricing cards.
	auctionTags.push(['price', String(amount), 'SAT'])

	const auctionEvent = finalizeEvent(
		{
			kind: AUCTION_KIND,
			created_at: startAt,
			content: input.description ?? 'E2E test auction description.',
			tags: auctionTags,
		},
		hexToBytes(devUser1.sk),
	)

	const itemTagValue = `${AUCTION_KIND}:${auctionEvent.pubkey}:${auctionId}`
	const bidderPubkey = getPublicKey(hexToBytes(devUser2.sk))
	const refundPubkey = compressedPubkeyFromSecretKey(devUser2.sk)
	const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(XPUB, E2E_AUCTION_DERIVATION_PATH)
	const lockSecret = buildAuctionLockSecret({ childPubkey, refundPubkey, locktime, nonce: uuidv4() })
	const proofY = hashToCurveHexFromString(lockSecret)

	const bidEvent = finalizeEvent(
		{
			kind: AUCTION_BID_KIND,
			created_at: maxEndAt - 60,
			content: 'E2E winning bid',
			tags: buildBidEventTags({
				auctionRootEventId: auctionEvent.id,
				auctionCoordinate: itemTagValue,
				sellerPubkey: auctionEvent.pubkey,
				amount,
				mint: E2E_AUCTION_MINT_URL,
				locktime,
				refundPubkey,
				childPubkey,
				lockSecrets: [lockSecret],
				proofYs: [proofY],
				createdForEndAt: endAt,
				bidNonce: uuidv4(),
			}),
		},
		hexToBytes(devUser2.sk),
	)

	const verdictEvent = finalizeEvent(
		{
			kind: VALIDATOR_VERDICT_KIND,
			created_at: bidEvent.created_at + 30,
			content: 'E2E auditor confirmation',
			tags: buildValidatorVerdictTags({
				bidderPubkey,
				auctionRootEventId: auctionEvent.id,
				auctionCoordinate: itemTagValue,
				bidEventId: bidEvent.id,
				claim: 'won_pending_settlement',
				observedAt: bidEvent.created_at,
			}),
		},
		hexToBytes(devUser3.sk),
	)

	// The locked proofs as a redeemable cashu token. The proofs are P2PK-locked
	// to derive(p2pk_xpub, path), so publishing the token grants spend authority
	// to nobody but the seller. `C` is the bidder's own (valid) compressed key —
	// the e2e harness never spends this, so no live mint is involved.
	const cashuToken = getEncodedToken({
		mint: E2E_AUCTION_MINT_URL,
		proofs: [{ id: E2E_AUCTION_KEYSET_ID, amount, secret: lockSecret, C: refundPubkey }],
	})

	const pathReleaseEvent = finalizeEvent(
		{
			kind: AUCTION_PATH_RELEASE_KIND,
			created_at: maxEndAt + 60,
			content: '',
			tags: buildPathReleaseTags({
				bidEventId: bidEvent.id,
				auctionCoordinate: itemTagValue,
				sellerPubkey: auctionEvent.pubkey,
				derivationPath: E2E_AUCTION_DERIVATION_PATH,
				childPubkey,
				releaseReason: 'settlement',
				cashuToken,
			}),
		},
		hexToBytes(devUser2.sk),
	)

	const settlementEvent = finalizeEvent(
		{
			kind: AUCTION_SETTLEMENT_KIND,
			created_at: maxEndAt + 120,
			content: '',
			tags: buildSettlementTags({
				auctionRootEventId: auctionEvent.id,
				auctionCoordinate: itemTagValue,
				status: 'settled',
				closeAt: maxEndAt + 60,
				finalAmount: amount,
				winningBidId: bidEvent.id,
				winnerPubkey: bidderPubkey,
				pathReleaseEventId: pathReleaseEvent.id,
				payouts: [{ bidEventId: bidEvent.id, amount, status: 'redeemed' }],
			}),
		},
		hexToBytes(devUser1.sk),
	)

	const fixture: AuctionOrderFixture = {
		auctionEvent,
		bidEvent,
		verdictEvent,
		pathReleaseEvent,
		settlementEvent,
		itemTagValue,
		amount,
		now,
	}

	// Publish-time gate: a fixture that cannot pass the SAME parsers and
	// cross-event validators production runs must never reach the relay.
	// Green E2E on impossible relay data proves nothing, so this throws
	// instead of seeding an impossible auction.
	assertAuctionOrderFixtureValid(fixture)

	return fixture
}

/**
 * Cross-event validation gate for {@link buildAuctionOrderFixture}.
 *
 * Runs every seeded event through the production parsers, then through the
 * production cross-event validators:
 *
 *   - `computeValidatedBids` — auditor quorum makes the seeded bid the
 *     canonical winner,
 *   - `validatePathRelease` — the kind-1025 release is a valid winner release
 *     for that bid (derivation path / child pubkey / release timing),
 *   - `validateSettlementCompleteness` — the kind-1024 settled event is
 *     complete for the winning bid chain (matching payout, close_at after
 *     `max_end_at`, `final_amount` >= reserve).
 *
 * Throws on the first violation, so `buildAuctionOrderFixture` can never seed
 * an auction whose events a real client would never have published.
 */
export function assertAuctionOrderFixtureValid(fixture: AuctionOrderFixture): void {
	const parsed = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }, label: string): T => {
		if (!result.ok) throw new Error(`auction order fixture: ${label} does not parse — ${result.error.message}`)
		return result.value
	}

	const auction = parsed(parseAuctionEvent(fixture.auctionEvent), 'kind-30408 listing')
	const bid = parsed(parseBidEvent(fixture.bidEvent), 'kind-1023 winning bid')
	const verdict = parsed(parseValidatorVerdictEvent(fixture.verdictEvent), 'kind-30440 auditor verdict')
	const pathRelease = parsed(parsePathReleaseEvent(fixture.pathReleaseEvent), 'kind-1025 path release')
	const settlement = parsed(parseSettlementEvent(fixture.settlementEvent), 'kind-1024 settlement')

	if (auction.endAt >= fixture.now) {
		throw new Error(
			`auction order fixture: auction is still open (end_at=${auction.endAt} >= now=${fixture.now}); a settlement cannot exist for an open auction`,
		)
	}
	if (auction.reserve == null || auction.reserve <= 0) {
		throw new Error('auction order fixture: auction has no positive reserve')
	}
	if (settlement.finalAmount < auction.reserve) {
		throw new Error(`auction order fixture: settlement final_amount ${settlement.finalAmount} is below the reserve ${auction.reserve}`)
	}

	const quorum = computeValidatedBids({
		auction,
		bids: [bid],
		verdicts: [verdict],
		postSettlement: true,
		settledBidIds: new Set([bid.id]),
	})
	if (quorum.canonicalWinner?.id !== bid.id) {
		throw new Error(`auction order fixture: auditor quorum does not confirm ${bid.id} as the canonical winning bid`)
	}

	const releaseValidity = validatePathRelease({
		auction,
		bid,
		release: pathRelease,
		now: fixture.now,
		postCloseDecision: 'winner',
		// Token decoding needs mint keysets the fixture deliberately does not
		// fetch; production validators also skip it (it is the seller's
		// redemption-time check).
		skipCashuTokenCheck: true,
	})
	if (!releaseValidity.isValid) {
		throw new Error(`auction order fixture: kind-1025 path release is invalid (${releaseValidity.failureCode}) — ${releaseValidity.detail}`)
	}

	const completeness = validateSettlementCompleteness({
		auction,
		settlement,
		winningBid: bid,
		pathRelease,
		winningBidClaim: verdict.claim,
		winningBidPostCloseDecision: 'winner',
		// A settled settlement by definition follows the seller's redemption;
		// the fixture declares its payout as redeemed.
		winningBidNut7State: 'spent',
	})
	if (!completeness.isComplete) {
		throw new Error(`auction order fixture: kind-1024 settlement is not complete (${completeness.failureCode}) — ${completeness.detail}`)
	}
}

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
	let relay: Relay | null = null

	try {
		relay = await Relay.connect(RELAY_URL)
		const buyerSkBytes = hexToBytes(devUser2.sk)
		const sellerSkBytes = hexToBytes(devUser1.sk)

		const orderId = uuidv4()
		const now = Math.floor(Date.now() / 1000)

		let productEvent: VerifiedEvent | undefined
		let auctionEvent: VerifiedEvent | undefined
		let auctionFixture: AuctionOrderFixture | undefined
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
			// Production-valid auction chain: a *closed* kind-30408 listing, the
			// real kind-1023 winning bid, the auditor confirmation that makes it
			// the canonical winner, the winner's kind-1025 path release
			// (referencing that bid event id), and the seller's settled kind-1024
			// (final_amount >= reserve, close_at after max_end_at). Published
			// before the claim order so the order can reference the real
			// settlement event id.
			auctionFixture = buildAuctionOrderFixture({ now })
			for (const event of [
				auctionFixture.auctionEvent,
				auctionFixture.bidEvent,
				auctionFixture.verdictEvent,
				auctionFixture.pathReleaseEvent,
				auctionFixture.settlementEvent,
			]) {
				await relay.publish(event)
			}
			auctionEvent = auctionFixture.auctionEvent
			itemTagValue = auctionFixture.itemTagValue
			orderAmount = String(auctionFixture.amount)
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
			if (!relay) throw new Error('Seed method error: Relay initialization failed!')

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
	} finally {
		if (relay) {
			relay.close()
		}
	}
}
