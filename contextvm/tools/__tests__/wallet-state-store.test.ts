import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { WalletStateStore } from '../wallet-state-store'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'

let store: WalletStateStore
let dbPath: string

const PUBKEY = 'a'.repeat(64)
const ENC_STATE = 'nip44:ciphertext:abc123'

describe('WalletStateStore', () => {
	beforeEach(() => {
		const dir = mkdtempSync('wallet-state-test-')
		dbPath = join(dir, 'test-wallet-state.sqlite')
		store = new WalletStateStore(dbPath)
	})

	afterEach(() => {
		store.close()
		const dir = dbPath.replace('/test-wallet-state.sqlite', '')
		rmSync(dir, { recursive: true, force: true })
	})

	test('returns null for missing pubkey', () => {
		expect(store.get(PUBKEY)).toBeNull()
	})

	test('stores and retrieves a snapshot with version 1', () => {
		const version = store.sync(PUBKEY, ENC_STATE, 0)
		expect(version).toBe(1)

		const record = store.get(PUBKEY)
		expect(record).not.toBeNull()
		expect(record!.pubkey).toBe(PUBKEY)
		expect(record!.encryptedState).toBe(ENC_STATE)
		expect(record!.version).toBe(1)
		expect(record!.sequence).toBe(0)
		expect(record!.storedAt).toBeGreaterThan(0)
	})

	test('bumps version on each accepted write', () => {
		expect(store.sync(PUBKEY, ENC_STATE, 0)).toBe(1)
		expect(store.sync(PUBKEY, 'nip44:ciphertext:second', 1)).toBe(2)
		expect(store.sync(PUBKEY, 'nip44:ciphertext:third', 2)).toBe(3)

		const record = store.get(PUBKEY)
		expect(record!.version).toBe(3)
		expect(record!.encryptedState).toBe('nip44:ciphertext:third')
	})

	test('rejects stale write when expectedVersion does not match', () => {
		store.sync(PUBKEY, ENC_STATE, 0) // version 1
		const result = store.sync(PUBKEY, 'nip44:ciphertext:stale', 1, 5)
		expect(result).toBeNull()

		// Original state preserved
		const record = store.get(PUBKEY)
		expect(record!.version).toBe(1)
		expect(record!.encryptedState).toBe(ENC_STATE)
	})

	test('accepts write when expectedVersion matches current', () => {
		store.sync(PUBKEY, ENC_STATE, 0) // version 1
		const result = store.sync(PUBKEY, 'nip44:ciphertext:new', 1, 1)
		expect(result).toBe(2)
	})

	test('first write is accepted even with expectedVersion 0', () => {
		const version = store.sync(PUBKEY, ENC_STATE, 0, 0)
		expect(version).toBe(1)
	})

	test('isolates snapshots per pubkey', () => {
		const other = 'b'.repeat(64)
		store.sync(PUBKEY, ENC_STATE, 0)
		store.sync(other, 'nip44:ciphertext:other', 0)

		expect(store.get(PUBKEY)!.encryptedState).toBe(ENC_STATE)
		expect(store.get(other)!.encryptedState).toBe('nip44:ciphertext:other')
	})

	test('persists across store instances', () => {
		store.sync(PUBKEY, ENC_STATE, 0)
		store.close()

		const reopened = new WalletStateStore(dbPath)
		const record = reopened.get(PUBKEY)
		expect(record).not.toBeNull()
		expect(record!.encryptedState).toBe(ENC_STATE)
		expect(record!.version).toBe(1)
		reopened.close()
	})

	test('works with in-memory database', () => {
		const memStore = new WalletStateStore(':memory:')
		expect(memStore.get(PUBKEY)).toBeNull()
		expect(memStore.sync(PUBKEY, ENC_STATE, 0)).toBe(1)
		expect(memStore.get(PUBKEY)!.encryptedState).toBe(ENC_STATE)
		memStore.close()
	})
})
