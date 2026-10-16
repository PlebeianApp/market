/**
 * The session vault — encrypted-at-rest persistence for a NIP-46 session.
 *
 * Harvested from the market's `src/lib/nostr/session-vault.ts` at `4bc7f8c0`,
 * with **every host concern replaced by an injected port**: the browser's
 * key/value store becomes the {@link StoragePort}, the host's WebCrypto becomes
 * the {@link CryptoPort}, and the host's base64 codecs become the pure base64
 * helpers below (so the module holds no host global at all). The *envelope format is unchanged* — the same keys,
 * the same PBKDF2-SHA256 → AES-GCM-256 construction, the same base64 — so a
 * record written by the market's implementation is the record this one reads.
 *
 * Why it exists at all: an nbunksec session is bech32 over PLAINTEXT JSON
 * carrying the client private key and the bunker secret. The package provides
 * no encryption wrapper for it, so the envelope lives here.
 *
 * I5 (the migration policy): the legacy plaintext pair is read ONCE. Migration
 * wraps it and DELETES the legacy keys; refusal discards it and the user logs
 * in again. Plaintext bearer-capability storage is never silently retained, and
 * there is no code path in this module that persists a session in the clear.
 */
import { encodeNbunksec, parseBunkerURI } from 'applesauce-signers/helpers'

import { SessionVaultError } from './errors'
import type { CryptoPort, StoragePort } from './types'

/** Storage key holding the JSON vault envelope. */
/** #5f6a1c — VAULT_STORAGE_KEY: the storage key holding the JSON vault envelope; a contract constant. */
export const VAULT_STORAGE_KEY = 'nostr_session_v1'

/** Legacy plaintext keys, read once, then gone. */
/** #5f6a1c — LEGACY_LOCAL_SIGNER_KEY: the legacy plaintext key, read once, then gone (I5). */
export const LEGACY_LOCAL_SIGNER_KEY = 'nostr_local_signer_key'
/** #5f6a1c — LEGACY_CONNECT_URL_KEY: the legacy connect-URL key, read once with its pair, then gone (I5). */
export const LEGACY_CONNECT_URL_KEY = 'nostr_connect_url'

/** PBKDF2 iteration count this module WRITES hardcoded as the >600k floor. */
/** #5f6a1c — PBKDF2_ITERATIONS: the iteration count this module writes; contract, not a tuning knob. */
export const PBKDF2_ITERATIONS = 600_000

/**
 * Minimum PBKDF2 iteration count accepted when UNLOCKING an envelope.
 * `iterations` is attacker-writable storage: without this floor an attacker can
 * lower it (600k → 1), exfiltrate the envelope, and brute-force the passphrase
 * offline at one iteration per guess. Envelopes below the floor are rejected
 * before any key derivation.
 */
/** #5f6a1c — MIN_PBKDF2_ITERATIONS: the floor accepted when unlocking; below it is rejected before any derivation (I5). */
export const MIN_PBKDF2_ITERATIONS = 100_000

const SALT_BYTES = 16
const IV_BYTES = 12

/** Serialized AES-GCM envelope. `v` allows future envelope evolution. */
/** #2902ce — SessionVaultEnvelope: the serialized PBKDF2 + AES-GCM-256 envelope (I5). */
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

/** Options overriding KDF cost — a test uses a low iteration count. */
/** #179fde — WrapOptions: the KDF cost override for a test (sessionAtRest.iterations). */
export interface WrapOptions {
	iterations?: number
}

/** Options for {@link unlockVault}: `minIterations` lowers the tamper floor for tests. */
/** #179fde — UnlockOptions: minIterations lowers the tamper floor for tests (sessionAtRest.minIterations). */
export interface UnlockOptions {
	minIterations?: number
}

/** Synchronous ownership assertion run immediately before a storage mutation. */
/** #50e8e5 — SessionMutationGuard: the synchronous ownership assertion run before a storage mutation. */
export type SessionMutationGuard = () => void

/** The two ports the vault needs. Injected, never reached for. */
/** #179fde — VaultDeps: the two ports the vault needs, storage and crypto, injected and never reached for. */
export interface VaultDeps {
	storage: StoragePort
	crypto: CryptoPort
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function toBase64(bytes: Uint8Array): string {
	let out = ''
	for (let i = 0; i < bytes.length; i += 3) {
		const b0 = bytes[i]
		const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined
		const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined
		out += B64[b0 >> 2]
		out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)]
		out += b1 === undefined ? '=' : B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)]
		out += b2 === undefined ? '=' : B64[b2 & 63]
	}
	return out
}

