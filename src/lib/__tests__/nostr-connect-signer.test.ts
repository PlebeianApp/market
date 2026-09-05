/**
 * NIP-46 → applesauce `NostrConnectSigner` invariant-wrapper tests (ADR-0008 B-2).
 *
 * The library provides NONE of the ADR invariants (signers-api-audit.md gaps),
 * so they live in app-side wrappers under `src/lib/nostr/nostr-connect-signer.ts`:
 *  - strict binding (gap 6): a bare `ack` must NEVER bind an unknown remote;
 *    only a validated connect-secret echo (`result === connectSecret`) binds.
 *  - pubkey separation (ADR invariant 2): identity resolves via `getPublicKey()`
 *    ONLY — never `clientPubkey`, never the raw `remote` field.
 *  - RPC timeout (gap 1): silent remotes reject with a lane-specific error
 *    (re-login prompt, not a hang).
 *  - signed-event identity (ADR invariant 3): a returned event whose `pubkey`
 *    differs from the authenticated user pubkey fails closed.
 *
 * The strict-bind harness drives a REAL `NostrConnectSigner` through a fake
 * rxjs-transport (Subject), so no network is touched. Encryption uses the
 * repo's nostr-tools NIP-44 v2 (format-compatible with the library's nested
 * copy), and signatures are honest (`finalizeEvent`).
 */
import { describe, expect, mock, test } from 'bun:test'
import { ReplaySubject, Observable } from 'rxjs'
import { finalizeEvent, getPublicKey, nip44 } from 'nostr-tools'
import { hexToBytes } from 'nostr-tools/utils'
import type { EventTemplate, NostrEvent } from 'nostr-tools/pure'

import {
	connectBunkerSigner,
	createNostrConnectCapability,
	createNostrConnectClient,
	withRpcTimeout,
} from '@/lib/nostr/nostr-connect-signer'
import { runSignerTeardown, setSignerTeardown } from '@/lib/nostr/signer-registry'
import type { SignerCapability } from '@/lib/nostr/signer-capability'

const CLIENT_SK = '11'.repeat(32)
const REMOTE_SK = '22'.repeat(32)
const USER_SK = '33'.repeat(32)
const WRONG_SK = '44'.repeat(32)

const clientPk = getPublicKey(hexToBytes(CLIENT_SK))
const remotePk = getPublicKey(hexToBytes(REMOTE_SK))
const userPk = getPublicKey(hexToBytes(USER_SK))

const CONNECT_SECRET = 'connectsecret123'

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

/** A transport whose subscription is a replaying Subject the test pushes events into. */
function fakeTransport() {
	const incoming = new ReplaySubject<NostrEvent | string>()
	const pool = {
		subscription: (_relays: string[], _filters: unknown[]): Observable<NostrEvent | string> => incoming.asObservable(),
		publish: (_relays: string[], _event: unknown): Promise<unknown> => Promise.resolve([]),
	}
	return { pool, incoming }
}

/** Let the rxjs pipeline + async decrypt settle. */
async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 5))
}

