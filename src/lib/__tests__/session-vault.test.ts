/**
 * Session vault unit tests (ADR-0008 B-3, fixes #996 H8).
 *
 * The vault wraps the nbunksec NIP-46 session (client private key + bunker
 * secret — plaintext by default per signers-api-audit gap 8) in a WebCrypto
 * PBKDF2 + AES-GCM-256 envelope stored under `nostr_session_v1`. Legacy
 * plaintext `nostr_local_signer_key` + `nostr_connect_url` storage is read
 * ONCE: migration wraps + deletes it; refusal discards it (logged out) —
 * never silent plaintext retention.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
	PBKDF2_ITERATIONS,
	VAULT_STORAGE_KEY,
	LEGACY_LOCAL_SIGNER_KEY,
	LEGACY_CONNECT_URL_KEY,
	SessionVaultError,
	clearVaultedSession,
	discardLegacySession,
	hasLegacyPlaintextSession,
	hasVaultedSession,
	migrateLegacySessionToVault,
	unlockVault,
	wrapSession,
} from '@/lib/nostr/session-vault'

// Fast KDF for round-trip tests; the >= 600k default is asserted separately.
const TEST_ITERATIONS = 1_000

const realLocalStorage = globalThis.localStorage
const memoryStorage = new Map<string, string>()

beforeEach(() => {
	memoryStorage.clear()
	globalThis.localStorage = {
		getItem: (key: string) => memoryStorage.get(key) ?? null,
		setItem: (key: string, value: string) => {
			memoryStorage.set(key, value)
		},
		removeItem: (key: string) => {
			memoryStorage.delete(key)
		},
		clear: () => {
			memoryStorage.clear()
		},
	} as unknown as Storage
})

afterEach(() => {
	globalThis.localStorage = realLocalStorage
})

// Deterministic hex keys for the legacy-session fixture (test material only).
const LEGACY_REMOTE_PUBKEY = 'aa'.repeat(32)
const LEGACY_CLIENT_KEY = 'bb'.repeat(32)
const LEGACY_RELAY = 'wss://relay.example.com'
const LEGACY_BUNKER_URL = `bunker://${LEGACY_REMOTE_PUBKEY}?relay=${LEGACY_RELAY}&secret=hunter2`

describe('session vault wrap/unwrap', () => {
	test('round-trip: wrapped nbunksec decrypts to the identical string', async () => {
		const nbunksec = 'nbunksec1qyqqqyqszpphvkpt7dg6ty7npe4x8n2ydqhn2xeyt5xr7x8y2xq' // opaque fixture
		const envelope = await wrapSession(nbunksec, 'correct horse battery staple', { iterations: TEST_ITERATIONS })

		expect(envelope.v).toBe(1)
		expect(envelope.kdf).toBe('PBKDF2-SHA256')
		expect(envelope.iterations).toBe(TEST_ITERATIONS)
		expect(envelope.salt).toBeTruthy()
		expect(envelope.iv).toBeTruthy()
		expect(envelope.ct).toBeTruthy()
		// Ciphertext must not contain the plaintext session.
		expect(envelope.ct).not.toContain(nbunksec)

		const unlocked = await unlockVault(envelope, 'correct horse battery staple', { minIterations: TEST_ITERATIONS })
		expect(unlocked).toBe(nbunksec)
	})

	test('wrong passphrase fails closed with SessionVaultError', async () => {
		const envelope = await wrapSession('nbunksec1secret', 'right-pass', { iterations: TEST_ITERATIONS })
		await expect(unlockVault(envelope, 'wrong-pass')).rejects.toThrow(SessionVaultError)
	})

	test('tampered ciphertext fails closed (AES-GCM auth tag)', async () => {
		const envelope = await wrapSession('nbunksec1secret', 'pass', { iterations: TEST_ITERATIONS })
		const tampered = { ...envelope, ct: envelope.ct.slice(0, -4) + (envelope.ct.endsWith('AAAA') ? 'BBBB' : 'AAAA') }
		await expect(unlockVault(tampered, 'pass')).rejects.toThrow(SessionVaultError)
	})

	test('default PBKDF2 iterations meet the >= 600k brief floor', () => {
		expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000)
	})

	test('iteration-downgrade tamper: lowered iterations are rejected even with the CORRECT passphrase', async () => {
		// Attacker model (Gate 2.5 BLOCKER): edit localStorage iterations
		// 600000 -> 1, exfiltrate the envelope, brute-force offline at
		// 1-iter/guess. validateEnvelope must reject before any derivation
		// (not merely fail later at the AES-GCM auth tag).
		const envelope = await wrapSession('nbunksec1secret', 'right-pass', { iterations: 200_000 })
		const downgraded = { ...envelope, iterations: 1 }
		await expect(unlockVault(downgraded, 'right-pass')).rejects.toThrow('iteration count is below the accepted minimum')
	})

	test('iterations below the default 100k floor are rejected without an explicit test seam', async () => {
		const envelope = await wrapSession('nbunksec1secret', 'pass', { iterations: 1_000 })
		await expect(unlockVault(envelope, 'pass')).rejects.toThrow('iteration count is below the accepted minimum')
	})

	test('non-integer iterations are rejected as a tampered envelope', async () => {
		const envelope = await wrapSession('nbunksec1secret', 'pass', { iterations: 1_000 })
		const fractional = { ...envelope, iterations: 600_000.5 }
		await expect(unlockVault(fractional, 'pass', { minIterations: 1_000 })).rejects.toThrow(SessionVaultError)
	})

	test('minIterations seam: low-cost envelopes unlock when the floor is explicitly lowered for tests', async () => {
		const envelope = await wrapSession('nbunksec1secret', 'pass', { iterations: 1_000 })
		await expect(unlockVault(envelope, 'pass', { minIterations: 1_000 })).resolves.toBe('nbunksec1secret')
	})

	test('each wrap uses a fresh random salt + iv', async () => {
		const a = await wrapSession('nbunksec1secret', 'pass', { iterations: TEST_ITERATIONS })
		const b = await wrapSession('nbunksec1secret', 'pass', { iterations: TEST_ITERATIONS })
		expect(a.salt).not.toBe(b.salt)
		expect(a.iv).not.toBe(b.iv)
		expect(a.ct).not.toBe(b.ct)
	})
})

describe('vaulted session storage lifecycle', () => {
	test('hasVaultedSession reflects save + clear', async () => {
		expect(hasVaultedSession()).toBe(false)
		const { saveVaultedSession } = await import('@/lib/nostr/session-vault')
		await saveVaultedSession('nbunksec1secret', 'pass', { iterations: TEST_ITERATIONS })
		expect(hasVaultedSession()).toBe(true)
		expect(memoryStorage.has(VAULT_STORAGE_KEY)).toBe(true)
		clearVaultedSession()
		expect(hasVaultedSession()).toBe(false)
		expect(memoryStorage.has(VAULT_STORAGE_KEY)).toBe(false)
	})

	test('unlockVault reads the stored envelope when none is passed', async () => {
		const { saveVaultedSession } = await import('@/lib/nostr/session-vault')
		await saveVaultedSession('nbunksec1stored', 'pass', { iterations: TEST_ITERATIONS })
		await expect(unlockVault(undefined, 'pass', { minIterations: TEST_ITERATIONS })).resolves.toBe('nbunksec1stored')
	})

	test('corrupt stored envelope fails closed', async () => {
		memoryStorage.set(VAULT_STORAGE_KEY, 'not-json{')
		await expect(unlockVault(undefined, 'pass')).rejects.toThrow(SessionVaultError)
	})
})

describe('legacy plaintext migration (read ONCE policy)', () => {
	test('happy path: legacy session migrates to encrypted vault and legacy keys are deleted', async () => {
		memoryStorage.set(LEGACY_LOCAL_SIGNER_KEY, LEGACY_CLIENT_KEY)
		memoryStorage.set(LEGACY_CONNECT_URL_KEY, LEGACY_BUNKER_URL)
		expect(hasLegacyPlaintextSession()).toBe(true)

		const { nbunksec } = await migrateLegacySessionToVault('migration-pass', { iterations: TEST_ITERATIONS })

		// Vault written, plaintext gone — never silent retention.
		expect(hasVaultedSession()).toBe(true)
		expect(memoryStorage.has(LEGACY_LOCAL_SIGNER_KEY)).toBe(false)
		expect(memoryStorage.has(LEGACY_CONNECT_URL_KEY)).toBe(false)

		// The migrated nbunksec must decode back to exactly the legacy parts.
		const { decodeNbunksec } = await import('applesauce-signers/helpers')
		const info = decodeNbunksec(nbunksec)
		expect(info.local_key).toBe(LEGACY_CLIENT_KEY)
		expect(info.pubkey).toBe(LEGACY_REMOTE_PUBKEY)
		expect(info.relays).toEqual([LEGACY_RELAY])
		expect(info.secret).toBe('hunter2')

		// And the vault unwraps with the chosen passphrase.
		await expect(unlockVault(undefined, 'migration-pass', { minIterations: TEST_ITERATIONS })).resolves.toBe(nbunksec)
	})

	test('refusal path: discardLegacySession deletes plaintext and writes NO vault', () => {
		memoryStorage.set(LEGACY_LOCAL_SIGNER_KEY, LEGACY_CLIENT_KEY)
		memoryStorage.set(LEGACY_CONNECT_URL_KEY, LEGACY_BUNKER_URL)

		discardLegacySession()

		expect(hasLegacyPlaintextSession()).toBe(false)
		expect(hasVaultedSession()).toBe(false)
		expect(memoryStorage.has(LEGACY_LOCAL_SIGNER_KEY)).toBe(false)
		expect(memoryStorage.has(LEGACY_CONNECT_URL_KEY)).toBe(false)
	})

	test('migration without a legacy session fails closed', async () => {
		await expect(migrateLegacySessionToVault('pass', { iterations: TEST_ITERATIONS })).rejects.toThrow(SessionVaultError)
		expect(hasVaultedSession()).toBe(false)
	})
})
