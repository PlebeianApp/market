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
/** The remote signer's pubkey — the value NIP-46 puts at `params[0]`. */
const REMOTE_PK = 'cc'.repeat(32)

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

	test("accepts the app's own positional-array shorthand and the secret in either admitted position", () => {
		// The app's own `[<secret>, …]` shorthand (index 0) keeps working…
		expect(isMatchingConnectSecret([SECRET], SECRET)).toBe(true)
		expect(isMatchingConnectSecret([SECRET, 'sign_event'], SECRET)).toBe(true)
		expect(isMatchingConnectSecret([], SECRET)).toBe(false)
		expect(isMatchingConnectSecret([''], SECRET)).toBe(false)
		expect(isMatchingConnectSecret([SECRET], 'other-secret')).toBe(false)
		expect(isMatchingConnectSecret(['wrong', 'sign_event'], SECRET)).toBe(false)
	})

	test('REGRESSION (review 5260467763 Required 1): accepts the SPEC positional array [<remote-signer-pubkey>, <secret>, …]', () => {
		// nips/46.md: connect → [<remote-signer-pubkey>, <optional_secret>,
		// <optional_requested_perms>, <optional_client_metadata>], i.e. the
		// secret is at index 1. Reading index 0 returned the signer's PUBKEY,
		// so a spec-conformant sender was never admitted by the array branch.
		expect(isMatchingConnectSecret([REMOTE_PK, SECRET], SECRET)).toBe(true)
		expect(extractConnectSecret([REMOTE_PK, SECRET])).toBe(SECRET)
		expect(isMatchingConnectSecret([REMOTE_PK, SECRET, 'sign_event'], SECRET)).toBe(true)
		expect(isMatchingConnectSecret([REMOTE_PK, SECRET, 'sign_event', '{"name":"x"}'], SECRET)).toBe(true)

		// A wrong secret at BOTH positions is still rejected — the union widens
		// which position may carry the secret, never whether the secret must match.
		expect(isMatchingConnectSecret([REMOTE_PK, 'other-secret'], SECRET)).toBe(false)
		expect(isMatchingConnectSecret([REMOTE_PK, ''], SECRET)).toBe(false)
		expect(isMatchingConnectSecret(['other-secret'], SECRET)).toBe(false)
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
		// Array form: the secret is at the SPEC position (index 1) when the array
		// has one; index 0 is the app's own `[<secret>]` shorthand.
		expect(extractConnectSecret([REMOTE_PK, SECRET])).toBe(SECRET)
		expect(extractConnectSecret([SECRET])).toBe(SECRET)
		expect(extractConnectSecret({ secret: SECRET })).toBe(SECRET)
		expect(extractConnectSecret({ token: SECRET })).toBeUndefined()
		expect(extractConnectSecret([123])).toBeUndefined()
		expect(extractConnectSecret([''])).toBeUndefined()
		expect(extractConnectSecret(undefined)).toBeUndefined()
	})
})

describe('isApprovedNostrConnectResponse (QR signer-approval gate, #1290 + review 5260467763)', () => {
	const APPROVED = 'aa'.repeat(32)
	const UNAPPROVED = 'bb'.repeat(32)
	const approvedSignerPubkeys = new Set([APPROVED])

	test('REGRESSION (review 5260467763 Required 2): a connect RESPONSE echoing the secret self-approves', () => {
		// nips/46.md:67 (client-initiated flow): "…which then sends `connect`
		// *response* event to the `client-pubkey` … `secret` value MUST be
		// provided to avoid connection spoofing, client MUST validate the
		// `secret` returned by `connect` response." That response carries NO
		// `method`, so it can never reach the branch that populates the approved
		// set — requiring membership there dropped the spec-conformant signer
		// and left the lane to the 5-minute timeout. The secret IS the factor,
		// and its author is the discovered remote-signer pubkey.
		expect(isApprovedNostrConnectResponse(SECRET, SECRET, UNAPPROVED, new Set())).toBe(true)
		expect(isApprovedNostrConnectResponse(SECRET, SECRET, UNAPPROVED, approvedSignerPubkeys)).toBe(true)
		expect(isApprovedNostrConnectResponse(SECRET, SECRET, APPROVED, new Set())).toBe(true)
	})

	test('the bare `ack` still requires a signer that already echoed the secret', () => {
		// Unchanged by the above: without prior proof of the secret, an `ack`
		// from any relay peer that can encrypt to the (public) client pubkey
		// must never bind the session to its own bunker endpoint.
		expect(isApprovedNostrConnectResponse('ack', SECRET, UNAPPROVED, approvedSignerPubkeys)).toBe(false)
		expect(isApprovedNostrConnectResponse('ack', SECRET, APPROVED, new Set())).toBe(false)
		// …and it still binds when that signer did echo the secret.
		expect(isApprovedNostrConnectResponse('ack', SECRET, APPROVED, approvedSignerPubkeys)).toBe(true)
	})

	test('rejects any other result, whatever the author or the approved set', () => {
		expect(isApprovedNostrConnectResponse('not-the-secret', SECRET, APPROVED, approvedSignerPubkeys)).toBe(false)
		expect(isApprovedNostrConnectResponse('not-the-secret', SECRET, UNAPPROVED, new Set())).toBe(false)
		expect(isApprovedNostrConnectResponse(undefined, SECRET, APPROVED, approvedSignerPubkeys)).toBe(false)
		expect(isApprovedNostrConnectResponse(null, SECRET, UNAPPROVED, new Set())).toBe(false)
		expect(isApprovedNostrConnectResponse({ result: SECRET }, SECRET, UNAPPROVED, new Set())).toBe(false)
	})

	test('fails closed when there is no expected secret to validate against', () => {
		// An empty expected secret must admit nothing — not even an empty result
		// from an approved signer (which the previous form accepted).
		expect(isApprovedNostrConnectResponse('', '', APPROVED, approvedSignerPubkeys)).toBe(false)
		expect(isApprovedNostrConnectResponse('ack', '', APPROVED, approvedSignerPubkeys)).toBe(false)
		expect(isApprovedNostrConnectResponse(SECRET, '', APPROVED, approvedSignerPubkeys)).toBe(false)
	})
})
