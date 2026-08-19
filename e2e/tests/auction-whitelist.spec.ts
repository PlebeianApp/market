/**
 * E2E tests for auction whitelist (kind-30408 auction creation gating).
 *
 * Test plan: plebeian-e2e-test-plan-2026-08-19.md, Task 2 (tests 2.1–2.4).
 *
 * Coverage:
 *   2.1  Whitelisted pubkey can publish kind-30408 (whitelist mode)
 *   2.2  Non-whitelisted pubkey is rejected by server (whitelist mode)
 *   2.3  Open mode allows any pubkey to publish auction
 *   2.4  /api/config endpoint reports whitelist mode and state
 *
 * Tests 2.1/2.2 require the dev server to be started with:
 *   APP_AUCTION_WHITELIST_MODE=whitelist
 *   APP_AUCTION_WHITELIST_PUBKEYS=<devUser1.pk>
 *
 * Test 2.3 requires open mode (the default). The tests auto-detect the
 * server's mode via /api/config and skip appropriately.
 */

import { test, expect } from '../fixtures'
import { finalizeEvent } from 'nostr-tools/pure'
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay'
import { hexToBytes } from '@noble/hashes/utils.js'
import WebSocket from 'ws'
import { devUser1, devUser3 } from '../../src/lib/fixtures'
import { queryRelayEvents, getTagValue } from '../utils/relay-query'
import { BASE_URL, RELAY_URL } from '../test-config'

useWebSocketImplementation(WebSocket)

const AUCTION_KIND = 30408
const SERVER_WS_URL = `ws://localhost:34567` // dev server WebSocket

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid kind-30408 auction event template. */
function buildAuctionTemplate(opts: { dTag: string; title?: string }) {
	const now = Math.floor(Date.now() / 1000)
	return {
		kind: AUCTION_KIND,
		created_at: now,
		content: 'E2E whitelist test auction',
		tags: [
			['d', opts.dTag],
			['title', opts.title ?? `Whitelist Test ${opts.dTag}`],
			['summary', 'E2E test auction for whitelist verification'],
			['image', 'https://placehold.co/400x400'],
			['price', '5000', 'SATS'],
			['status', 'on-sale'],
			['start_at', String(now)],
			['end_at', String(now + 86400)],
			['max_end_at', String(now + 172800)],
			['settlement_grace', '3600'],
			['t', 'art'],
			['mint', 'https://mint.minibits.cash/Bitcoin'],
		],
	}
}

/**
 * Send a kind-30408 event through the dev server's WebSocket (mimicking what
 * the app does). Returns the OK response from the server.
 */
async function sendEventThroughServer(opts: {
	sk: string
	dTag: string
	title?: string
}): Promise<{ accepted: boolean; messageId: string; reason: string }> {
	const skBytes = hexToBytes(opts.sk)
	const template = buildAuctionTemplate(opts)
	const event = finalizeEvent(template, skBytes)

	return new Promise((resolve, reject) => {
		const ws = new WebSocket(SERVER_WS_URL)
		const timeout = setTimeout(() => {
			ws.close()
			reject(new Error('WebSocket timeout waiting for OK response'))
		}, 15_000)

		ws.on('open', () => {
			ws.send(JSON.stringify(['EVENT', event]))
		})

		ws.on('message', (data: Buffer | string) => {
			const msg = JSON.parse(data.toString())
			if (msg[0] === 'OK') {
				clearTimeout(timeout)
				ws.close()
				resolve({
					accepted: msg[2] === true,
					messageId: msg[1],
					reason: msg[3] || '',
				})
			}
		})

		ws.on('error', (err) => {
			clearTimeout(timeout)
			reject(err)
		})
	})
}

/** Fetch /api/config and return the JSON. */
async function fetchConfig(): Promise<any> {
	const resp = await fetch(`${BASE_URL}/api/config`)
	expect(resp.ok).toBe(true)
	return resp.json()
}

/**
 * Wait for an auction event to appear on the relay (polling).
 * The server re-signs all events with the app key, so we query by `d` tag
 * only — the author on the relay will be the app's pubkey, not the
 * original sender's.
 */
