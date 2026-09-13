/**
 * NIP-46 bunker lane → applesauce `NostrConnectSigner` behind the signer
 * capability seam (ADR-0008 Wave A3b / task B-2).
 *
 * The library provides NONE of the ADR-0008 NIP-46 invariants — they live here
 * as app-side wrappers (see `signers-api-audit.md` gaps, quoted inline):
 *
 *  - **Strict binding (gap 6):** the library binds an unknown remote on a bare
 *    `"ack"` OR a secret echo (`result === "ack" || result === connectSecret`).
 *    The wrapper gates the client-initiated handshake so a bare `ack` is
 *    dropped and only a validated connect-secret echo binds.
 *  - **Pubkey separation (ADR invariant 2, verbatim):** the remote-signer
 *    pubkey stays distinct from the authenticated user pubkey; identity
 *    resolution uses only `getPublicKey()` (never `clientPubkey`, never the raw
 *    `remote` field unvalidated).
 *  - **RPC timeout (gap 1):** `makeRequest` pends forever on a silent remote;
 *    every RPC goes through a `Promise.race` timeout that rejects with a
 *    lane-specific error so NIP-46 users see a re-login prompt, not a hang.
 *  - **authUrl (gap 2):** NDK's `signer.on('authUrl')` maps to the signer's
 *    `onAuth` constructor callback.
 *  - **Signed-event identity (ADR invariant 3):** the capability asserts
 *    `event.pubkey === authenticatedUserPubkey` after the library's in-signer
 *    verification, because in-signer verification alone does not prove WHICH
 *    key signed.
 */
import { NostrConnectSigner, PrivateKeySigner } from 'applesauce-signers'
import type { NostrPool } from 'applesauce-signers'
import { RelayPool } from 'applesauce-relay'
import { from, filter, mergeMap } from 'rxjs'
import { bytesToHex } from 'nostr-tools/utils'
import type { EventTemplate, NostrEvent } from 'nostr-tools/pure'

import type { NipEncryptionCapability, SignerCapability } from './signer-capability'

/** Default deadline for a NIP-46 RPC (connect / sign / encrypt / decrypt). */
export const NIP46_RPC_TIMEOUT_MS = 30_000

/** NIP-46 permissions the app requests at connect (get_public_key + sign + nip crypto). */
export const NIP46_PERMISSIONS = ['get_public_key', 'sign_event', 'nip04_encrypt', 'nip04_decrypt', 'nip44_encrypt', 'nip44_decrypt']

/** Error raised when a NIP-46 RPC exceeds its deadline — drives a re-login prompt. */
export class Nip46RpcTimeoutError extends Error {
	constructor(lane: string, timeoutMs: number) {
		super(`NIP-46 ${lane} request timed out after ${timeoutMs}ms — reconnect your signer and try again`)
		this.name = 'Nip46RpcTimeoutError'
	}
}

/**
 * Bound an RPC with a deadline (gap 1). Rejects with a lane-specific
 * {@link Nip46RpcTimeoutError} when the operation does not settle in time;
 * otherwise resolves/rejects with the operation's own outcome. An underlying
 * rejection is never swallowed.
 */
export function withRpcTimeout<T>(lane: string, operation: Promise<T>, timeoutMs: number = NIP46_RPC_TIMEOUT_MS): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Nip46RpcTimeoutError(lane, timeoutMs)), timeoutMs)
		operation.then(
			(value) => {
				clearTimeout(timer)
				resolve(value)
			},
			(error) => {
				clearTimeout(timer)
				reject(error)
			},
		)
	})
}

/**
 * Structural surface of a `NostrConnectSigner` the capability wrapper consumes.
 * (Structural — mirroring the A3-4fix bridge — so structural test mocks pass
 * `tsc` without importing the concrete class into test files.)
 */
export type NostrConnectSignerLike = {
	getPublicKey(): Promise<string>
	signEvent(template: EventTemplate & { pubkey?: string }): Promise<NostrEvent>
	nip04?: NipEncryptionCapability
	nip44?: NipEncryptionCapability
}

