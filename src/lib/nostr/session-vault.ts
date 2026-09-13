/**
 * Session vault — encrypted-at-rest persistence for the NIP-46 session
 * (ADR-0008 Wave A3b / task B-3, fixes #996 finding H8).
 *
 * `NostrConnectSigner.getNbunksec()` is bech32 over PLAINTEXT JSON carrying
 * the client private key and bunker secret — the package provides NO
 * encryption wrapper for it (signers-api-audit gap 8: "the app must build
 * the envelope itself — WebCrypto PBKDF2(password, random salt) → AES-GCM
 * encrypt(nbunksec, random iv), store {salt, iv, ct}"). That envelope lives
 * here.
 *
 * ADR-0008 invariant 4 (persisted-session migration policy): the legacy
 * plaintext pair (`nostr_local_signer_key` + `nostr_connect_url`, written by
 * `auth.ts` pre-B-3) is read ONCE. Completing the unlock-prompt migration
 * wraps the session and DELETES the legacy keys; refusal/skip discards it
 * and the user is logged out — plaintext bearer-capability storage is never
 * silently retained.
 */
import { encodeNbunksec, parseBunkerURI } from 'applesauce-signers/helpers'

/** localStorage key holding the JSON vault envelope. */
export const VAULT_STORAGE_KEY = 'nostr_session_v1'

// Legacy plaintext keys (auth.ts pre-B-3) — read once, then gone. Single
// definition site: auth.ts re-exports these as NOSTR_LOCAL_SIGNER_KEY /
// NOSTR_CONNECT_KEY.
export const LEGACY_LOCAL_SIGNER_KEY = 'nostr_local_signer_key'
export const LEGACY_CONNECT_URL_KEY = 'nostr_connect_url'

/** PBKDF2 iteration count — the brief's >= 600k floor (OWASP 2023 guidance). */
export const PBKDF2_ITERATIONS = 600_000

/**
 * Minimum PBKDF2 iteration count accepted when UNLOCKING an envelope.
 * `iterations` is attacker-writable localStorage: without this floor an
 * attacker can lower it (600k -> 1), exfiltrate the envelope, and brute-force
 * the passphrase offline at one iteration per guess. Envelopes below the
 * floor are rejected before any key derivation (Gate 2.5 blocker).
 */
export const MIN_PBKDF2_ITERATIONS = 100_000

const SALT_BYTES = 16
const IV_BYTES = 12
const KEY_BITS = 256

/** Serialized AES-GCM envelope. `v` allows future envelope evolution. */
export interface SessionVaultEnvelope {
	v: 1
	kdf: 'PBKDF2-SHA256'
	iterations: number
	/** Random per-envelope salt, base64. */
	salt: string
	/** Random AES-GCM nonce, base64. */
	iv: string
	/** Wrapped nbunksec payload, base64. */
	ct: string
}

/** Options overriding KDF cost — tests use a low iteration count. */
export interface WrapOptions {
	iterations?: number
}

/**
 * Options for {@link unlockVault}. `minIterations` lowers the tamper floor —
 * tests wrapping at a low cost must pass the matching floor explicitly.
 */
export interface UnlockOptions {
	minIterations?: number
}

/** Error type for every fail-closed vault path (never a raw DOMException). */
export class SessionVaultError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options)
		this.name = 'SessionVaultError'
	}
}

function toBase64(bytes: Uint8Array): string {
	let binary = ''
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
	return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
	const binary = atob(value)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
	return bytes
}

function randomBytes(length: number): Uint8Array {
	const bytes = new Uint8Array(length)
	crypto.getRandomValues(bytes)
	return bytes
}

/** PBKDF2-SHA256 passphrase → AES-GCM-256 CryptoKey. */
async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
	const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
	return crypto.subtle.deriveKey(
		{ name: 'PBKDF2', hash: 'SHA-256', salt: salt as unknown as BufferSource, iterations },
		material,
		{ name: 'AES-GCM', length: KEY_BITS },
		false,
		['encrypt', 'decrypt'],
	)
}

/**
 * Wrap a plaintext nbunksec session string in a PBKDF2 + AES-GCM-256
 * envelope. Fresh random salt + IV per call; the passphrase never leaves
 * the caller's stack frame, and nothing plaintext is persisted.
 */
export async function wrapSession(nbunksec: string, passphrase: string, options: WrapOptions = {}): Promise<SessionVaultEnvelope> {
	const iterations = options.iterations ?? PBKDF2_ITERATIONS
	if (!Number.isInteger(iterations) || iterations < 1) {
		throw new SessionVaultError('Invalid PBKDF2 iteration count')
	}
	const salt = randomBytes(SALT_BYTES)
	const iv = randomBytes(IV_BYTES)
	const key = await deriveKey(passphrase, salt, iterations)
	const ciphertext = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv: iv as unknown as BufferSource },
		key,
		new TextEncoder().encode(nbunksec),
	)
	return {
		v: 1,
		kdf: 'PBKDF2-SHA256',
		iterations,
		salt: toBase64(salt),
		iv: toBase64(iv),
		ct: toBase64(new Uint8Array(ciphertext)),
	}
}

/** Serialize + persist an envelope under {@link VAULT_STORAGE_KEY}. */
export function saveVaultedSession(nbunksec: string, passphrase: string, options: WrapOptions = {}): Promise<void> {
	return wrapSession(nbunksec, passphrase, options).then((envelope) => {
		localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(envelope))
	})
}

