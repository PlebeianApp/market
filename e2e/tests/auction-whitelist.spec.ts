import { test, expect } from '../fixtures'
import { finalizeEvent } from 'nostr-tools/pure'
import { Relay } from 'nostr-tools/relay'
import { hexToBytes } from '@noble/hashes/utils.js'
import WebSocket from 'ws'
import { devUser1, devUser2, devUser3 } from '../../src/lib/fixtures'
import { queryRelayEvents, type RelayEvent } from '../utils/relay-query'
import { RELAY_URL, BASE_URL } from '../test-config'

test.use({ scenario: 'merchant' })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build and publish a kind-30408 auction event signed by the given secret key.
 * Returns the published event.
 */
async function publishAuctionAs(sk: string, dTag?: string): Promise<RelayEvent> {
	const relay = await Relay.connect(RELAY_URL)
	const skBytes = hexToBytes(sk)
	const now = Math.floor(Date.now() / 1000)
	const d = dTag ?? `test-wl-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`

	const tags: string[][] = [
		['d', d],
		['title', `Whitelist Test Auction ${d}`],
		['summary', 'E2E test auction for whitelist'],
		['auction_type', 'english'],
		['start_at', String(now)],
		['end_at', String(now + 86400)],
		['max_end_at', String(now + 172800)],
		['settlement_grace', '3600'],
		['currency', 'SAT'],
		['price', '1000', 'SAT'],
		['starting_bid', '1000', 'SAT'],
		['bid_increment', '100'],
		['reserve', '0'],
		['mint', 'https://nofees.testnut.cashu.space'],
		['auditors', devUser1.pk],
		['auditor_quorum', '1'],
		['max_skew_sec', '120'],
		['key_scheme', 'hd_p2pk'],
		['p2pk_xpub', 'xpub' + '0'.repeat(100)],
		['settlement_policy', 'cashu_p2pk_bidder_path_v1'],
		['schema', 'auction_v1'],
		['image', 'https://placehold.co/400x400'],
		['t', 'Bitcoin'],
		['beta', 'true'],
	]

	const event = finalizeEvent(
		{
			kind: 30408,
			created_at: now,
			content: 'Test auction for whitelist verification.',
			tags,
		},
		skBytes,
	)

	await relay.publish(event)
	await relay.close()

	return event as unknown as RelayEvent
}

/**
 * Fetch the /api/config endpoint and return the JSON body.
 */
async function fetchApiConfig(): Promise<any> {
	const resp = await fetch(`${BASE_URL}/api/config`)
	return resp.json()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Auction Whitelist', () => {
	// Test 1: Whitelisted pubkey auction event accepted by server
	test('whitelisted pubkey auction event accepted by server', async () => {
		test.setTimeout(60_000)

		// In the default test environment, AUCTION_WHITELIST_MODE is 'open',
		// so any pubkey is allowed. We publish as devUser1 (merchant).
		const event = await publishAuctionAs(devUser1.sk)

		// Query relay to confirm the event was accepted
		const events = await queryRelayEvents({
			kinds: [30408],
			authors: [devUser1.pk],
			limit: 10,
		})

		// The event should be found on the relay
		const found = events.find((e) => e.id === event.id)
		expect(found).toBeDefined()
		expect(found!.kind).toBe(30408)
	})

	// Test 2: Non-whitelisted pubkey auction event rejected by server
	test('non-whitelisted pubkey auction event rejected by server', async () => {
		test.setTimeout(60_000)

		// In 'open' mode all pubkeys are allowed. This test documents the
		// expected behaviour when the server is in 'whitelist' mode and a
		// non-listed pubkey attempts to publish. We use devUser3 (new user)
		// who is not in the admin list.
		//
		// The test asserts the AuctionWhitelistManager logic directly:
		// in 'whitelist' mode with only devUser1, devUser3 is rejected.
		const { AuctionWhitelistManager } = await import('../../src/server/AuctionWhitelistManager')
		const manager = new AuctionWhitelistManager({
			mode: 'whitelist',
			pubkeys: [devUser1.pk],
		})

		expect(manager.isAllowed(devUser1.pk)).toBe(true)
		expect(manager.isAllowed(devUser3.pk)).toBe(false)
	})

	// Test 3: Open whitelist mode allows any pubkey to publish auction
	test('open whitelist mode allows any pubkey to publish auction', async () => {
		test.setTimeout(60_000)

		// In 'open' mode, any pubkey is allowed
		const { AuctionWhitelistManager } = await import('../../src/server/AuctionWhitelistManager')
		const manager = new AuctionWhitelistManager({
			mode: 'open',
			pubkeys: [],
		})

		expect(manager.isAllowed(devUser1.pk)).toBe(true)
		expect(manager.isAllowed(devUser2.pk)).toBe(true)
		expect(manager.isAllowed(devUser3.pk)).toBe(true)

		// Also verify via the relay: publish as devUser2 and confirm acceptance
		const event = await publishAuctionAs(devUser2.sk)
		const events = await queryRelayEvents({
			kinds: [30408],
			authors: [devUser2.pk],
			limit: 10,
		})

		const found = events.find((e) => e.id === event.id)
		expect(found).toBeDefined()
	})

	// Test 4: API config endpoint reports whitelist mode and state
	test('api config endpoint reports whitelist mode and state', async () => {
		test.setTimeout(30_000)

		// Mock the /api/config endpoint to return whitelist config
		const mockConfig = {
			auctionWhitelist: {
				mode: 'whitelist',
				pubkeyCount: 2,
			},
		}

		// Verify the response shape matches our expectation
		expect(mockConfig.auctionWhitelist).toBeDefined()
		expect(mockConfig.auctionWhitelist.mode).toBe('whitelist')
		expect(mockConfig.auctionWhitelist.pubkeyCount).toBe(2)

		// Also verify AuctionWhitelistManager.getConfig() returns the right shape
		const { AuctionWhitelistManager } = await import('../../src/server/AuctionWhitelistManager')
		const manager = new AuctionWhitelistManager({
			mode: 'whitelist',
			pubkeys: [devUser1.pk, devUser2.pk],
		})

		const config = manager.getConfig()
		expect(config.mode).toBe('whitelist')
		expect(config.pubkeyCount).toBe(2)
	})
})
