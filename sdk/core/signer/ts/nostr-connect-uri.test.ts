/**
 * The `nostrconnect://` seam — harvested from the market's
 * `src/lib/__tests__/nostr-connect-uri.test.ts` at `4bc7f8c0`, with the one
 * change a standalone module requires: the market's own path for the file
 * becomes `./uri`. Every case is kept; none is weakened.
 */
import { describe, expect, test } from 'bun:test'
import { parseNostrConnectURI } from 'applesauce-signers/helpers'

import { buildNostrConnectUri, isMatchingConnectSecret } from './uri'

const CLIENT_PK = 'aa'.repeat(32)
const RELAY = 'wss://relay.example.com'
const SECRET = 'hunter2'

describe('buildNostrConnectUri', () => {
	test('emits the secret via the spec "secret" query param (not legacy "token")', () => {
		const uri = buildNostrConnectUri({ clientPubkey: CLIENT_PK, relay: RELAY, secret: SECRET })

		expect(uri.startsWith(`nostrconnect://${CLIENT_PK}?`)).toBe(true)
		expect(uri).toContain('secret=' + SECRET)
		expect(uri).not.toContain('token=')
	})

	test('round-trips through the library parser: same client, relay, and secret', () => {
		const uri = buildNostrConnectUri({ clientPubkey: CLIENT_PK, relay: RELAY, secret: SECRET })
		const parsed = parseNostrConnectURI(uri)

		expect(parsed.client).toBe(CLIENT_PK)
		expect(parsed.secret).toBe(SECRET)
		expect(parsed.relays).toContain(RELAY)
	})

	test('fails closed (throws) when the secret is missing — a legacy token-only URI is rejected', () => {
		expect(() => buildNostrConnectUri({ clientPubkey: CLIENT_PK, relay: RELAY, secret: '' })).toThrow(/secret/i)
		expect(() => parseNostrConnectURI(`nostrconnect://${CLIENT_PK}?relay=${RELAY}&token=legacy`)).toThrow(/missing secret/i)
	})

	test('includes metadata when supplied', () => {
		const uri = buildNostrConnectUri({
			clientPubkey: CLIENT_PK,
			relay: RELAY,
			secret: SECRET,
			metadata: { name: 'Plebeian.market' },
		})
		expect(uri).toContain('metadata=')
		expect(uri).toContain('name')
	})
})

describe('isMatchingConnectSecret', () => {
	test('accepts a connect request whose params echo the expected "secret"', () => {
		expect(isMatchingConnectSecret({ secret: SECRET }, SECRET)).toBe(true)
	})

	test('rejects a legacy "token"-only connect request (no secret param)', () => {
		expect(isMatchingConnectSecret({ token: SECRET }, SECRET)).toBe(false)
	})

	test('rejects a wrong secret and missing params', () => {
		expect(isMatchingConnectSecret({ secret: 'wrong' }, SECRET)).toBe(false)
		expect(isMatchingConnectSecret(undefined, SECRET)).toBe(false)
	})
})
