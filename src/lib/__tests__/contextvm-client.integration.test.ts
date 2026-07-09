import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { getPublicKey } from 'nostr-tools/pure'
import { PlebianCurrencyClient } from '../ctxcn-client'
import { getCurrencyServerRelays, PUBLIC_CVM_RELAYS } from '@/lib/constants'
import { resolveCvmServerPubkey } from '../cvm-identity'

const RELAY_URL = process.env.RELAY_URL || process.env.APP_RELAY_URL || 'ws://localhost:10547'
const SERVER_PUBKEY = (() => {
	try {
		return resolveCvmServerPubkey()
	} catch {
		throw new Error('CVM_SERVER_KEY or CVM_SERVER_PUBKEY environment variable is required for integration tests')
	}
})()
const DERIVED_SERVER_PUBKEY = (() => {
	const key = process.env.CVM_SERVER_KEY
	if (!key) throw new Error('CVM_SERVER_KEY required')
	return getPublicKey(new Uint8Array(Buffer.from(key, 'hex')))
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
		expect(SERVER_PUBKEY).toBe(DERIVED_SERVER_PUBKEY)
		expect(RELAYS).toContain('ws://localhost:10547')
		expect(RELAYS.length).toBeGreaterThan(0)
		// Production stage should also include the public CVM relays.
		for (const publicRelay of PUBLIC_CVM_RELAYS) expect(RELAYS).toContain(publicRelay)
		// Non-prod stages should NOT include them — verify the gate works.
		expect(getCurrencyServerRelays('staging')).toEqual([])
		expect(getCurrencyServerRelays('development')).toEqual([])
		expect(getCurrencyServerRelays(undefined)).toEqual([])
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