/** A lazy, shared applesauce `RelayPool` behind `src/lib/nostr/io.ts`'s seam semantics. */
let relayPool: RelayPool | null = null

function getRelayPool(): RelayPool {
	if (!relayPool) relayPool = new RelayPool()
	return relayPool
}

/** Map the applesauce `RelayPool` to the signer's `NostrPool` transport shape. */
function defaultPool(): NostrPool {
	const pool = getRelayPool()
	return {
		subscription: (relays, filters) => pool.subscription(relays, filters),
		publish: (relays, event) => pool.publish(relays, event),
	}
}

/**
 * Classify an inbound kind-24133 event during the unbound phase: is it a bare
 * `"ack"` (no id, no method) that the lax library bind would accept? Only a
 * top-level `{ result: "ack" }` with NO request id is a bare ack — an RPC
 * `connect` response (`{ id, result: "ack" }`) is a different, legitimate path.
 */
async function isBareAckResponse(clientSigner: PrivateKeySigner, event: NostrEvent): Promise<boolean> {
	const content = event.content
	let plaintext: string | null = null
	if (content.includes('?iv=')) {
		try {
			plaintext = await clientSigner.nip04.decrypt(event.pubkey, content)
		} catch {
			plaintext = null
		}
	} else {
		try {
			plaintext = await clientSigner.nip44.decrypt(event.pubkey, content)
		} catch {
			try {
				plaintext = await clientSigner.nip04.decrypt(event.pubkey, content)
			} catch {
				plaintext = null
			}
		}
	}
	if (plaintext == null) return false
	try {
		const parsed = JSON.parse(plaintext)
		return parsed && parsed.result === 'ack' && parsed.id === undefined && parsed.method === undefined
	} catch {
		return false
	}
}

/**
 * Wrap a pool's subscription so a bare `"ack"` from an unknown remote never
 * reaches the library's lax bind (gap 6). Every inbound event is decrypted and
 * inspected; a bare ack is dropped, everything else (secret echo, RPC responses)
 * passes through.
 */
function strictBindPool(clientSigner: PrivateKeySigner, pool: NostrPool): NostrPool {
	return {
		publish: pool.publish,
		subscription: (relays, filters) =>
			from(pool.subscription(relays, filters)).pipe(
				mergeMap(async (item) => {
					if (typeof item === 'string') return item
					if (await isBareAckResponse(clientSigner, item as NostrEvent)) return null
					return item
				}),
				filter((item): item is NostrEvent | string => item != null),
			),
	}
}

export interface NostrConnectClientOptions {
	relays: string[]
	/** Local client private key (hex). Auto-generated when omitted. */
	clientKeyHex?: string
	/** Remote signer pubkey (bunker flow). */
	remote?: string
	/** Client-initiated secret (nostrconnect:// flow). */
	connectSecret?: string
	/** Bunker authorization secret (bunker:// flow). */
	bunkerSecret?: string
	/** Maps NDK `signer.on('authUrl')` → `onAuth` (gap 2). */
	onAuth?: (url: string) => Promise<void>
	/** Injected transport (tests). Defaults to the shared applesauce relay pool. */
	pool?: NostrPool
}

/** Build a `NostrConnectSigner` whose transport is gated by the strict-bind wrapper. */
export function createNostrConnectClient(options: NostrConnectClientOptions): NostrConnectSigner {
	const clientSigner = options.clientKeyHex ? PrivateKeySigner.fromKey(options.clientKeyHex) : new PrivateKeySigner()
	const pool = strictBindPool(clientSigner, options.pool ?? defaultPool())
	return new NostrConnectSigner({
		relays: options.relays,
		remote: options.remote,
		signer: clientSigner,
		connectSecret: options.connectSecret,
		bunkerSecret: options.bunkerSecret,
		onAuth: options.onAuth,
		pool,
	})
}

export interface BunkerConnectOptions {
	/** Local client private key (hex). Auto-generated when omitted. */
	clientKeyHex?: string
	onAuth?: (url: string) => Promise<void>
	pool?: NostrPool
	rpcTimeoutMs?: number
	permissions?: string[]
}