function readEnvelope(envelope?: SessionVaultEnvelope | string, options: UnlockOptions = {}): SessionVaultEnvelope {
	if (envelope != null && typeof envelope === 'object') {
		validateEnvelope(envelope, options)
		return envelope
	}
	const raw = envelope ?? localStorage.getItem(VAULT_STORAGE_KEY)
	if (!raw) throw new SessionVaultError('No vaulted session found')
	let parsed: SessionVaultEnvelope
	try {
		parsed = JSON.parse(raw) as SessionVaultEnvelope
	} catch (cause) {
		throw new SessionVaultError('Vault envelope is corrupt', { cause })
	}
	validateEnvelope(parsed, options)
	return parsed
}

function validateEnvelope(parsed: SessionVaultEnvelope, options: UnlockOptions = {}): void {
	if (parsed?.v !== 1 || parsed?.kdf !== 'PBKDF2-SHA256' || !parsed?.salt || !parsed?.iv || !parsed?.ct) {
		throw new SessionVaultError('Vault envelope has an unsupported shape')
	}
	// Iteration-downgrade tamper check (Gate 2.5 blocker): `iterations` is
	// attacker-writable, so reject anything below the floor BEFORE deriving.
	const minIterations = options.minIterations ?? MIN_PBKDF2_ITERATIONS
	if (!Number.isInteger(parsed.iterations) || parsed.iterations < minIterations) {
		throw new SessionVaultError('Vault envelope iteration count is below the accepted minimum (possible tampering)')
	}
}

/**
 * Derive + decrypt a vault envelope back to the plaintext nbunksec session.
 * Fails closed (`SessionVaultError`) on a wrong passphrase — AES-GCM's auth
 * tag rejects it — on tampered ciphertext, on a downgraded iteration count,
 * and on a corrupt/absent envelope.
 */
export async function unlockVault(
	envelope: SessionVaultEnvelope | string | undefined,
	passphrase: string,
	options: UnlockOptions = {},
): Promise<string> {
	const parsed = readEnvelope(envelope, options)
	try {
		const key = await deriveKey(passphrase, fromBase64(parsed.salt), parsed.iterations)
		const plaintext = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: fromBase64(parsed.iv) as unknown as BufferSource },
			key,
			fromBase64(parsed.ct) as unknown as BufferSource,
		)
		return new TextDecoder().decode(plaintext)
	} catch (cause) {
		// Wrong passphrase and tampered ciphertext both surface here (GCM auth
		// tag) — fail closed without leaking which check failed.
		throw new SessionVaultError('Failed to unlock the session vault (wrong passphrase or corrupted vault)', { cause })
	}
}

/** Is there a vaulted session under {@link VAULT_STORAGE_KEY}? */
export function hasVaultedSession(): boolean {
	return localStorage.getItem(VAULT_STORAGE_KEY) !== null
}

/** Delete the vaulted session (lock-on-logout storage half). */
export function clearVaultedSession(): void {
	localStorage.removeItem(VAULT_STORAGE_KEY)
}

/** Is the legacy plaintext pair present? (Read-ONCE gate for boot.) */
export function hasLegacyPlaintextSession(): boolean {
	return localStorage.getItem(LEGACY_LOCAL_SIGNER_KEY) !== null
}

/**
 * Legacy migration, happy path: rebuild the nbunksec session from the
 * plaintext pair (client key hex + `bunker://` URL), wrap it into the vault,
 * then DELETE both legacy keys. Throws (fail-closed, nothing migrated) when
 * the legacy pair is absent or the bunker URL does not parse.
 */
export async function migrateLegacySessionToVault(passphrase: string, options: WrapOptions = {}): Promise<{ nbunksec: string }> {
	const clientKeyHex = localStorage.getItem(LEGACY_LOCAL_SIGNER_KEY)
	const bunkerUrl = localStorage.getItem(LEGACY_CONNECT_URL_KEY)
	if (!clientKeyHex || !bunkerUrl) {
		throw new SessionVaultError('No legacy plaintext session to migrate')
	}
	let remote: string
	let relays: string[]
	let bunkerSecret: string | undefined
	try {
		;({ remote, relays, bunkerSecret } = parseBunkerURI(bunkerUrl))
	} catch (cause) {
		throw new SessionVaultError('Legacy bunker URL does not parse; cannot migrate', { cause })
	}
	const nbunksec = encodeNbunksec({ pubkey: remote, local_key: clientKeyHex, relays, secret: bunkerSecret })
	const envelope = await wrapSession(nbunksec, passphrase, options)
	localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(envelope))
	// Only after the vault write succeeded, purge the plaintext pair.
	localStorage.removeItem(LEGACY_LOCAL_SIGNER_KEY)
	localStorage.removeItem(LEGACY_CONNECT_URL_KEY)
	return { nbunksec }
}

/**
 * Legacy migration, refusal path: the user declined the unlock-prompt
 * migration, so the session is gone — delete the plaintext pair and write NO
 * vault (ADR-0008: "an intentional, user-visible forced re-login", never
 * silent plaintext retention).
 */
export function discardLegacySession(): void {
	localStorage.removeItem(LEGACY_LOCAL_SIGNER_KEY)
	localStorage.removeItem(LEGACY_CONNECT_URL_KEY)
}
