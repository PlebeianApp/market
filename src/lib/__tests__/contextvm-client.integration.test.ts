import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { getPublicKey } from 'nostr-tools/pure'
import { RelayLiveness } from 'applesauce-relay'
import { PlebianCurrencyClient } from '../ctxcn-client'
import { getCurrencyServerRelays } from '@/lib/constants'

const RELAY_URL = process.env.RELAY_URL || process.env.APP_RELAY_URL || 'ws://localhost:10547'
const SERVER_PRIVATE_KEY = process.env.CVM_SERVER_KEY || '2300f5fff5642341946758cad8214f2c54f3c40fba5ba51b616452b197fd3e71'
const DERIVED_SERVER_PUBKEY = getPublicKey(new Uint8Array(Buffer.from(SERVER_PRIVATE_KEY, 'hex')))
const SERVER_PUBKEY = process.env.CVM_SERVER_PUBKEY || DERIVED_SERVER_PUBKEY
const RELAYS = Array.from(new Set([RELAY_URL, ...getCurrencyServerRelays()]))

// The three CVM relays configured in src/lib/constants.ts (Issue #901). A single
// relay outage must not hang currency lookups because the others keep working.
const CVM_RELAY_URLS = ['wss://relay.contextvm.org', 'wss://relay.primal.net', 'wss://relay.nostr.net']

describe('PlebianCurrencyClient integration', () => {
	let client: PlebianCurrencyClient | undefined

	beforeAll(() => {
		client = new PlebianCurrencyClient({
			privateKey: crypto.getRandomValues(new Uint8Array(32)),
			relays: RELAYS,
			serverPubkey: SERVER_PUBKEY,
		})
	})

	afterAll(() => {
		client?.close()
	})

	test('wires the browser/runtime config used by the CTXCN path', () => {
		// The real end-to-end CTXCN happy path was validated in the browser:
		// request queued -> published -> response received -> BTC fetch succeeded.
		// We keep the Bun test harness to a lightweight config smoke test.
		expect(SERVER_PUBKEY).toBe(DERIVED_SERVER_PUBKEY)
		expect(RELAYS).toContain('ws://localhost:10547')
		expect(RELAYS.length).toBeGreaterThan(0)
		expect(() => {
			client = new PlebianCurrencyClient({
				privateKey: crypto.getRandomValues(new Uint8Array(32)),
				relays: RELAYS,
				serverPubkey: SERVER_PUBKEY,
			})
		}).not.toThrow()
		expect(client).toBeDefined()
	})

	test('configures three CVM relays so a single outage can be failed over (Issue #901)', () => {
		const configured = getCurrencyServerRelays()
		for (const url of CVM_RELAY_URLS) {
			expect(configured).toContain(url)
		}
	})

	test('exposes failover-aware health: every relay usable on a cold start', () => {
		const cold = new PlebianCurrencyClient({
			privateKey: crypto.getRandomValues(new Uint8Array(32)),
			relays: CVM_RELAY_URLS,
			serverPubkey: SERVER_PUBKEY,
		})
		// Nothing has connected yet, so liveness has observed no failures and
		// every configured relay is still considered usable.
		expect(cold.healthyRelays().length).toBe(CVM_RELAY_URLS.length)
		expect(cold.allRelaysUnhealthy()).toBe(false)
		cold.close()
	})
})

describe('RelayLiveness failover (applesauce-relay)', () => {
	// Mirrors how PlebianCurrencyClient wires RelayLiveness: maxFailuresBeforeDead: 3.
	test('auto-blacklists a relay after repeated failures while keeping the rest usable', async () => {
		const relays = ['wss://relay-a.test', 'wss://relay-b.test', 'wss://relay-c.test']
		const liveness = new RelayLiveness({ maxFailuresBeforeDead: 3, backoffBaseDelay: 1, backoffMaxDelay: 1 })

		// Cold start: nothing observed yet, every relay is usable.
		expect(liveness.filter(relays).length).toBe(3)

		// Drive one relay past the failure threshold. Failures that arrive inside
		// the backoff window are ignored, so we let each 1ms window clear first.
		for (let i = 0; i < 3; i++) {
			liveness.recordFailure('wss://relay-a.test')
			await new Promise((resolve) => setTimeout(resolve, 10))
		}

		const usable = liveness.filter(relays)
		expect(usable).not.toContain('wss://relay-a.test')
		expect(usable).toContain('wss://relay-b.test')
		expect(usable).toContain('wss://relay-c.test')
		expect(usable.length).toBe(2)
	})
})