async function waitForRelayEvent(opts: {
	dTag: string
	timeoutMs?: number
}): Promise<any | null> {
	const { dTag, timeoutMs = 10_000 } = opts
	const start = Date.now()

	while (Date.now() - start < timeoutMs) {
		const events = await queryRelayEvents({
			kinds: [AUCTION_KIND],
			'#d': [dTag],
			limit: 10,
		})

		if (events.length > 0) {
			return events[0]
		}

		await new Promise((r) => setTimeout(r, 500))
	}

	return null
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Auction Whitelist', () => {
	// Detect the server's whitelist mode once for all tests
	let whitelistMode: 'whitelist' | 'open' = 'open'

	test.beforeAll(async () => {
		const config = await fetchConfig()
		whitelistMode = config.auctionWhitelist?.mode ?? 'open'
		console.log(`Server whitelist mode: ${whitelistMode}`)
	})

	// -------------------------------------------------------------------------
	// Test 2.1: Whitelisted pubkey can publish kind-30408 (whitelist mode only)
	// -------------------------------------------------------------------------

	test('2.1 — whitelisted pubkey auction event accepted by server', async ({ merchantPage }) => {
		test.setTimeout(120_000)

		// Skip if server is not in whitelist mode
		test.skip(whitelistMode !== 'whitelist', 'Server must be in whitelist mode (APP_AUCTION_WHITELIST_MODE=whitelist)')

		const dTag = `wl-accepted-${Date.now()}`

		// Send a kind-30408 event through the server's WebSocket as devUser1 (whitelisted)
		const result = await sendEventThroughServer({
			sk: devUser1.sk,
			dTag,
			title: 'Whitelisted Auction Test',
		})

		// Assert the server accepted the event
		expect(result.accepted).toBe(true)
		expect(result.reason).toBe('')

		// Wait for the event to appear on the relay (server re-signs with app key)
		const relayEvent = await waitForRelayEvent({
			dTag,
			timeoutMs: 15_000,
		})

		// The event should be on the relay
		// Note: the server re-signs with the app key, so the author may differ.
		// We check by d tag instead.
		expect(relayEvent).not.toBeNull()
		expect(relayEvent.kind).toBe(AUCTION_KIND)
		expect(getTagValue(relayEvent, 'd')).toBe(dTag)
	})

	// -------------------------------------------------------------------------
	// Test 2.2: Non-whitelisted pubkey rejected (whitelist mode only)
	// -------------------------------------------------------------------------

	test('2.2 — non-whitelisted pubkey auction event rejected by server', async () => {
		test.setTimeout(60_000)

		// Skip if server is not in whitelist mode
		test.skip(whitelistMode !== 'whitelist', 'Server must be in whitelist mode (APP_AUCTION_WHITELIST_MODE=whitelist)')

		const dTag = `wl-rejected-${Date.now()}`

		// Send a kind-30408 event through the server's WebSocket as devUser3 (NOT whitelisted)
		const result = await sendEventThroughServer({
			sk: devUser3.sk,
			dTag,
			title: 'Non-Whitelisted Auction Test',
		})

		// Assert the server rejected the event
		expect(result.accepted).toBe(false)
		expect(result.reason).toContain('Not authorized')

		// Verify the event did NOT appear on the relay via the server.
		// The server re-signs with the app key, so we check by d tag.
		// Give it a moment then check.
		await new Promise((r) => setTimeout(r, 2000))

		const events = await queryRelayEvents({
			kinds: [AUCTION_KIND],
			'#d': [dTag],
			limit: 10,
		})

		// The server should not have re-published this event
		expect(events.length).toBe(0)
	})

	// -------------------------------------------------------------------------
	// Test 2.3: Open mode allows all pubkeys (open mode only)
	// -------------------------------------------------------------------------

	test('2.3 — open whitelist mode allows any pubkey to publish auction', async () => {
		test.setTimeout(120_000)

		// Skip if server is in whitelist mode (this test needs open mode)
		test.skip(whitelistMode !== 'open', 'Server must be in open mode (default)')

		const dTag = `open-mode-${Date.now()}`

		// Send a kind-30408 event through the server's WebSocket as devUser3 (not in any whitelist)
		const result = await sendEventThroughServer({
			sk: devUser3.sk,
			dTag,
			title: 'Open Mode Auction Test',
		})

		// Assert the server accepted the event
		expect(result.accepted).toBe(true)

		// Wait for the event to appear on the relay
		const relayEvent = await waitForRelayEvent({
			dTag,
			timeoutMs: 15_000,
		})

		// The event should be on the relay
		expect(relayEvent).not.toBeNull()
		expect(relayEvent.kind).toBe(AUCTION_KIND)
		expect(getTagValue(relayEvent, 'd')).toBe(dTag)
	})

	// -------------------------------------------------------------------------
	// Test 2.4: Whitelist config visible via API
	// -------------------------------------------------------------------------

	test('2.4 — api config endpoint reports whitelist mode and state', async () => {
		test.setTimeout(30_000)

		// Fetch /api/config
		const config = await fetchConfig()

		// Assert the auctionWhitelist field exists
		expect(config.auctionWhitelist).toBeDefined()
		expect(config.auctionWhitelist.mode).toBeDefined()

		// Assert mode is either 'whitelist' or 'open'
		expect(['whitelist', 'open']).toContain(config.auctionWhitelist.mode)

		// Assert whitelistedPubkeys is an array
		expect(Array.isArray(config.auctionWhitelist.whitelistedPubkeys)).toBe(true)

		// Privacy check: no private key data should be in the response
		const configStr = JSON.stringify(config)
		expect(configStr).not.toContain('privateKey')
		expect(configStr).not.toContain('private_key')
		expect(configStr).not.toContain('appPrivateKey')

		// If in whitelist mode, there should be at least one whitelisted pubkey
		if (config.auctionWhitelist.mode === 'whitelist') {
			expect(config.auctionWhitelist.whitelistedPubkeys.length).toBeGreaterThan(0)
		}

		console.log('Auction whitelist config:', config.auctionWhitelist)
	})
})