function fromBase64(value: string): Uint8Array {
	const clean = value.replace(/=+$/, '')
	const bytes = new Uint8Array(Math.floor((clean.length * 6) / 8))
	let buffer = 0
	let bits = 0
	let index = 0
	for (const char of clean) {
		const digit = B64.indexOf(char)
		if (digit < 0) throw new SessionVaultError('Vault envelope is not valid base64', { code: 'envelope_corrupt' })
		buffer = (buffer << 6) | digit
		bits += 6
		if (bits >= 8) {
			bits -= 8
			bytes[index++] = (buffer >> bits) & 0xff
		}
	}
	return bytes
}

/**
 * Wrap a plaintext nbunksec session string in a PBKDF2 + AES-GCM-256 envelope.
 * Fresh random salt + IV per call; the passphrase never leaves the caller's
 * stack frame, and nothing plaintext is persisted.
 */
/** #2902ce — wrapSession: wrap a plaintext nbunksec in a fresh-salt PBKDF2 + AES-GCM envelope (I5). */
export async function wrapSession(
	nbunksec: string,
	passphrase: string,
	options: WrapOptions,
	crypto: CryptoPort,
): Promise<SessionVaultEnvelope> {
	const iterations = options.iterations ?? PBKDF2_ITERATIONS
	if (!Number.isInteger(iterations) || iterations < 1) {
		throw new SessionVaultError('Invalid PBKDF2 iteration count', { code: 'iteration_floor' })
	}
	const salt = crypto.randomBytes(SALT_BYTES)
	const iv = crypto.randomBytes(IV_BYTES)
	const key = await crypto.pbkdf2Sha256(passphrase, salt, iterations)
	const ciphertext = await crypto.aesGcmEncrypt(key, iv, crypto.utf8Encode(nbunksec))
	return {
		v: 1,
		kdf: 'PBKDF2-SHA256',
		iterations,
		salt: toBase64(salt),
		iv: toBase64(iv),
		ct: toBase64(ciphertext),
	}
}

/** Serialize + persist an envelope under {@link VAULT_STORAGE_KEY}. */
/** #2902ce — saveVaultedSession: serialize and persist an envelope under the vault key (I5). */
export async function saveVaultedSession(
	nbunksec: string,
	passphrase: string,
	options: WrapOptions,
	deps: VaultDeps,
	assertMutationAllowed?: SessionMutationGuard,
): Promise<void> {
	const envelope = await wrapSession(nbunksec, passphrase, options, deps.crypto)
	assertMutationAllowed?.()
	await deps.storage.setItem(VAULT_STORAGE_KEY, JSON.stringify(envelope))
}

function validateEnvelope(parsed: SessionVaultEnvelope, options: UnlockOptions): void {
	if (parsed?.v !== 1 || parsed?.kdf !== 'PBKDF2-SHA256' || !parsed?.salt || !parsed?.iv || !parsed?.ct) {
		throw new SessionVaultError('Vault envelope has an unsupported shape', { code: 'envelope_unsupported' })
	}
	// Iteration-downgrade tamper check: `iterations` is attacker-writable, so
	// reject anything below the floor BEFORE deriving.
	const minIterations = options.minIterations ?? MIN_PBKDF2_ITERATIONS
	if (!Number.isInteger(parsed.iterations) || parsed.iterations < minIterations) {
		throw new SessionVaultError('Vault envelope iteration count is below the accepted minimum (possible tampering)', {
			code: 'iteration_floor',
		})
	}
}

async function readEnvelope(
	envelope: SessionVaultEnvelope | string | undefined,
	options: UnlockOptions,
	deps: VaultDeps,
): Promise<SessionVaultEnvelope> {
	if (envelope != null && typeof envelope === 'object') {
		validateEnvelope(envelope, options)
		return envelope
	}
	const raw = envelope ?? (await deps.storage.getItem(VAULT_STORAGE_KEY))
	if (!raw) throw new SessionVaultError('No vaulted session found', { code: 'no_record' })
	let parsed: SessionVaultEnvelope
	try {
		parsed = JSON.parse(raw) as SessionVaultEnvelope
	} catch (cause) {
		throw new SessionVaultError('Vault envelope is corrupt', { cause, code: 'envelope_corrupt' })
	}
	validateEnvelope(parsed, options)
	return parsed
}

/**
 * Derive + decrypt a vault envelope back to the plaintext nbunksec session.
 * Fails closed (`SessionVaultError`) on a wrong passphrase — AES-GCM's auth tag
 * rejects it — on tampered ciphertext, on a downgraded iteration count, and on
 * a corrupt or absent envelope.
 */
/** #2902ce — unlockVault: derive and decrypt, failing closed on a wrong passphrase, tamper, downgrade or corruption (I5). */
export async function unlockVault(
	envelope: SessionVaultEnvelope | string | undefined,
	passphrase: string,
	options: UnlockOptions,
	deps: VaultDeps,
): Promise<string> {
	const parsed = await readEnvelope(envelope, options, deps)
	try {
		const key = await deps.crypto.pbkdf2Sha256(passphrase, fromBase64(parsed.salt), parsed.iterations)
		const plaintext = await deps.crypto.aesGcmDecrypt(key, fromBase64(parsed.iv), fromBase64(parsed.ct))
		return deps.crypto.utf8Decode(plaintext)
	} catch (cause) {
		// Wrong passphrase and tampered ciphertext both surface here (the GCM auth
		// tag) — fail closed without leaking which check failed.
		throw new SessionVaultError('Failed to unlock the session vault (wrong passphrase or corrupted vault)', {
			cause,
			code: 'wrong_passphrase',
		})
	}
}

