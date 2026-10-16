/**
 * I5 — session secrets are never silently plaintext.
 *
 * Harvested from the market's `src/lib/__tests__/session-vault.test.ts` at
 * `4bc7f8c0` — every case kept, and three changes made because the module is
 * standalone: the storage port and the crypto port are injected (the market's
 * version replaced the host's global key/value store and used WebCrypto directly), the
 * imports are module-relative, and the tests drive the vault functions with the
 * ports instead of reaching for a global.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { decodeNbunksec } from 'applesauce-signers/helpers'

import {
	LEGACY_CONNECT_URL_KEY,
	LEGACY_LOCAL_SIGNER_KEY,
	MIN_PBKDF2_ITERATIONS,
	PBKDF2_ITERATIONS,
	SessionVaultError,
	VAULT_STORAGE_KEY,
} from './index'
import { RELAY, REMOTE_PK, makeNbunksec, memoryStorage, webCryptoPort } from './harness'
import {
	clearVaultedSession,
	discardLegacySession,
	hasLegacyPlaintextSession,
	hasVaultedSession,
	migrateLegacySessionToVault,
	saveVaultedSession,
	unlockVault,
	wrapSession,
} from './vault'

// Fast KDF for round-trip tests; the >= 600k default is asserted separately.
const TEST_ITERATIONS = 1_000

const storage = memoryStorage()
const deps = { storage, crypto: webCryptoPort }

beforeEach(() => {
	storage.map.clear()
})

afterEach(() => {
	storage.map.clear()
})

// Deterministic fixture material for the legacy-session case (test material only).
const LEGACY_CLIENT_KEY = 'bb'.repeat(32)
const LEGACY_BUNKER_URL = `bunker://${REMOTE_PK}?relay=${RELAY}&secret=hunter2`

describe('session vault wrap/unwrap', () => {
	test('round-trip: a wrapped session token decrypts to the identical string', async () => {
		const token = makeNbunksec()
		const envelope = await wrapSession(token, 'correct horse battery staple', { iterations: TEST_ITERATIONS }, webCryptoPort)

		expect(envelope.v).toBe(1)
		expect(envelope.kdf).toBe('PBKDF2-SHA256')
		expect(envelope.iterations).toBe(TEST_ITERATIONS)
		expect(envelope.salt).toBeTruthy()
		expect(envelope.iv).toBeTruthy()
		expect(envelope.ct).toBeTruthy()
		// The ciphertext must not contain the plaintext session.
		expect(envelope.ct).not.toContain(token)

		const unlocked = await unlockVault(
			envelope,
			'correct horse battery staple',
			{
				minIterations: TEST_ITERATIONS,
			},
			deps,
		)
		expect(unlocked).toBe(token)
	})

	test('wrong passphrase fails closed with SessionVaultError', async () => {
		const envelope = await wrapSession('nbunksec1secret', 'right-pass', { iterations: TEST_ITERATIONS }, webCryptoPort)
		await expect(unlockVault(envelope, 'wrong-pass', { minIterations: TEST_ITERATIONS }, deps)).rejects.toThrow(SessionVaultError)
	})

	test('tampered ciphertext fails closed (AES-GCM auth tag)', async () => {
		const envelope = await wrapSession('nbunksec1secret', 'pass', { iterations: TEST_ITERATIONS }, webCryptoPort)
		const tampered = {
			...envelope,
			ct: envelope.ct.slice(0, -4) + (envelope.ct.endsWith('AAAA') ? 'BBBB' : 'AAAA'),
		}
		await expect(unlockVault(tampered, 'pass', { minIterations: TEST_ITERATIONS }, deps)).rejects.toThrow(SessionVaultError)
	})

	test('default PBKDF2 iterations meet the >= 600k floor', () => {
		expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000)
	})

	test('iteration-downgrade tamper: lowered iterations are rejected even with the CORRECT passphrase', async () => {
		// Attacker model: edit the stored iterations 600000 -> 1, exfiltrate the
		// envelope, brute-force offline at one iteration per guess. The floor must
		// reject before any derivation — not merely fail later at the auth tag.
		const envelope = await wrapSession('nbunksec1secret', 'right-pass', { iterations: 200_000 }, webCryptoPort)
		const downgraded = { ...envelope, iterations: 1 }
		await expect(unlockVault(downgraded, 'right-pass', {}, deps)).rejects.toThrow('iteration count is below the accepted minimum')
	})

	test('iterations below the default floor are rejected without an explicit seam', async () => {
		const envelope = await wrapSession('nbunksec1secret', 'pass', { iterations: 1_000 }, webCryptoPort)
		await expect(unlockVault(envelope, 'pass', {}, deps)).rejects.toThrow('iteration count is below the accepted minimum')
		expect(MIN_PBKDF2_ITERATIONS).toBe(100_000)
	})

	test('non-integer iterations are rejected as a tampered envelope', async () => {
		const envelope = await wrapSession('nbunksec1secret', 'pass', { iterations: 1_000 }, webCryptoPort)
		const fractional = { ...envelope, iterations: 600_000.5 }
		await expect(unlockVault(fractional, 'pass', { minIterations: 1_000 }, deps)).rejects.toThrow(SessionVaultError)
	})

	test('each fail-closed rule carries its own code — a caller never matches on text', async () => {
		// M8: six distinct vault rules shared one type and one `code`, so the two a
		// login surface must distinguish ("wrong passphrase, let them retry" versus
		// "the plaintext session was discarded, send them to login") were separable
		// only by message text.
		const codes: string[] = []
		const capture = async (run: () => Promise<unknown>) => {
			try {
				await run()
			} catch (error) {
				codes.push((error as { code?: string }).code ?? 'none')
			}
		}

		storage.map.clear()
		await capture(() => unlockVault(undefined, 'pass', {}, deps))
		storage.map.set(VAULT_STORAGE_KEY, 'not-json{')
		await capture(() => unlockVault(undefined, 'pass', {}, deps))
		storage.map.set(VAULT_STORAGE_KEY, JSON.stringify({ v: 2, kdf: 'PBKDF2-SHA256' }))
		await capture(() => unlockVault(undefined, 'pass', {}, deps))
		const downgraded = await wrapSession('nbunksec1secret', 'right-pass', { iterations: 200_000 }, webCryptoPort)
		storage.map.set(VAULT_STORAGE_KEY, JSON.stringify({ ...downgraded, iterations: 1 }))
		await capture(() => unlockVault(undefined, 'right-pass', {}, deps))
		await saveVaultedSession('nbunksec1secret', 'right-pass', { iterations: TEST_ITERATIONS }, deps)
		await capture(() => unlockVault(undefined, 'wrong-pass', { minIterations: TEST_ITERATIONS }, deps))
		storage.map.clear()
		await capture(() => migrateLegacySessionToVault('pass', { iterations: TEST_ITERATIONS }, deps))
		storage.map.set(LEGACY_LOCAL_SIGNER_KEY, LEGACY_CLIENT_KEY)
		storage.map.set(LEGACY_CONNECT_URL_KEY, 'not-a-bunker-uri')
		await capture(() => migrateLegacySessionToVault('pass', { iterations: TEST_ITERATIONS }, deps))

		expect(codes).toEqual([
			'no_record',
			'envelope_corrupt',
			'envelope_unsupported',
			'iteration_floor',
			'wrong_passphrase',
			'no_record',
			'legacy_invalid',
		])
	})

	test('the minIterations seam lets a low-cost envelope unlock when the floor is lowered explicitly', async () => {
		const envelope = await wrapSession('nbunksec1secret', 'pass', { iterations: 1_000 }, webCryptoPort)
		await expect(unlockVault(envelope, 'pass', { minIterations: 1_000 }, deps)).resolves.toBe('nbunksec1secret')
	})

	test('each wrap uses a fresh random salt, iv and ciphertext', async () => {
		const a = await wrapSession('nbunksec1secret', 'pass', { iterations: TEST_ITERATIONS }, webCryptoPort)
		const b = await wrapSession('nbunksec1secret', 'pass', { iterations: TEST_ITERATIONS }, webCryptoPort)
		expect(a.salt).not.toBe(b.salt)
		expect(a.iv).not.toBe(b.iv)
		expect(a.ct).not.toBe(b.ct)
	})

	test('the envelope travels through the storage port as JSON, not as plaintext', async () => {
		const token = makeNbunksec()
		await saveVaultedSession(token, 'pass', { iterations: TEST_ITERATIONS }, deps)

		const stored = storage.map.get(VAULT_STORAGE_KEY)
		expect(stored).toBeDefined()
		expect(stored).not.toContain(token)
		expect(stored).toContain('"kdf":"PBKDF2-SHA256"')
		await expect(unlockVault(undefined, 'pass', { minIterations: TEST_ITERATIONS }, deps)).resolves.toBe(token)
	})
})

describe('vaulted session storage lifecycle', () => {
	test('hasVaultedSession reflects save and clear', async () => {
		expect(await hasVaultedSession(deps)).toBe(false)
		await saveVaultedSession('nbunksec1secret', 'pass', { iterations: TEST_ITERATIONS }, deps)
		expect(await hasVaultedSession(deps)).toBe(true)
		expect(storage.map.has(VAULT_STORAGE_KEY)).toBe(true)

		await clearVaultedSession(deps)
		expect(await hasVaultedSession(deps)).toBe(false)
		expect(storage.map.has(VAULT_STORAGE_KEY)).toBe(false)
	})

	test('unlockVault reads the stored envelope when none is passed', async () => {
		await saveVaultedSession('nbunksec1stored', 'pass', { iterations: TEST_ITERATIONS }, deps)
		await expect(unlockVault(undefined, 'pass', { minIterations: TEST_ITERATIONS }, deps)).resolves.toBe('nbunksec1stored')
	})

	test('a corrupt stored envelope fails closed', async () => {
		storage.map.set(VAULT_STORAGE_KEY, 'not-json{')
		await expect(unlockVault(undefined, 'pass', {}, deps)).rejects.toThrow(SessionVaultError)
	})

	test('an unsupported envelope shape fails closed', async () => {
		storage.map.set(VAULT_STORAGE_KEY, JSON.stringify({ v: 2, kdf: 'PBKDF2-SHA256' }))
		await expect(unlockVault(undefined, 'pass', {}, deps)).rejects.toThrow('unsupported shape')
	})

	test('a mutation-time ownership guard can cancel a completed wrap before vault storage', async () => {
		const cancelled = new Error('auth attempt cancelled')
		let guardCalls = 0
		await expect(
			saveVaultedSession('nbunksec1stale', 'pass', { iterations: TEST_ITERATIONS }, deps, () => {
				guardCalls++
				throw cancelled
			}),
		).rejects.toBe(cancelled)

		expect(guardCalls).toBe(1)
		expect(storage.map.has(VAULT_STORAGE_KEY)).toBe(false)
	})
})

describe('legacy plaintext migration (read ONCE policy)', () => {
	test('happy path: the legacy session migrates to the encrypted vault and the plaintext keys are deleted', async () => {
		storage.map.set(LEGACY_LOCAL_SIGNER_KEY, LEGACY_CLIENT_KEY)
		storage.map.set(LEGACY_CONNECT_URL_KEY, LEGACY_BUNKER_URL)
		expect(await hasLegacyPlaintextSession(deps)).toBe(true)

		const { nbunksec } = await migrateLegacySessionToVault('migration-pass', { iterations: TEST_ITERATIONS }, deps)

		expect(await hasVaultedSession(deps)).toBe(true)
		expect(storage.map.has(LEGACY_LOCAL_SIGNER_KEY)).toBe(false)
		expect(storage.map.has(LEGACY_CONNECT_URL_KEY)).toBe(false)

		// The migrated token must decode back to exactly the legacy parts.
		const info = decodeNbunksec(nbunksec)
		expect(info.local_key).toBe(LEGACY_CLIENT_KEY)
		expect(info.pubkey).toBe(REMOTE_PK)
		expect(info.relays).toEqual([RELAY])
		expect(info.secret).toBe('hunter2')

		await expect(unlockVault(undefined, 'migration-pass', { minIterations: TEST_ITERATIONS }, deps)).resolves.toBe(nbunksec)
	})

	test('refusal path: discardLegacySession deletes the plaintext and writes NO vault', async () => {
		storage.map.set(LEGACY_LOCAL_SIGNER_KEY, LEGACY_CLIENT_KEY)
		storage.map.set(LEGACY_CONNECT_URL_KEY, LEGACY_BUNKER_URL)

		await discardLegacySession(deps)

		expect(await hasLegacyPlaintextSession(deps)).toBe(false)
		expect(await hasVaultedSession(deps)).toBe(false)
		expect(storage.map.size).toBe(0)
	})

	test('migration without a legacy session fails closed', async () => {
		await expect(migrateLegacySessionToVault('pass', { iterations: TEST_ITERATIONS }, deps)).rejects.toThrow(SessionVaultError)
		expect(await hasVaultedSession(deps)).toBe(false)
	})

	test('an unparseable legacy bunker URL fails closed and migrates nothing', async () => {
		storage.map.set(LEGACY_LOCAL_SIGNER_KEY, LEGACY_CLIENT_KEY)
		storage.map.set(LEGACY_CONNECT_URL_KEY, 'not-a-bunker-uri')

		await expect(migrateLegacySessionToVault('pass', { iterations: TEST_ITERATIONS }, deps)).rejects.toThrow('does not parse')
		expect(await hasVaultedSession(deps)).toBe(false)
		expect(storage.map.get(LEGACY_LOCAL_SIGNER_KEY)).toBe(LEGACY_CLIENT_KEY)
	})

	test('a mutation-time ownership guard cancels migration before the vault write or the plaintext deletion', async () => {
		storage.map.set(LEGACY_LOCAL_SIGNER_KEY, LEGACY_CLIENT_KEY)
		storage.map.set(LEGACY_CONNECT_URL_KEY, LEGACY_BUNKER_URL)
		const cancelled = new Error('auth attempt cancelled')
		let guardCalls = 0

		await expect(
			migrateLegacySessionToVault('migration-pass', { iterations: TEST_ITERATIONS }, deps, () => {
				guardCalls++
				throw cancelled
			}),
		).rejects.toBe(cancelled)

		expect(guardCalls).toBe(1)
		expect(storage.map.has(VAULT_STORAGE_KEY)).toBe(false)
		expect(storage.map.get(LEGACY_LOCAL_SIGNER_KEY)).toBe(LEGACY_CLIENT_KEY)
		expect(storage.map.get(LEGACY_CONNECT_URL_KEY)).toBe(LEGACY_BUNKER_URL)
	})
})