describe('nostr-connect strict binding (ADR-0008 gap 6, invariant 1)', () => {
	test('a bare "ack" never binds an unknown remote signer', async () => {
		const { pool, incoming } = fakeTransport()
		const client = createNostrConnectClient({
			relays: ['wss://signer.example.com'],
			clientKeyHex: CLIENT_SK,
			connectSecret: CONNECT_SECRET,
			pool,
		})

		const waiting = client.waitForSigner()

		incoming.next(inboundEvent(REMOTE_SK, { result: 'ack' }))
		await settle()

		// The lax library bind (result === "ack") must have been gated by the
		// strict-bind wrapper: an unknown remote on a bare ack is NOT bound.
		expect(client.remote).toBeUndefined()
		expect(client.isConnected).toBe(false)

		client.close()
		await waiting.catch(() => {})
	})

	test('a validated connect-secret echo binds the remote signer', async () => {
		const { pool, incoming } = fakeTransport()
		const client = createNostrConnectClient({
			relays: ['wss://signer.example.com'],
			clientKeyHex: CLIENT_SK,
			connectSecret: CONNECT_SECRET,
			pool,
		})

		const waiting = client.waitForSigner()

		incoming.next(inboundEvent(REMOTE_SK, { result: CONNECT_SECRET }))
		await waiting

		expect(client.remote).toBe(remotePk)
		expect(client.isConnected).toBe(true)

		client.close()
	})

	test('a wrong connect secret never binds the remote signer', async () => {
		const { pool, incoming } = fakeTransport()
		const client = createNostrConnectClient({
			relays: ['wss://signer.example.com'],
			clientKeyHex: CLIENT_SK,
			connectSecret: CONNECT_SECRET,
			pool,
		})

		const waiting = client.waitForSigner()

		incoming.next(inboundEvent(REMOTE_SK, { result: 'wrong-secret' }))
		await settle()

		expect(client.remote).toBeUndefined()
		expect(client.isConnected).toBe(false)

		client.close()
		await waiting.catch(() => {})
	})

	test('identity resolution is via getPublicKey() only — never clientPubkey (ADR invariant 2)', () => {
		// The clientPubkey and the user pubkey are inherently distinct fields on
		// the signer. The capability must expose ONLY the user identity; this
		// guards that no consumer reaches for clientPubkey/remote as identity.
		const { pool } = fakeTransport()
		const client = createNostrConnectClient({
			relays: ['wss://signer.example.com'],
			clientKeyHex: CLIENT_SK,
			connectSecret: CONNECT_SECRET,
			pool,
		})

		// clientPubkey derives from the client's OWN key — never the user.
		expect(client.clientPubkey).toBe(clientPk)
		expect(client.clientPubkey).not.toBe(userPk)
		expect(client.clientPubkey).not.toBe(remotePk)
	})
})

describe('nostr-connect capability wrappers', () => {
	test('signEvent fails closed when the returned event pubkey differs from the authenticated user (invariant 3)', async () => {
		// A structurally-valid signature from the WRONG user key is rejected.
		const template = { kind: 1, content: 'hello', tags: [], created_at: 1_700_000_000 }

		const wrongKeySigner = {
			getPublicKey: async () => userPk,
			signEvent: async (t: EventTemplate) => finalizeEvent(t, hexToBytes(WRONG_SK)) as unknown as NostrEvent,
			nip04: undefined,
			nip44: undefined,
		}

		const capability = createNostrConnectCapability(wrongKeySigner as never)

		await expect(capability.signEvent(template)).rejects.toThrow(/different pubkey/)
	})

	test('signEvent returns the signed event when the pubkey matches (happy path)', async () => {
		const template = { kind: 1, content: 'hello', tags: [], created_at: 1_700_000_000 }

		const honestSigner = {
			getPublicKey: async () => userPk,
			signEvent: async (t: EventTemplate) => finalizeEvent(t, hexToBytes(USER_SK)) as unknown as NostrEvent,
			nip04: undefined,
			nip44: undefined,
		}

		const capability = createNostrConnectCapability(honestSigner as never)

		const signed = await capability.signEvent(template)
		expect(signed.pubkey).toBe(userPk)
	})

	test('exposes nip04/nip44 delegating envelopes when the signer provides them', () => {
		const delegating = {
			getPublicKey: async () => userPk,
			signEvent: async () => ({}) as NostrEvent,
			nip04: { encrypt: async () => 'c4', decrypt: async () => 'p4' },
			nip44: { encrypt: async () => 'c44', decrypt: async () => 'p44' },
		}

		const capability = createNostrConnectCapability(delegating as never)
		expect(capability.nip04).toBeDefined()
		expect(capability.nip44).toBeDefined()
	})

	test('getPublicKey resolves the user identity, not the client key', async () => {
		const delegating = {
			getPublicKey: async () => userPk,
			signEvent: async () => ({}) as NostrEvent,
			nip04: undefined,
			nip44: undefined,
		}

		const capability: SignerCapability = createNostrConnectCapability(delegating as never)
		expect(await capability.getPublicKey()).toBe(userPk)
		expect(await capability.getPublicKey()).not.toBe(clientPk)
	})
})

