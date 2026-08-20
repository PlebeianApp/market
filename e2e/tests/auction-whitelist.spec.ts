import { test, expect } from '../fixtures'
import { finalizeEvent } from 'nostr-tools/pure'
import { Relay } from 'nostr-tools/relay'
import { hexToBytes } from '@noble/hashes/utils.js'
import { devUser1, devUser2 } from '../../src/lib/fixtures'
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
	try {
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
			['image', 'https://cdn.satellite.earth/f8f1513ec22f966626dc05342a3bb1f36096d28dd0e6eeae640b5df44f2c7c84.png'],
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
		return event as unknown as RelayEvent
	} finally {
		await relay.close()
	}
}

/**
 * Fetch the /api/config endpoint from the running dev server and return the JSON body.
 */
async function fetchApiConfig(): Promise<any> {
	const resp = await fetch(`${BASE_URL}/api/config`)
	expect(resp.ok).toBe(true)
	return resp.json()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Auction Whitelist', () => {
	// Test 1: Merchant auction event round-trips through the relay
	test('merchant auction event is stored and queryable on the relay', async () => {
		test.setTimeout(60_000)

		// The e2e dev server runs without AUCTION_WHITELIST_* env vars, so the
		// effective mode is 'open' and devUser1 (merchant) may publish.
		const event = await publishAuctionAs(devUser1.sk)

		// Query relay to confirm the event was accepted and is queryable
		const events = await queryRelayEvents({
			kinds: [30408],
			authors: [devUser1.pk],
			limit: 10,
		})

		const found = events.find((e) => e.id === event.id)
		expect(found).toBeDefined()
		expect(found!.kind).toBe(30408)
	})

	// Test 2: In default open mode a non-merchant pubkey can publish auctions
	test('open mode allows any pubkey to publish an auction', async () => {
		test.setTimeout(60_000)

		// devUser2 is neither admin nor merchant — in open mode their auction
		// must still be accepted and queryable.
		const event = await publishAuctionAs(devUser2.sk)
		const events = await queryRelayEvents({
			kinds: [30408],
			authors: [devUser2.pk],
			limit: 10,
		})

		const found = events.find((e) => e.id === event.id)
		expect(found).toBeDefined()
	})

	// Test 3: The dev server reports its effective auction whitelist state
	test('api config endpoint reports effective auction whitelist state', async () => {
		test.setTimeout(30_000)

		// Hit the real /api/config endpoint served by the local dev server.
		// The e2e dev server is started without AUCTION_WHITELIST_* env vars,
		// so the effective whitelist state must be the documented default:
		// open mode with zero whitelisted pubkeys
		// (see docs/adr/proposals/auction-whitelist.md).
		const config = await fetchApiConfig()

		expect(config.auctionWhitelist).toBeDefined()
		expect(config.auctionWhitelist.mode).toBe('open')
		expect(config.auctionWhitelist.pubkeyCount).toBe(0)
	})
})