/** Is there a vaulted session under {@link VAULT_STORAGE_KEY}? */
/** #8a5718 — hasVaultedSession: is there a vaulted session? (the gate restoreSession reads first). */
export async function hasVaultedSession(deps: VaultDeps): Promise<boolean> {
	return (await deps.storage.getItem(VAULT_STORAGE_KEY)) !== null
}

/** Delete the vaulted session (lock-on-logout, storage half). */
/** #8a5718 — clearVaultedSession: delete the vaulted session, the storage half of endSession clearing the record. */
export async function clearVaultedSession(deps: VaultDeps): Promise<void> {
	await deps.storage.removeItem(VAULT_STORAGE_KEY)
}

/** Is the legacy plaintext pair present? (Read-ONCE gate for boot.) */
/** #2902ce — hasLegacyPlaintextSession: is the legacy plaintext pair present? the read-once gate for boot (I5). */
export async function hasLegacyPlaintextSession(deps: VaultDeps): Promise<boolean> {
	return (await deps.storage.getItem(LEGACY_LOCAL_SIGNER_KEY)) !== null
}

/** #2902ce — LegacyPlaintextSession: the plaintext client key + bunker URL pair a legacy record carries (I5). */
export interface LegacyPlaintextSession {
	clientKeyHex: string
	bunkerUrl: string
}

/** Read the legacy plaintext pair, or `undefined` when it is not present. */
/** #2902ce — readLegacyPlaintextSession: read the legacy pair once, or undefined when it is not present (I5). */
export async function readLegacyPlaintextSession(deps: VaultDeps): Promise<LegacyPlaintextSession | undefined> {
	const clientKeyHex = await deps.storage.getItem(LEGACY_LOCAL_SIGNER_KEY)
	const bunkerUrl = await deps.storage.getItem(LEGACY_CONNECT_URL_KEY)
	if (!clientKeyHex || !bunkerUrl) return undefined
	return { clientKeyHex, bunkerUrl }
}

/**
 * Legacy migration, happy path: rebuild the nbunksec session from the plaintext
 * pair (client key hex + `bunker://` URL), wrap it into the vault, then DELETE
 * both legacy keys. Throws (fail-closed, nothing migrated) when the legacy pair
 * is absent or the bunker URL does not parse.
 */
/** #2902ce — migrateLegacySessionToVault: rebuild the nbunksec, wrap it, then delete the legacy keys (I5). */
export async function migrateLegacySessionToVault(
	passphrase: string,
	options: WrapOptions,
	deps: VaultDeps,
	assertMutationAllowed?: SessionMutationGuard,
): Promise<{ nbunksec: string }> {
	const legacy = await readLegacyPlaintextSession(deps)
	if (!legacy) throw new SessionVaultError('No legacy plaintext session to migrate', { code: 'no_record' })
	let remote: string
	let relays: string[]
	let bunkerSecret: string | undefined
	try {
		;({ remote, relays, bunkerSecret } = parseBunkerURI(legacy.bunkerUrl))
	} catch (cause) {
		throw new SessionVaultError('Legacy bunker URL does not parse; cannot migrate', {
			cause,
			code: 'legacy_invalid',
		})
	}
	const nbunksec = encodeNbunksec({
		pubkey: remote,
		local_key: legacy.clientKeyHex,
		relays,
		secret: bunkerSecret,
	})
	const envelope = await wrapSession(nbunksec, passphrase, options, deps.crypto)
	assertMutationAllowed?.()
	await deps.storage.setItem(VAULT_STORAGE_KEY, JSON.stringify(envelope))
	// Only after the vault write succeeded, purge the plaintext pair.
	await deps.storage.removeItem(LEGACY_LOCAL_SIGNER_KEY)
	await deps.storage.removeItem(LEGACY_CONNECT_URL_KEY)
	return { nbunksec }
}

/**
 * Legacy migration, refusal path: the user declined, so the session is gone —
 * delete the plaintext pair and write NO vault. An intentional, user-visible
 * re-login, never silent plaintext retention.
 */
/** #2902ce — discardLegacySession: the refusal path — delete the plaintext pair and write no vault (I5). */
export async function discardLegacySession(deps: VaultDeps): Promise<void> {
	await deps.storage.removeItem(LEGACY_LOCAL_SIGNER_KEY)
	await deps.storage.removeItem(LEGACY_CONNECT_URL_KEY)
}
