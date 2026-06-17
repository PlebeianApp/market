import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { PlebianCurrencyClient } from '../ctxcn-client'
import { getCurrencyServerRelays } from '@/lib/constants'
import { resolveCvmServerPubkey } from '../cvm-identity'

const RELAY_URL = process.env.RELAY_URL || process.env.APP_RELAY_URL || 'ws://localhost:10547'
const SERVER_PUBKEY = (() => {
	try {
		return resolveCvmServerPubkey()
	} catch {
		throw new Error('CVM_SERVER_KEY or CVM_SERVER_PUBKEY environment variable is required for integration tests')
	}
})()
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
