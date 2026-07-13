/**
 * Secure localStorage layer — encrypts sensitive data at rest (H8).
 *
 * Uses the Web Crypto API (SubtleCrypto) for authenticated encryption:
 *   - Key derivation: HKDF-SHA256 from a caller-supplied secret (e.g. the
 *     authenticated user's private-key hex, which lives in memory only).
 *   - Encryption:      AES-256-GCM (confidential + authenticated).
 *
 * Ciphertext is stored as `v1:<base64(iv)>:<base64(ciphertext)>`. Values that
 * do not match this envelope are treated as legacy plaintext and migrated on
 * the next write, so existing deployments keep working transparently.
 *
 * Threat model: encrypting at rest protects against (a) local/physical access
 * to the device, (b) malicious browser extensions that can read localStorage
 * but cannot execute JS in the page context, and (c) leftover data after
 * logout. It does NOT protect against a live XSS that can execute code while
 * the key is in memory — that requires a CSP / input-sanitisation fix.
 */

const ENVELOPE_PREFIX = 'v1'
const HKDF_INFO = 'plebeian.market/secureStorage/v1'
const HKDF_SALT = 'plebeian.market'

/**
 * Derive an AES-GCM CryptoKey from a hex-encoded secret via HKDF-SHA256.
 * The same secret always yields the same key, so encrypt and decrypt sides
 * stay in sync as long as the caller passes the same secretHex.
 */
export async function deriveAesKey(secretHex: string): Promise<CryptoKey> {
	const subtle = globalThis.crypto.subtle
	const keyMaterial = await subtle.importKey('raw', hexToBytes(secretHex), 'HKDF', false, ['deriveKey'])
	return subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode(HKDF_SALT), info: new TextEncoder().encode(HKDF_INFO) },
		keyMaterial,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt'],
	)
}

/**
 * Encrypt arbitrary JSON-serialisable data and return the storage envelope.
 */
export async function encryptJson(data: unknown, secretHex: string): Promise<string> {
	const key = await deriveAesKey(secretHex)
	const plaintext = new TextEncoder().encode(JSON.stringify(data))
	const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
	const ciphertext = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
	return `${ENVELOPE_PREFIX}:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ciphertext))}`
}

/**
 * Decrypt a storage envelope produced by {@link encryptJson}.
 * Returns `null` for missing or malformed values (never throws on bad input).
 */
export async function decryptJson<T>(envelope: string | null, secretHex: string): Promise<T | null> {
	if (!envelope) return null

	const parts = envelope.split(':')
	if (parts.length !== 3 || parts[0] !== ENVELOPE_PREFIX) {
		// Not an encrypted envelope — caller should handle legacy plaintext.
		return null
	}

	try {
		const iv = base64ToBytes(parts[1])
		const ciphertext = base64ToBytes(parts[2])
		const key = await deriveAesKey(secretHex)
		const plaintext = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
		return JSON.parse(new TextDecoder().decode(plaintext)) as T
	} catch {
		return null
	}
}

/**
 * Returns true if the stored value is an encrypted envelope (v1:...).
 * Use this to detect legacy plaintext that needs migration.
 */
export function isEncryptedEnvelope(value: string | null): boolean {
	if (!value) return false
	const parts = value.split(':')
	return parts.length === 3 && parts[0] === ENVELOPE_PREFIX
}

/**
 * Encrypt and store JSON data under `storageKey` in localStorage.
 * Falls back to plaintext when no secret is available (e.g. pre-auth),
 * so callers can always persist; the data is upgraded to encrypted on
 * the next authenticated write.
 */
export async function secureSet(storageKey: string, data: unknown, secretHex?: string): Promise<void> {
	if (!secretHex) {
		// No encryption key available yet — store plaintext as a transitional
		// measure. It will be encrypted on the next authenticated write.
		localStorage.setItem(storageKey, JSON.stringify(data))
		return
	}
	const envelope = await encryptJson(data, secretHex)
	localStorage.setItem(storageKey, envelope)
}

/**
 * Load and decrypt JSON data from `storageKey`.
 *
 * - If the value is an encrypted envelope and a secret is provided, decrypt it.
 * - If the value is encrypted but no secret is provided, return `null`
 *   (cannot decrypt — caller should treat as "no data available yet").
 * - If the value is legacy plaintext, return it as-is for migration.
 */
export async function secureGet<T>(
	storageKey: string,
	secretHex?: string,
): Promise<{ data: T | null; isEncrypted: boolean; needsMigration: boolean }> {
	const raw = localStorage.getItem(storageKey)
	if (raw === null) {
		return { data: null, isEncrypted: false, needsMigration: false }
	}

	if (isEncryptedEnvelope(raw)) {
		if (!secretHex) {
			return { data: null, isEncrypted: true, needsMigration: false }
		}
		const data = await decryptJson<T>(raw, secretHex)
		return { data, isEncrypted: true, needsMigration: false }
	}

	// Legacy plaintext — parse and flag for migration.
	try {
		const data = JSON.parse(raw) as T
		return { data, isEncrypted: false, needsMigration: true }
	} catch {
		return { data: null, isEncrypted: false, needsMigration: false }
	}
}

// --- byte helpers -----------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
	const clean = hex.startsWith('0x') ? hex.slice(2) : hex
	const bytes = new Uint8Array(clean.length / 2)
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
	}
	return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = ''
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i])
	}
	return btoa(binary)
}

function base64ToBytes(b64: string): Uint8Array {
	const binary = atob(b64)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = binary.charCodeAt(i)
	}
	return bytes
}
