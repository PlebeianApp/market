import { describe, expect, it, beforeEach, beforeAll } from 'bun:test'
import { encryptJson, decryptJson, secureSet, secureGet, isEncryptedEnvelope, deriveAesKey } from '../secureStorage'

// --- Mock localStorage (not available in Bun's test runner) -----------------
beforeAll(() => {
	const store = new Map<string, string>()
	const ls = {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => {
			store.set(key, String(value))
		},
		removeItem: (key: string) => {
			store.delete(key)
		},
		clear: () => {
			store.clear()
		},
		get length() {
			return store.size
		},
		key: (index: number) => Array.from(store.keys())[index] ?? null,
	}
	Object.defineProperty(globalThis, 'localStorage', { value: ls, writable: true, configurable: true })
})

// Unique 32-byte hex secrets for test isolation
function makeSecret(char: string): string {
	return char.repeat(64)
}
const SECRET_A = makeSecret('a')
const SECRET_B = makeSecret('b')

beforeEach(() => {
	localStorage.clear()
})

describe('secureStorage — encryptJson / decryptJson', () => {
	it('round-trips arbitrary JSON data', async () => {
		const data = { nwcUri: 'nostr+walletconnect://abc123?relay=wss://r&secret=s3cr3t', name: 'My Wallet' }
		const envelope = await encryptJson(data, SECRET_A)
		const decrypted = await decryptJson<typeof data>(envelope, SECRET_A)

		expect(decrypted).toEqual(data)
	})

	it('produces an envelope with the v1 prefix', async () => {
		const envelope = await encryptJson({ test: true }, SECRET_A)
		expect(envelope.startsWith('v1:')).toBe(true)
		const parts = envelope.split(':')
		expect(parts).toHaveLength(3)
		expect(parts[0]).toBe('v1')
	})

	it('uses a unique IV per encryption (non-deterministic ciphertext)', async () => {
		const data = { value: 'same' }
		const e1 = await encryptJson(data, SECRET_A)
		const e2 = await encryptJson(data, SECRET_A)
		expect(e1).not.toBe(e2) // different IV means different ciphertext
	})

	it('fails to decrypt with the wrong key', async () => {
		const envelope = await encryptJson({ secret: 'data' }, SECRET_A)
		const result = await decryptJson(envelope, SECRET_B)
		expect(result).toBeNull()
	})

	it('returns null for null/empty input', async () => {
		expect(await decryptJson(null, SECRET_A)).toBeNull()
		expect(await decryptJson('', SECRET_A)).toBeNull()
	})

	it('returns null for malformed envelope', async () => {
		expect(await decryptJson('garbage', SECRET_A)).toBeNull()
		expect(await decryptJson('v1:notenough', SECRET_A)).toBeNull()
		expect(await decryptJson('v2:iv:ciphertext', SECRET_A)).toBeNull()
	})
})

describe('secureStorage — isEncryptedEnvelope', () => {
	it('identifies v1 envelopes', async () => {
		const envelope = await encryptJson({ x: 1 }, SECRET_A)
		expect(isEncryptedEnvelope(envelope)).toBe(true)
	})

	it('rejects plaintext and malformed values', () => {
		expect(isEncryptedEnvelope(null)).toBe(false)
		expect(isEncryptedEnvelope('')).toBe(false)
		expect(isEncryptedEnvelope('{"plaintext": true}')).toBe(false)
		expect(isEncryptedEnvelope('nostr+walletconnect://...')).toBe(false)
	})
})

describe('secureStorage — deriveAesKey', () => {
	it('returns a usable CryptoKey', async () => {
		const key = await deriveAesKey(SECRET_A)
		expect(key).toBeDefined()
		expect(key.type).toBe('secret')
		expect(key.algorithm.name).toBe('AES-GCM')
	})
})

describe('secureStorage — secureSet / secureGet', () => {
	it('encrypts when a secret is provided', async () => {
		const data = [{ id: 'w1', nwcUri: 'nostr+walletconnect://pk?relay=wss://r&secret=s' }]
		await secureSet('test_key', data, SECRET_A)

		// Verify the raw value is NOT plaintext JSON
		const raw = localStorage.getItem('test_key')
		expect(raw).toBeTruthy()
		expect(raw!.startsWith('v1:')).toBe(true)
		expect(raw!).not.toContain('secret=s')

		// Decrypt and verify
		const result = await secureGet<typeof data>('test_key', SECRET_A)
		expect(result.data).toEqual(data)
		expect(result.isEncrypted).toBe(true)
		expect(result.needsMigration).toBe(false)
	})

	it('falls back to plaintext when no secret is provided', async () => {
		const data = [{ id: 'w1', name: 'wallet' }]
		await secureSet('test_key', data)

		const raw = localStorage.getItem('test_key')
		expect(raw).toBe(JSON.stringify(data))

		const result = await secureGet<typeof data>('test_key')
		expect(result.data).toEqual(data)
		expect(result.isEncrypted).toBe(false)
		expect(result.needsMigration).toBe(true)
	})

	it('migrates plaintext to encrypted when secret becomes available', async () => {
		// Step 1: store as plaintext (pre-auth)
		const data = [{ id: 'w1', nwcUri: 'secret-uri' }]
		await secureSet('test_key', data) // no secret

		let result = await secureGet<typeof data>('test_key')
		expect(result.needsMigration).toBe(true)
		expect(result.data).toEqual(data)

		// Step 2: re-store with encryption (post-auth)
		await secureSet('test_key', data, SECRET_A)

		result = await secureGet<typeof data>('test_key', SECRET_A)
		expect(result.data).toEqual(data)
		expect(result.isEncrypted).toBe(true)
		expect(result.needsMigration).toBe(false)

		// Raw value should no longer contain the plaintext URI
		expect(localStorage.getItem('test_key')).not.toContain('secret-uri')
	})

	it('returns null data when encrypted but no secret provided (pre-auth)', async () => {
		const data = [{ id: 'w1', nwcUri: 'secret-uri' }]
		await secureSet('test_key', data, SECRET_A)

		const result = await secureGet<typeof data>('test_key') // no secret
		expect(result.data).toBeNull()
		expect(result.isEncrypted).toBe(true)
	})

	it('returns empty result for missing key', async () => {
		const result = await secureGet('nonexistent', SECRET_A)
		expect(result.data).toBeNull()
		expect(result.isEncrypted).toBe(false)
		expect(result.needsMigration).toBe(false)
	})
})
