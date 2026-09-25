/**
 * Coco wallet-engine initialization — review round 5260509967, item 2.
 *
 * `src/lib/stores/cashu.ts` is the only module that wires the renamed
 * `@cashu/coco-core` / `@cashu/coco-indexeddb` packages together, and nothing in
 * this repo drove it: the three callers of `cashuActions.initialize()`
 * (`ReceiveEcashModal`, `SendEcashModal`, `WithdrawLightningModal`) are never
 * opened by a spec, so `initializeCoco` never ran in CI.
 *
 * These tests drive the REAL engine from the renamed packages — `initializeCoco`,
 * `Manager` and coco's own `MemoryRepositories` — and assert the store reaches
 * `status: 'ready'`. Only the persistence backend is swapped: bun has no
 * `indexedDB` global, and AGENTS.md forbids `mock.module()`-ing a third-party
 * package (bun applies module mocks process-wide), so the repository is injected
 * through the store's own narrow first-party seam
 * (`cashuActions.initialize({ repositories })`). No third-party module is
 * mocked here: `@cashu/coco-core` and `@cashu/coco-indexeddb` are used for real.
 *
 * `status: 'ready'` is NOT evidence that the wallet works. The store's
 * operational call sites were written against `coco-cashu-core@1.0.0-rc11`;
 * `@cashu/coco-core@1.0.1` no longer exposes them. That gap is pinned as an
 * executable fact in the second `describe` below and reported in the PR
 * description.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Manager, MemoryRepositories } from '@cashu/coco-core'
import { NDKUser } from '@/lib/nostr/ndk-events'
import { authStore } from '@/lib/stores/auth'
import { cashuActions, cashuStore } from '@/lib/stores/cashu'

const USER_PUBKEY = 'ab'.repeat(32)
const realLocalStorage = globalThis.localStorage
const storage = new Map<string, string>()

/**
 * Structural view of the engine surface the store reaches for, so this file
 * does not depend on either engine version's `.d.ts` for the members that were
 * removed.
 */
interface EngineSurface {
	wallet: {
		receive?: unknown
		send?: unknown
		getBalances?: unknown
		balances?: { byMint?: unknown; total?: unknown }
	}
	quotes?: { createMintQuote?: unknown } | undefined
	mint: { addMint?: unknown; getAllMints?: unknown; getAllTrustedMints?: unknown; trustMint?: unknown }
	ops?: { send?: { prepare?: unknown }; mint?: { prepare?: unknown }; melt?: { prepare?: unknown } }
	on?: unknown
	dispose?: unknown
}

function engineSurface(): EngineSurface {
	const manager = cashuStore.state.manager
	if (!manager) throw new Error('manager not initialized')
	return manager as unknown as EngineSurface
}

async function initializeStore(): Promise<void> {
	await cashuActions.initialize({ repositories: new MemoryRepositories() })
}

beforeEach(() => {
	storage.clear()
	globalThis.localStorage = {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => {
			storage.set(key, value)
		},
		removeItem: (key: string) => {
			storage.delete(key)
		},
		clear: () => {
			storage.clear()
		},
	} as unknown as Storage
	authStore.setState((state) => ({
		...state,
		user: new NDKUser({ pubkey: USER_PUBKEY }),
		isAuthenticated: true,
	}))
})

afterEach(async () => {
	await cashuActions.reset()
	authStore.setState((state) => ({ ...state, user: null, isAuthenticated: false }))
	globalThis.localStorage = realLocalStorage
})

describe('cashu store coco initialization', () => {
	test('reaches status ready with the coco engine from the renamed packages', async () => {
		await initializeStore()

		expect(cashuStore.state.status).toBe('ready')
		expect(cashuStore.state.error).toBeNull()
		expect(cashuStore.state.manager).toBeInstanceOf(Manager)
	})

	test('writes the user-scoped wallet seed on first initialization', async () => {
		await initializeStore()

		const seedHex = storage.get(`cashu_wallet_seed_${USER_PUBKEY}`)
		expect(seedHex).toHaveLength(128)
		expect(seedHex).toMatch(/^[0-9a-f]{128}$/)
	})

	test('a second initialize() keeps the manager it already has', async () => {
		await initializeStore()
		const manager = cashuStore.state.manager

		await initializeStore()

		expect(cashuStore.state.status).toBe('ready')
		expect(cashuStore.state.manager).toBe(manager)
	})
})

describe('known gap: the renamed engine dropped the API this store calls', () => {
	/**
	 * BLOCKER, pinned as an executable fact so CI cannot report "the coco path is
	 * green" while the wallet is inert. Delete this block when the call sites are
	 * migrated to the 1.0.1 surface.
	 *
	 * `coco-cashu-core@1.0.0-rc11` (master) exposed `manager.wallet.send`,
	 * `manager.wallet.getBalances` and `manager.quotes.*`. `@cashu/coco-core@1.0.1`
	 * exposes none of them; balances moved to `manager.wallet.balances.{byMint,total}`
	 * and send/mint/melt operations moved to `manager.ops.{send,mint,melt}`.
	 * The store still calls the rc11 names, so `refreshBalances()` throws and is
	 * swallowed (`src/lib/stores/cashu.ts:230`), and `send()`/quote/melt throw
	 * `TypeError: ... is not a function` at their call sites.
	 */
	test('the rc11 wallet/quotes members are gone and the 1.0.1 replacements are present', async () => {
		await initializeStore()
		const manager = engineSurface()

		expect(manager.wallet.getBalances).toBeUndefined()
		expect(manager.wallet.send).toBeUndefined()
		expect(manager.quotes).toBeUndefined()

		expect(typeof manager.wallet.balances?.total).toBe('function')
		expect(typeof manager.wallet.balances?.byMint).toBe('function')
		expect(typeof manager.ops?.send?.prepare).toBe('function')
		expect(typeof manager.ops?.mint?.prepare).toBe('function')
		expect(typeof manager.ops?.melt?.prepare).toBe('function')
	})

	test('the paths that do still line up keep working against 1.0.1', async () => {
		await initializeStore()
		const manager = engineSurface()

		expect(typeof manager.mint.addMint).toBe('function')
		expect(typeof manager.mint.getAllMints).toBe('function')
		expect(typeof manager.mint.getAllTrustedMints).toBe('function')
		expect(typeof manager.mint.trustMint).toBe('function')
		expect(typeof manager.wallet.receive).toBe('function')
		expect(typeof manager.on).toBe('function')
		expect(typeof manager.dispose).toBe('function')

		// The store-level read that is still wired correctly end to end.
		expect(await cashuActions.getMints()).toEqual([])
	})
})