describe('nostr-connect RPC timeout wrapper (gap 1)', () => {
	test('a silent remote rejects with a lane-specific error instead of hanging forever', async () => {
		await expect(withRpcTimeout('sign_event', new Promise<never>(() => {}), 10)).rejects.toThrow(/NIP-46 sign_event .* timed out/)
	})

	test('resolves the operation result when it settles before the timeout', async () => {
		await expect(withRpcTimeout('connect', Promise.resolve('ack'), 10_000)).resolves.toBe('ack')
	})

	test('does not swallow an underlying rejection', async () => {
		await expect(withRpcTimeout('connect', Promise.reject(new Error('bunker refused')), 10_000)).rejects.toThrow('bunker refused')
	})
})

describe('nostr-connect signer session teardown (B-2fix item 1)', () => {
	test('runSignerTeardown invokes the registered teardown once and clears it (idempotent)', async () => {
		const teardown = mock(async () => {})
		setSignerTeardown(teardown)

		await runSignerTeardown()
		expect(teardown).toHaveBeenCalledTimes(1)

		// A second run is a no-op — the teardown was cleared before it ran, so
		// calling this from every detach chokepoint (logout AND removeSigner)
		// tears the signer down exactly once.
		await runSignerTeardown()
		expect(teardown).toHaveBeenCalledTimes(1)
	})

	/**
	 * A fake `NostrPool` whose `subscription` counts ACTIVE subscriptions (a live
	 * one increments until the rxjs subscription is unsubscribed). A bunker
	 * emulator responds to the client's published RPC requests so the full
	 * `connectBunkerSigner` handshake completes against no network.
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
				// Emulate the bunker: decrypt the client's nip44 request, dispatch the
				// RPC, and emit a signed response back into the subscription.
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

	test('login-logout-login closes the REQ subscription so it does not stack (B-2fix item 1)', async () => {
		const bunkerUrl = `bunker://${remotePk}?relay=wss://signer.example.com&secret=bunkersecret`

		// Login 1 — the production seam (connectBunkerSigner), mirroring loginWithNip46.
		const t1 = countingBunkerTransport()
		const bundle1 = await connectBunkerSigner(bunkerUrl, { clientKeyHex: CLIENT_SK, pool: t1.pool, rpcTimeoutMs: 1000 })
		expect(t1.active()).toBe(1)

		// Register the teardown exactly as loginWithNip46 does, then log out.
		setSignerTeardown(() => bundle1.signer.logout())
		await runSignerTeardown()
		expect(t1.active()).toBe(0)

		// Login 2 — a fresh signer must NOT stack on top of a leaked subscription.
		const t2 = countingBunkerTransport()
		const bundle2 = await connectBunkerSigner(bunkerUrl, { clientKeyHex: CLIENT_SK, pool: t2.pool, rpcTimeoutMs: 1000 })
		expect(t2.active()).toBe(1)
		// Close the second signer so the test leaves no dangling subscription.
		setSignerTeardown(() => bundle2.signer.logout())
		await runSignerTeardown()
		expect(t2.active()).toBe(0)
	})
})

describe('nostr-connect capability pubkey cache (B-2fix item 3)', () => {
	test('signEvent reuses the cached authenticated pubkey — one get_public_key RPC total', async () => {
		let getPublicKeyCalls = 0
		const delegated = {
			getPublicKey: async () => {
				getPublicKeyCalls++
				return userPk
			},
			signEvent: async (t: EventTemplate) => finalizeEvent(t, hexToBytes(USER_SK)) as unknown as NostrEvent,
			nip04: undefined,
			nip44: undefined,
		}
		const capability = createNostrConnectCapability(delegated as never)

		await capability.getPublicKey()
		await capability.getPublicKey()
		await capability.signEvent({ kind: 1, content: 'a', tags: [], created_at: 1 })
		await capability.signEvent({ kind: 1, content: 'b', tags: [], created_at: 2 })

		// Before the cache, each sign issued a fresh get_public_key RPC only for
		// the equality assert — now it is issued once and reused.
		expect(getPublicKeyCalls).toBe(1)
	})
})
