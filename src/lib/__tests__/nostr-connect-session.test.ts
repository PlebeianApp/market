/**
 * NIP-46 session rehydration tests (ADR-0002 B-3) — NON-MOCKED seam.
 *
 * These drive the REAL `rehydrateNostrConnectSession` → `NostrConnectSigner`
 * path through an injected rxjs transport (Subject), so no network is touched.
 * They exist because the auth-store tests mock `nostr-connect-session` (see
 * auth-session-vault.test.ts) and the P1 regression (unwired transport on
 * restore) was invisible to the green suite. The transport harness mirrors the
 * `countingBunkerTransport` in nostr-connect-signer.test.ts.
 */
import { describe, expect, mock, test } from 'bun:test'
import { ReplaySubject, Observable } from 'rxjs'
import { finalizeEvent, getPublicKey, nip44 } from 'nostr-tools'
import { hexToBytes } from 'nostr-tools/utils'
import type { EventTemplate, NostrEvent } from 'nostr-tools/pure'
import { encodeNbunksec } from 'applesauce-signers/helpers'

const CLIENT_SK = '11'.repeat(32)
const REMOTE_SK = '22'.repeat(32)
const USER_SK = '33'.repeat(32)

const clientPk = getPublicKey(hexToBytes(CLIENT_SK))
const remotePk = getPublicKey(hexToBytes(REMOTE_SK))
const userPk = getPublicKey(hexToBytes(USER_SK))

const BUNKER_SECRET = 'bunkersecret'

/** Encrypt + sign an inbound kind-24133 event as the remote signer, addressed to the client. */
function inboundEvent(fromSk: string, payload: unknown): NostrEvent {
	const conversationKey = nip44.v2.utils.getConversationKey(hexToBytes(fromSk), clientPk)
	const content = nip44.v2.encrypt(JSON.stringify(payload), conversationKey)
	return finalizeEvent(
		{
			kind: 24133,
			created_at: 1_700_000_000,
			tags: [['p', clientPk]],
			content,
		},
		hexToBytes(fromSk),
	)
}

/**
 * A fake `NostrPool` whose `publish` emulates the bunker: it decrypts the
 * client's nip44 request, dispatches the RPC, and emits a signed response back
 * into the subscription. `subscription` returns a live Observable over a
 * ReplaySubject so the signer's `open()` REQ receives the responses.
 */
function countingBunkerTransport() {
	const incoming = new ReplaySubject<NostrEvent | string>()
	let active = 0
	const pool = {
		subscription: (_relays: string[], _filters: unknown[]): Observable<NostrEvent | string> => {
			active++
			return new Observable<NostrEvent | string>((subscriber) => {
				const sub = incoming.subscribe(subscriber)
				return () => {
					sub.unsubscribe()
					active--
				}
			})
		},
		publish: async (_relays: string[], event: unknown): Promise<unknown> => {
			const conversationKey = nip44.v2.utils.getConversationKey(hexToBytes(REMOTE_SK), clientPk)
			const req = JSON.parse(nip44.v2.decrypt((event as NostrEvent).content, conversationKey))
			let result: string
			if (req.method === 'get_public_key') {
				result = userPk
			} else if (req.method === 'sign_event') {
				const template = typeof req.params[0] === 'string' ? JSON.parse(req.params[0]) : req.params[0]
				result = JSON.stringify(finalizeEvent(template as EventTemplate, hexToBytes(USER_SK)))
			} else {
				result = 'ack' // connect / logout / ping
			}
			incoming.next(inboundEvent(REMOTE_SK, { id: req.id, result }))
			return []
		},
	}
	return { pool, active: () => active }
}

/**
 * P1 regression: with NO injected pool, `rehydrateNostrConnectSession` must
 * fall back to the shared io-seam transport (`defaultPool()` → `getPool()` from
 * io-applesauce.ts). Before the fix it forwarded `pool: undefined` and the
 * `NostrConnectSigner` constructor threw "Missing subscriptionMethod", so the
 * vault-unlock and legacy-migration paths were dead in production.
 *
 * The io seam's `getPool()` returns a real network `RelayPool`; we mock ONLY
 * that factory so the default path is exercised hermetically. `getPool` is a
 * stable indirection so each test can install a fresh transport.
 */
let defaultTransport = countingBunkerTransport()
mock.module('@/lib/nostr/io-applesauce', () => ({
	getPool: () => defaultTransport.pool,
}))

import { rehydrateNostrConnectSession } from '@/lib/nostr/nostr-connect-session'

/** Build a real nbunksec session string (client key + remote + relays + secret). */
function makeNbunksec(): string {
	return encodeNbunksec({
		pubkey: remotePk,
		local_key: CLIENT_SK,
		relays: ['wss://signer.example.com'],
		secret: BUNKER_SECRET,
	})
}

describe('nostr-connect session rehydration (real seam, ADR-0002 B-3)', () => {
	test('injected transport: rehydrateNostrConnectSession resolves and getPublicKey returns the user pubkey', async () => {
		const { pool } = countingBunkerTransport()
		const nbunksec = makeNbunksec()

		const bundle = await rehydrateNostrConnectSession(nbunksec, { pool })

		// The signer was constructed and the connect RPC completed.
		expect(bundle.signer).toBeDefined()
		expect(bundle.signer.remote).toBe(remotePk)
		expect(bundle.signer.isConnected).toBe(true)
		// Identity resolves to the authenticated user, not the client key.
		expect(await bundle.capability.getPublicKey()).toBe(userPk)
		expect(await bundle.capability.getPublicKey()).not.toBe(clientPk)

		bundle.signer.close()
	})

	test('no injected transport: rehydrate defaults to the shared io-seam pool (P1 regression)', async () => {
		defaultTransport = countingBunkerTransport()
		const bundle = await rehydrateNostrConnectSession(makeNbunksec())

		expect(bundle.signer.isConnected).toBe(true)
		expect(await bundle.capability.getPublicKey()).toBe(userPk)

		bundle.signer.close()
	})
})
