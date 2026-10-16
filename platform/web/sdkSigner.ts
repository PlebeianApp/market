import { getApplesauceRelayPool } from '@/lib/nostr/io-applesauce'
import type { EventPublishContext, Signer } from '@sdk/core'
import {
	createSignerSession,
	type CryptoPort,
	type ExtensionTransportPort,
	type NostrEvent,
	type SignerCapability,
	type SignerPorts,
	type SignerSession,
	type SignerSettings,
	type StoragePort,
} from '@sdk/core/signer'

// Prefix keeps the SDK vault away from the auth store's own key records (legacy keys share names).
const SDK_SIGNER_STORAGE_PREFIX = 'sdk-signer:'

function browserStoragePort(storage: Storage): StoragePort {
	return {
		getItem: (key) => storage.getItem(SDK_SIGNER_STORAGE_PREFIX + key),
		setItem: (key, value) => storage.setItem(SDK_SIGNER_STORAGE_PREFIX + key, value),
		removeItem: (key) => storage.removeItem(SDK_SIGNER_STORAGE_PREFIX + key),
	}
}

const asBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer

const webCryptoPort: CryptoPort = {
	randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
	pbkdf2Sha256: async (passphrase, salt, iterations) => {
		const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
		return crypto.subtle.deriveKey(
			{ name: 'PBKDF2', hash: 'SHA-256', salt: asBuffer(salt), iterations },
			material,
			{ name: 'AES-GCM', length: 256 },
			false,
			['encrypt', 'decrypt'],
		)
	},
	aesGcmEncrypt: async (key, iv, plaintext) =>
		new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: asBuffer(iv) }, key as CryptoKey, asBuffer(plaintext))),
	aesGcmDecrypt: async (key, iv, ciphertext) =>
		new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: asBuffer(iv) }, key as CryptoKey, asBuffer(ciphertext))),
	utf8Encode: (text) => new TextEncoder().encode(text),
	utf8Decode: (bytes) => new TextDecoder().decode(bytes),
}

/** Browser implementations of the signer's ports; the NIP-46 transport rides the app's shared applesauce pool. */
export function createBrowserSignerPorts(extra: Pick<SignerPorts, 'passphrase'> = {}): SignerPorts {
	const hasWindow = typeof window !== 'undefined'
	const extension = hasWindow ? (window as { nostr?: ExtensionTransportPort }).nostr : undefined
	const pool = getApplesauceRelayPool()

	return {
		storage: hasWindow ? browserStoragePort(window.localStorage) : undefined,
		clock: {
			setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
			clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
		},
		crypto: webCryptoPort,
		extension,
		transport: {
			subscription: (relays, filters) => pool.subscription(relays, filters as Parameters<typeof pool.subscription>[1]),
			publish: (relays, event) => pool.publish(relays, event),
		},
		...extra,
	}
}

/** An SDK signer session for the web host. Not yet wired to the auth store, which still owns login. */
export function createWebSignerSession(settings?: SignerSettings, ports: SignerPorts = createBrowserSignerPorts()): SignerSession {
	return createSignerSession({ settings, ports })
}

/** Lets SDK publish workflows sign with a signer-module capability. */
export function signerCapabilityAsSdkSigner(capability: SignerCapability): Signer<NostrEvent> {
	return { sign: (template) => capability.signEvent(template) }
}

/** Publish context backed by a signer-module capability and a host publish function. */
export async function createSignerPublishContext(
	capability: SignerCapability,
	publish: (event: NostrEvent) => Promise<void>,
): Promise<EventPublishContext<NostrEvent>> {
	return {
		authorPubkey: await capability.getPublicKey(),
		now: () => Math.floor(Date.now() / 1000),
		signer: signerCapabilityAsSdkSigner(capability),
		publish,
	}
}
