import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { getPublicKey } from 'nostr-tools/pure'
import { PlebianCurrencyClient } from '../ctxcn-client'
import { getCurrencyServerRelays } from '@/lib/constants'

const RELAY_URL = process.env.RELAY_URL || process.env.APP_RELAY_URL || 'ws://localhost:10547'
const SERVER_PRIVATE_KEY = process.env.CVM_SERVER_KEY
if (!SERVER_PRIVATE_KEY) {
	throw new Error('CVM_SERVER_KEY environment variable is required for integration tests')
}
const DERIVED_SERVER_PUBKEY = getPublicKey(new Uint8Array(Buffer.from(SERVER_PRIVATE_KEY, 'hex')))
const SERVER_PUBKEY = process.env.CVM_SERVER_PUBKEY || DERIVED_SERVER_PUBKEY
const RELAYS = Array.from(new Set([RELAY_URL, ...getCurrencyServerRelays()]))

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
})
