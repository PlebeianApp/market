/**
 * The test harness.
 *
 * This file is **test support, not module code** — it is the *host* side of
 * every port: a WebCrypto implementation of {@link CryptoPort}, an in-memory
 * {@link StoragePort}, a manual {@link ClockPort}, and a relay transport whose
 * "remote" is a NIP-46 bunker emulator running in this process. Nothing here is
 * exported from the contract, and no module file imports it.
 *
 * The fact that this file can implement every port without touching the module
 * is the point: the module reads no global, opens no socket and holds no timer.
 */
import { finalizeEvent, getPublicKey, nip44 } from 'nostr-tools'
import { encodeNbunksec } from 'applesauce-signers/helpers'
import { hexToBytes } from 'nostr-tools/utils'
import type { EventTemplate, NostrEvent } from 'nostr-tools/pure'
import { Observable, ReplaySubject } from 'rxjs'

import type { ClockPort, CryptoPort, SignedEvent, StoragePort, TransportPort } from './types'

/** A view's bytes as an ArrayBuffer, which is what the WebCrypto calls take. */
function bytes(view: Uint8Array): ArrayBuffer {
	return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer
}

// -- keys -------------------------------------------------------------------

export const CLIENT_SK = '11'.repeat(32)
export const REMOTE_SK = '22'.repeat(32)
export const USER_SK = '33'.repeat(32)
export const WRONG_SK = '44'.repeat(32)

export const CLIENT_PK = getPublicKey(hexToBytes(CLIENT_SK))
export const REMOTE_PK = getPublicKey(hexToBytes(REMOTE_SK))
export const USER_PK = getPublicKey(hexToBytes(USER_SK))
export const WRONG_PK = getPublicKey(hexToBytes(WRONG_SK))

export const CONNECT_SECRET = 'connectsecret123'
export const BUNKER_SECRET = 'bunkersecret'
export const RELAY = 'wss://signer.example.com'
export const CREATED_AT = 1_700_000_000

export function userTemplate(content = 'hello'): EventTemplate {
	return { kind: 1, content, tags: [], created_at: CREATED_AT }
}

// -- ports ------------------------------------------------------------------

/** The storage port: a Map, standing in for whatever the host really has. */
export function memoryStorage(): StoragePort & { readonly map: Map<string, string> } {
	const map = new Map<string, string>()
	return {
		map,
		getItem: (key) => map.get(key) ?? null,
		setItem: (key, value) => {
			map.set(key, value)
		},
		removeItem: (key) => {
			map.delete(key)
		},
	}
}

/**
 * A manual clock: nothing fires until the test advances it, so a deadline is
 * observable instead of being a race against the wall clock.
 */
export function manualClock(): ClockPort & { advance(): void; pending(): number } {
	let nextHandle = 1
	const timers = new Map<number, () => void>()
	return {
		setTimeout(handler) {
			const handle = nextHandle++
			timers.set(handle, handler)
			return handle
		},
		clearTimeout(handle) {
			timers.delete(handle as number)
		},
		advance() {
			const due = [...timers.values()]
			timers.clear()
			for (const handler of due) handler()
		},
		pending() {
			return timers.size
		},
	}
}

/** The crypto port: the host's WebCrypto, behind the module's primitives. */
export const webCryptoPort: CryptoPort = {
	randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
	async pbkdf2Sha256(passphrase, salt, iterations) {
		const material = await crypto.subtle.importKey('raw', bytes(new TextEncoder().encode(passphrase)), 'PBKDF2', false, ['deriveKey'])
		return await crypto.subtle.deriveKey(
			{ name: 'PBKDF2', hash: 'SHA-256', salt: bytes(salt), iterations },
			material,
			{ name: 'AES-GCM', length: 256 },
			false,
			['encrypt', 'decrypt'],
		)
	},
	async aesGcmEncrypt(key, iv, plaintext) {
		const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: bytes(iv) }, key as CryptoKey, bytes(plaintext))
		return new Uint8Array(ct)
	},
	async aesGcmDecrypt(key, iv, ciphertext) {
		const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(iv) }, key as CryptoKey, bytes(ciphertext))
		return new Uint8Array(pt)
	},
	utf8Encode: (text) => new TextEncoder().encode(text),
	utf8Decode: (bytes) => new TextDecoder().decode(bytes),
}