export interface NostrConnectBundle {
	signer: NostrConnectSigner
	capability: SignerCapability
	/** The local client private key (hex) — what auth.ts persists at rest. */
	clientKeyHex: string
}

/**
 * Connect to a `bunker://` URI behind the strict-bind transport + RPC timeout.
 * Returns the live signer, its capability wrapper, and the client key hex.
 */
export async function connectBunkerSigner(bunkerUrl: string, options: BunkerConnectOptions = {}): Promise<NostrConnectBundle> {
	const { remote, relays, bunkerSecret } = NostrConnectSigner.parseBunkerURI(bunkerUrl)
	const clientSigner = options.clientKeyHex ? PrivateKeySigner.fromKey(options.clientKeyHex) : new PrivateKeySigner()
	const signer = new NostrConnectSigner({
		relays,
		remote,
		signer: clientSigner,
		bunkerSecret,
		onAuth: options.onAuth,
		pool: strictBindPool(clientSigner, options.pool ?? defaultPool()),
	})
	const timeoutMs = options.rpcTimeoutMs ?? NIP46_RPC_TIMEOUT_MS
	await withRpcTimeout('connect', signer.connect(bunkerSecret, options.permissions ?? NIP46_PERMISSIONS), timeoutMs)
	return {
		signer,
		capability: createNostrConnectCapability(signer, timeoutMs),
		clientKeyHex: bytesToHex(clientSigner.key),
	}
}

/**
 * Wrap a `NostrConnectSigner` in the {@link SignerCapability} seam, enforcing
 * the ADR invariants the library does not: RPC timeouts, authUrl → onAuth
 * (constructor-side), and the signed-event pubkey-equality assertion. Pubkey
 * separation is inherent — identity resolves ONLY through `getPublicKey()`.
 */
export function createNostrConnectCapability(
	signer: NostrConnectSignerLike,
	rpcTimeoutMs: number = NIP46_RPC_TIMEOUT_MS,
): SignerCapability {
	// Cache the authenticated user pubkey so the signed-event identity assert
	// (ADR-0008 invariant 3) does not issue a fresh `get_public_key` RPC on
	// every sign. The cache is scoped to THIS capability instance: each
	// `connectBunkerSigner` call builds a fresh capability, so a close/reconnect
	// (which tears the signer down on logout) inherently invalidates it.
	let cachedPubkey: string | undefined
	const resolvePubkey = (): Promise<string> => {
		if (cachedPubkey !== undefined) return Promise.resolve(cachedPubkey)
		return withRpcTimeout('get_public_key', signer.getPublicKey(), rpcTimeoutMs).then((pubkey) => {
			cachedPubkey = pubkey
			return pubkey
		})
	}
	return {
		getPublicKey: () => resolvePubkey(),
		signEvent: async (template) => {
			const signed = await withRpcTimeout('sign_event', signer.signEvent(template as EventTemplate & { pubkey?: string }), rpcTimeoutMs)
			// ADR-0008 invariant 3: in-signer verification does not prove WHICH key
			// signed. Assert the returned event's pubkey equals the authenticated
			// user pubkey; a valid signature from the wrong key fails closed.
			const userPubkey = await resolvePubkey()
			if (signed.pubkey !== userPubkey) {
				throw new Error('Signer returned an event for a different pubkey than the authenticated user')
			}
			return signed
		},
		nip04: signer.nip04 ? wrapEncryption(signer.nip04, 'nip04', rpcTimeoutMs) : undefined,
		nip44: signer.nip44 ? wrapEncryption(signer.nip44, 'nip44', rpcTimeoutMs) : undefined,
	}
}

function wrapEncryption(cap: NipEncryptionCapability, scheme: 'nip04' | 'nip44', timeoutMs: number): NipEncryptionCapability {
	return {
		encrypt: (pubkey, plaintext) => withRpcTimeout(`${scheme}_encrypt`, cap.encrypt(pubkey, plaintext), timeoutMs),
		decrypt: (pubkey, ciphertext) => withRpcTimeout(`${scheme}_decrypt`, cap.decrypt(pubkey, ciphertext), timeoutMs),
	}
}
