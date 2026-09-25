import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { authStore } from '@/lib/stores/auth'
import { cashuStore } from '@/lib/stores/cashu'
import { configStore } from '@/lib/stores/config'
import { nip60Store } from '@/lib/stores/nip60'
import { getLegacyTruncatedUserScopedKey } from '@/lib/wallet/storage'
import {
	InMemoryMigrationControlStore,
	createInitialControlRecord,
	enumerateProductionInventory,
	freezeMaintainedProductionInventory,
	transitionMigrationPhase,
	type MigrationIdentity,
} from '..'

const ACCOUNT = 'a'.repeat(64)
const IDENTITY: MigrationIdentity = {
	namespace: `plebeian-market:coco:v2:production:nostr:${ACCOUNT}`,
	account: ACCOUNT,
	environment: 'production',
	epoch: 'adapter-test-epoch',
}

class TestStorage implements Storage {
	private readonly values = new Map<string, string>()
	get length() {
		return this.values.size
	}
	clear() {
		this.values.clear()
	}
	getItem(key: string) {
		return this.values.get(key) ?? null
	}
	key(index: number) {
		return Array.from(this.values.keys())[index] ?? null
	}
	removeItem(key: string) {
		this.values.delete(key)
	}
	setItem(key: string, value: string) {
		this.values.set(key, value)
	}
}

const originalLocalStorage = globalThis.localStorage
const originalAuth = authStore.state
const originalConfig = configStore.state
const originalNip60 = nip60Store.state
const originalCashu = cashuStore.state

beforeEach(() => {
	Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new TestStorage() })
	authStore.setState((state) => ({ ...state, user: { pubkey: ACCOUNT } as never, isAuthenticated: true }))
	configStore.setState((state) => ({ ...state, config: { ...state.config, stage: 'production' }, isLoaded: true }))
	const fakeWallet = {
		p2pk: 'b'.repeat(64),
		privkeys: new Map(),
		mints: ['https://mint.example'],
		state: {
			getMintsProofs: ({ validStates }: { validStates: Set<string> }) => {
				if (validStates.has('available')) {
					return new Map([
						['https://mint.example', [{ id: 'keyset-1', C: 'public-proof-commitment', secret: 'must-not-be-copied', amount: 8 }]],
					])
				}
				return new Map()
			},
		},
	}
	nip60Store.setState((state) => ({
		...state,
		account: ACCOUNT,
		wallet: fakeWallet as never,
		status: 'ready',
		mints: ['https://mint.example'],
		defaultMint: 'https://mint.example',
	}))
	const fakeManager = {
		wallet: { getBalances: async () => ({ 'https://mint.example': 3 }) },
		mint: { getAllMints: async () => [{ mintUrl: 'https://mint.example' }] },
		history: { getPaginatedHistory: async () => [] },
	}
	cashuStore.setState((state) => ({ ...state, account: ACCOUNT, manager: fakeManager as never, status: 'ready' }))
})

afterEach(() => {
	Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalLocalStorage })
	authStore.setState(() => originalAuth)
	configStore.setState(() => originalConfig)
	nip60Store.setState(() => originalNip60)
	cashuStore.setState(() => originalCashu)
})

describe('maintained production inventory adapter', () => {
	test('freezes real maintained sources and blocks truncated-scope records without copying bearer material', async () => {
		localStorage.setItem(
			getLegacyTruncatedUserScopedKey('nip60_pending_tokens', ACCOUNT),
			JSON.stringify([
				{
					id: 'pending-1',
					token: 'cashuA-secret-bearer-token',
					amount: 5,
					mintUrl: 'https://mint.example',
					createdAt: 1,
					status: 'pending',
				},
			]),
		)
		const controlStore = new InMemoryMigrationControlStore([createInitialControlRecord(IDENTITY)])
		await transitionMigrationPhase(controlStore, IDENTITY, 0, 'MIGRATION_SNAPSHOT_FROZEN')
		const port = await freezeMaintainedProductionInventory(IDENTITY, controlStore)
		const run = await enumerateProductionInventory(IDENTITY, port, 10)

		const proof = run.items.find((item) => item.source === 'LEGACY_SPENDABLE_PROOFS')
		expect(proof).toMatchObject({ amount: BigInt(8), accountAttribution: 'CANONICAL_ACCOUNT' })
		const pending = run.items.find((item) => item.source === 'LEGACY_PENDING_OUTBOUND')
		expect(pending).toMatchObject({
			amount: BigInt(5),
			accountAttribution: 'UNATTRIBUTED',
			attributionReason: 'legacy-truncated-pubkey-scope',
			state: 'PENDING',
		})
		const opening = run.items.find((item) => item.source === 'COCO_OPENING_BASELINE')
		expect(opening).toMatchObject({ accountAttribution: 'UNATTRIBUTED', amount: BigInt(3), state: 'AMBIGUOUS' })
		expect(JSON.stringify(run, (_key, value) => (typeof value === 'bigint' ? value.toString() : value))).not.toContain(
			'cashuA-secret-bearer-token',
		)
		expect(new Set(run.completions.map((completion) => completion.snapshotId)).size).toBe(1)
	})

	test('refuses a runtime wallet loaded for a different full account', async () => {
		nip60Store.setState((state) => ({ ...state, account: 'c'.repeat(64) }))
		const controlStore = new InMemoryMigrationControlStore([createInitialControlRecord(IDENTITY)])
		await transitionMigrationPhase(controlStore, IDENTITY, 0, 'MIGRATION_SNAPSHOT_FROZEN')
		await expect(freezeMaintainedProductionInventory(IDENTITY, controlStore)).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' })
	})

	test('rejects a control revision that changes while sources are being scanned', async () => {
		const backing = new InMemoryMigrationControlStore([createInitialControlRecord(IDENTITY)])
		await transitionMigrationPhase(backing, IDENTITY, 0, 'MIGRATION_SNAPSHOT_FROZEN')
		let reads = 0
		const racingStore = {
			get: async (namespace: string) => {
				const record = await backing.get(namespace)
				reads += 1
				return reads === 2 && record ? ({ ...record, revision: record.revision + 1 } as const) : record
			},
			create: backing.create.bind(backing),
			transact: backing.transact.bind(backing),
		}
		await expect(freezeMaintainedProductionInventory(IDENTITY, racingStore)).rejects.toMatchObject({ code: 'STALE_REVISION' })
	})
})