// -- the transport and the bunker it reaches ---------------------------------

/** Encrypt + sign an inbound kind-24133 event as a remote signer, addressed to a client. */
export function inboundEvent(fromSk: string, payload: unknown, toPk = CLIENT_PK): SignedEvent {
	const conversationKey = nip44.v2.utils.getConversationKey(hexToBytes(fromSk), toPk)
	const content = nip44.v2.encrypt(JSON.stringify(payload), conversationKey)
	return finalizeEvent({ kind: 24133, created_at: CREATED_AT, tags: [['p', toPk]], content }, hexToBytes(fromSk))
}

/** A transport whose subscription replays into a subject the test pushes events into. */
export function fakeTransport(): { pool: TransportPort; incoming: ReplaySubject<SignedEvent | string> } {
	const incoming = new ReplaySubject<SignedEvent | string>()
	return {
		incoming,
		pool: {
			subscription: () => incoming.asObservable(),
			publish: async () => [],
		},
	}
}

export interface BunkerEmulatorOptions {
	/** The client pubkey the emulator answers (the session's client key). */
	clientPk?: string
	/** The `secret` a `connect` request must carry, when the flow sends one. */
	expectSecret?: string
	/** The identity the emulator signs as. Defaults to USER_SK. */
	userSk?: string
}

/**
 * The transport plus a bunker emulator: `publish` decrypts the client's NIP-44
 * request, dispatches the RPC, and emits a signed response back into the
 * subscription — so a whole NIP-46 handshake runs against no network. `connect`
 * requests are answered only when they carry the expected secret (I1).
 */
export function bunkerTransport(options: BunkerEmulatorOptions = {}) {
	const clientPk = options.clientPk ?? CLIENT_PK
	const userSk = options.userSk ?? USER_SK
	const incoming = new ReplaySubject<SignedEvent | string>()
	let active = 0
	const log: string[] = []
	const pool = {
		subscription: (): Observable<SignedEvent | string> => {
			active++
			return new Observable<SignedEvent | string>((subscriber) => {
				const sub = incoming.subscribe(subscriber)
				return () => {
					sub.unsubscribe()
					active--
				}
			})
		},
		publish: async (_relays: string[], event: unknown): Promise<unknown> => {
			const conversationKey = nip44.v2.utils.getConversationKey(hexToBytes(REMOTE_SK), clientPk)
			const request = JSON.parse(nip44.v2.decrypt((event as NostrEvent).content, conversationKey)) as {
				id: string
				method: string
				params: unknown[]
			}
			log.push(request.method)
			let result: string | undefined
			let error: string | undefined
			switch (request.method) {
				case 'connect': {
					const sentSecret = request.params[1]
					if (options.expectSecret !== undefined && sentSecret !== options.expectSecret) {
						error = 'unauthorized: wrong connect secret'
					} else {
						result = 'ack'
					}
					break
				}
				case 'get_public_key':
					result = getPublicKey(hexToBytes(userSk))
					break
				case 'sign_event': {
					const template = (typeof request.params[0] === 'string' ? JSON.parse(request.params[0]) : request.params[0]) as EventTemplate
					result = JSON.stringify(finalizeEvent(template, hexToBytes(userSk)))
					break
				}
				default:
					result = 'ack'
			}
			incoming.next(inboundEvent(REMOTE_SK, { id: request.id, result, error }, clientPk))
			return []
		},
	}
	return { pool: pool as TransportPort, incoming, active: () => active, log }
}

/** The bunker URI the `bunker://` lane is driven with. */
export function bunkerUrl(secret = BUNKER_SECRET): string {
	return `bunker://${REMOTE_PK}?relay=${RELAY}&secret=${secret}`
}

/** A real nbunksec session token (client key + remote + relays + secret). */
export function makeNbunksec(clientSk = CLIENT_SK, secret = BUNKER_SECRET): string {
	return encodeNbunksec({
		pubkey: REMOTE_PK,
		local_key: clientSk,
		relays: [RELAY],
		secret,
	})
}

/** Let asynchronous pipelines settle. */
export function settle(ms = 5): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}
