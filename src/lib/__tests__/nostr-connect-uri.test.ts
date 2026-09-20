/**
 * NostrConnect URI emit + inbound-secret helpers (ADR-0002 amendment B-4, #807).
 *
 * The `nostrconnect://` spec carries the connection secret in the `secret`
 * query param. A legacy `token=`-only URI must fail closed. This module is
 * the single app-side home for building a spec-compliant URI and for
 * validating a decrypted connect request's secret — the NostrConnectQR
 * component delegates to it so the #807 behavior is unit-testable.
 */
import { describe, expect, test } from 'bun:test'
import { parseNostrConnectURI } from 'applesauce-signers/helpers'

import {
	buildNostrConnectUri,
	extractConnectSecret,
	isApprovedNostrConnectResponse,
	isMatchingConnectSecret,
} from '@/lib/nostr/nostr-connect-uri'

const CLIENT_PK = 'aa'.repeat(32)
const RELAY = 'wss://relay.example.com'
const SECRET = 'hunter2'

describe('buildNostrConnectUri (ADR-0002 amendment B-4 / #807)', () => {
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
		// buildNostrConnectUri refuses to produce a URI without a secret. The
		// library parser is the backstop: it throws on absent `secret`, and a
		// legacy `token`-only URI carries no `secret`, so it rejects too.
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

describe('isMatchingConnectSecret (ADR-0002 amendment B-4 / #807)', () => {
	test('accepts a connect request whose params echo the expected "secret"', () => {
		expect(isMatchingConnectSecret({ secret: SECRET }, SECRET)).toBe(true)
	})

	test('accepts the SPEC positional-array params shape (NIP-46: params is an array of strings)', () => {
		// nips/46.md: connect → [<remote-signer-pubkey>, <optional_secret>, …].
		// A real signer sends the secret positionally; the object form above is
		// this app's own legacy/mock shape. Both must be honoured.
		expect(isMatchingConnectSecret([SECRET], SECRET)).toBe(true)
		expect(isMatchingConnectSecret([SECRET, 'sign_event'], SECRET)).toBe(true)
		expect(isMatchingConnectSecret([], SECRET)).toBe(false)
		expect(isMatchingConnectSecret([''], SECRET)).toBe(false)
		expect(isMatchingConnectSecret([SECRET], 'other-secret')).toBe(false)
		expect(isMatchingConnectSecret(['wrong', 'sign_event'], SECRET)).toBe(false)
	})

	test('rejects a legacy "token"-only connect request (no secret param)', () => {
		expect(isMatchingConnectSecret({ token: SECRET }, SECRET)).toBe(false)
		expect(isMatchingConnectSecret([SECRET], '')).toBe(false)
		expect(isMatchingConnectSecret({ secret: SECRET }, '')).toBe(false)
	})

	test('rejects a wrong secret and missing params', () => {
		expect(isMatchingConnectSecret({ secret: 'wrong' }, SECRET)).toBe(false)
		expect(isMatchingConnectSecret(undefined, SECRET)).toBe(false)
		expect(isMatchingConnectSecret(null, SECRET)).toBe(false)
		expect(isMatchingConnectSecret('secret-as-a-bare-string', SECRET)).toBe(false)
	})

	test('extractConnectSecret reads the secret from either shape and never from `token`', () => {
		expect(extractConnectSecret([SECRET, 'perms'])).toBe(SECRET)
		expect(extractConnectSecret({ secret: SECRET })).toBe(SECRET)
		expect(extractConnectSecret({ token: SECRET })).toBeUndefined()
		expect(extractConnectSecret([123])).toBeUndefined()
		expect(extractConnectSecret(undefined)).toBeUndefined()
	})
})

describe('isApprovedNostrConnectResponse (QR signer-approval gate, ported from #1290)', () => {
	const APPROVED = 'aa'.repeat(32)
	const UNAPPROVED = 'bb'.repeat(32)
	const approvedSignerPubkeys = new Set([APPROVED])

	test('accepts the secret echo and the approval ack from an APPROVED signer', () => {
		expect(isApprovedNostrConnectResponse(SECRET, SECRET, APPROVED, approvedSignerPubkeys)).toBe(true)
		expect(isApprovedNostrConnectResponse('ack', SECRET, APPROVED, approvedSignerPubkeys)).toBe(true)
	})

	test('never binds an UNAPPROVED signer — a bare ack from a relay peer is not approval', () => {
		// Without this gate, any peer able to encrypt to the (public) client
		// pubkey could send `{"result":"ack"}` and bind the session to its own
		// bunker endpoint without ever knowing the secret.
		expect(isApprovedNostrConnectResponse('ack', SECRET, UNAPPROVED, approvedSignerPubkeys)).toBe(false)
		expect(isApprovedNostrConnectResponse(SECRET, SECRET, UNAPPROVED, approvedSignerPubkeys)).toBe(false)
	})

	test('rejects a non-matching result even from an approved signer', () => {
		expect(isApprovedNostrConnectResponse('not-the-secret', SECRET, APPROVED, approvedSignerPubkeys)).toBe(false)
		expect(isApprovedNostrConnectResponse(undefined, SECRET, APPROVED, approvedSignerPubkeys)).toBe(false)
	})

	test('no approved signers yet → nothing is accepted', () => {
		const none = new Set<string>()
		expect(isApprovedNostrConnectResponse('ack', SECRET, APPROVED, none)).toBe(false)
		expect(isApprovedNostrConnectResponse(SECRET, SECRET, APPROVED, none)).toBe(false)
	})
})
