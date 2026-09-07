/**
 * #1235 round-3 B1 — real `lockAuctionBidFunds` against a stubbed mint
 * boundary.
 *
 * Invariants under test (the mint boundary is irreversible):
 *
 *  (a) When the swap RESOLVES but the post-swap STRICT pending-token persist
 *      fails (storage broken mid-leg), the failure surfaces as
 *      `AuctionBidLockMutationPossibleError` — the mint may have issued the
 *      locked proofs, so the outcome is uncertain and the swap ran EXACTLY
 *      once.
 *  (b) Pre-lock validation failures (insufficient balance / mint selection)
 *      stay RAW — provably nothing was mutated, a retry is legitimate.
 *  (c) The pending-token record is persisted BEFORE the post-lock P2PK
 *      assert: a wrong-key lock outcome still leaves the leg durably
 *      observable (reclaim-eligible after the refund timelock).
 *
 * ADR-0005 — zero external network: the only Cashu surface that would touch
 * the network (`CashuWallet.loadMint` / `CashuWallet.swap`) is stubbed via a
 * module mock that spreads the REAL `@cashu/cashu-ts` exports and replaces
 * ONLY `CashuWallet` with a subclass (so every other export — including the
 * pure token codecs used by other test files — stays the real implementation
 * even if bun applies the module mock to a later file in the same run).
 * Everything else (store actions, proof selection, encoding, strict
 * persistence) is the REAL production code path.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { Proof, SendResponse, SwapOptions } from '@cashu/cashu-ts'
import { authStore } from '../stores/auth'

// =============================================================================
// localStorage polyfill — Bun's test runtime doesn't provide one.
// =============================================================================

const installLocalStoragePolyfill = (): void => {
	if (typeof globalThis.localStorage !== 'undefined') return
	const store = new Map<string, string>()
	;(globalThis as { localStorage: Storage }).localStorage = {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => {
			store.set(key, value)
		},
		removeItem: (key: string) => {
			store.delete(key)
		},
		clear: () => {
			store.clear()
		},
		key: (index: number) => Array.from(store.keys())[index] ?? null,
		get length() {
			return store.size
		},
	}
}
installLocalStoragePolyfill()

// =============================================================================
// Mint-boundary stub — the real cashu-ts module with ONLY CashuWallet swapped
// for a subclass whose loadMint/swap never touch the network.
// =============================================================================

const actualCashu = await import('@cashu/cashu-ts')

/** Swap calls observed by the stub, in order. */
const swapCalls: Array<{ amount: number; lockPubkey?: string }> = []
/**
 * When set, the stubbed swap returns send proofs locked to THIS pubkey
 * instead of the requested one — models a mint that locked to the wrong key.
 */
let wrongLockPubkeyForSwap: string | null = null

/** Proof secret encoding a 1-of-1 P2PK lock to `lockPubkey` (compressed hex). */
const p2pkSecret = (lockPubkey: string): string => `["P2PK",{"nonce":"lock-1","data":"${lockPubkey}","tags":[[]]}]`

class StubbedCashuWallet extends actualCashu.CashuWallet {
	override async loadMint(): Promise<void> {
		// No keyset fetch in unit tests (ADR-0005) — swap() below is stubbed
		// too, so no mint metadata is ever needed.
	}

	override async swap(amount: number, _proofs: Proof[], options?: SwapOptions): Promise<SendResponse> {
		// cashu-ts types `p2pk.pubkey` as string | string[]; the lock flow
		// always passes a single compressed pubkey.
		const rawLockPubkey = options?.p2pk?.pubkey
		const lockPubkey = Array.isArray(rawLockPubkey) ? rawLockPubkey[0] : rawLockPubkey
		swapCalls.push({ amount, lockPubkey })
		const effectiveLockPubkey = wrongLockPubkeyForSwap ?? lockPubkey ?? '02' + 'a'.repeat(64)
		const sendProof: Proof = {
			id: '00' + '1'.repeat(14),
			amount,
			secret: p2pkSecret(effectiveLockPubkey),
			C: '02' + '7'.repeat(64),
		}
		return { send: [sendProof], keep: [] }
	}
}

mock.module('@cashu/cashu-ts', () => ({
	...actualCashu,
	CashuWallet: StubbedCashuWallet,
}))

// Import the REAL store module via a UNIQUE query-string specifier: bun
// applies module mocks across every test file in one run (an earlier-loading
// file's `mock.module('@/lib/stores/nip60')` would otherwise shadow this
// file's alias import), and no other file can have mocked this specifier.
// The fresh module body loads AFTER the cashu overlay above is registered,
// so its `@cashu/cashu-ts` imports resolve to the stubbed `CashuWallet`.
// This file drives the store instance it loads here — self-consistent,
// order-independent, zero network (ADR-0005).
const realNip60: typeof import('@/lib/stores/nip60') = await import(`${import.meta.dir}/../stores/nip60.ts?b1-real-store=1`)
type AuctionBidLockMutationPossibleErrorInstance = InstanceType<typeof realNip60.AuctionBidLockMutationPossibleError>
const { nip60Actions, nip60Store } = realNip60
import { loadUserData } from '@/lib/wallet/storage'

// =============================================================================
// Fixtures
// =============================================================================

const FAKE_USER_PUBKEY = 'f'.repeat(64)
const TEST_MINT = 'https://mint.test'
const LOCK_PUBKEY = '02' + 'c'.repeat(64)
const REFUND_PUBKEY = '03' + 'e'.repeat(64)

/** Wallet input proof (spendable, with DLEQ metadata so the first swap attempt selects it). */
const inputProof = (amount: number): Proof => ({
	id: '00' + '1'.repeat(14),
	amount,
	secret: 'input-secret',
	C: '02' + '7'.repeat(64),
	dleq: { e: 'aa', s: 'bb', r: 'cc' },
})

/** Minimal NDKCashuWallet surface lockAuctionBidFunds reads. */
const createMockWallet = (proofsByMint: Record<string, Proof[]>): unknown => ({
	mints: Object.keys(proofsByMint),
	mintBalances: {},
	privkeys: new Map(),
	state: {
		getProofs: (options: { mint?: string }) => proofsByMint[options.mint ?? ''] ?? [],
		update: async () => {},
	},
	publish: async () => {},
})

const lockParams = {
	amount: 500,
	preferredMints: [TEST_MINT],
	locktime: Math.floor(Date.now() / 1000) + 3_600,
	refundPubkey: REFUND_PUBKEY,
	lockPubkey: LOCK_PUBKEY,
	auctionEventId: '1'.repeat(64),
	auctionCoordinates: `30408:${'2'.repeat(64)}:auction-1`,
	sellerPubkey: '2'.repeat(64),
	derivationPath: 'm/1/2/3',
	childPubkey: LOCK_PUBKEY,
}

const setAuthUser = () =>
	authStore.setState((s) => ({
		...s,
		user: { pubkey: FAKE_USER_PUBKEY } as unknown as NonNullable<typeof s.user>,
		isAuthenticated: true,
	}))

beforeEach(() => {
	localStorage.clear()
	setAuthUser()
	swapCalls.length = 0
	wrongLockPubkeyForSwap = null
	nip60Store.setState((s) => ({
		...s,
		wallet: createMockWallet({ [TEST_MINT]: [inputProof(1_000)] }) as never,
		status: 'ready',
		pendingTokens: [],
	}))
})

afterEach(() => {
	nip60Store.setState((s) => ({ ...s, wallet: null, status: 'idle', pendingTokens: [] }))
})

// =============================================================================
// Tests
// =============================================================================

describe('lockAuctionBidFunds mint boundary (#1235 round-3 B1)', () => {
	test('(a) swap resolves → post-swap STRICT pending-token write fails → AuctionBidLockMutationPossibleError, swap called exactly once', async () => {
		const originalSetItem = localStorage.setItem.bind(localStorage)
		let pendingTokenWriteFailed = false
		localStorage.setItem = (key: string, _value: string) => {
			if (key.startsWith('nip60_pending_tokens')) {
				pendingTokenWriteFailed = true
				throw new Error('QuotaExceededError: setItem failed')
			}
			originalSetItem(key, _value)
		}
		let caught: unknown
		try {
			await nip60Actions.lockAuctionBidFunds(lockParams)
		} catch (error) {
			caught = error
		}
		localStorage.setItem = originalSetItem

		// The injection genuinely fired (the strict write was attempted).
		expect(pendingTokenWriteFailed).toBe(true)

		// The swap already ran — the mint may have issued the locked proofs,
		// so the failure is classified mutation-possible (uncertain), NOT raw.
		expect(caught).toBeInstanceOf(realNip60.AuctionBidLockMutationPossibleError)
		const mutationPossible = caught as AuctionBidLockMutationPossibleErrorInstance
		expect(mutationPossible.mintUrl).toBe(TEST_MINT)
		expect(mutationPossible.amount).toBe(500)
		expect(mutationPossible.refundPubkey).toBe(REFUND_PUBKEY)
		expect((mutationPossible.cause as Error).message).toContain('QuotaExceededError')
		// #1235 round-3 fix 5: the STRICT pending-token save FAILED — the leg is
		// record-only (the wallet never durably observed the proofs), so the
		// flag must be false and the copy must not promise a wallet reclaim.
		expect(mutationPossible.pendingTokenPersisted).toBe(false)

		// The swap was attempted EXACTLY once — no hidden retry.
		expect(swapCalls).toHaveLength(1)
		// The store did not gain a pending token (the strict write threw
		// before the state update).
		expect(nip60Store.state.pendingTokens).toHaveLength(0)
	})

	test('(b) pre-lock selection failure (insufficient balance) stays RAW — not mutation-possible', async () => {
		// The wallet holds only 100 sats at the mint; the lock wants 500.
		nip60Store.setState((s) => ({ ...s, wallet: createMockWallet({ [TEST_MINT]: [inputProof(100)] }) as never }))

		let caught: unknown
		try {
			await nip60Actions.lockAuctionBidFunds(lockParams)
		} catch (error) {
			caught = error
		}

		// Raw pre-mint validation error: provably nothing was mutated (the
		// swap never ran), so a retry is legitimate and must NOT be refused
		// as mutation-possible.
		expect(caught).toBeInstanceOf(Error)
		expect(caught).not.toBeInstanceOf(realNip60.AuctionBidLockMutationPossibleError)
		expect((caught as Error).message).toContain('No trusted mint has')
		expect(swapCalls).toHaveLength(0)
	})

	test('(c) pending token persisted BEFORE the post-lock assert can throw — wrong-key proofs are still reclaim-eligible', async () => {
		// The swap returns proofs locked to the WRONG pubkey → the post-lock
		// P2PK assert throws AFTER the strict pending-token persist.
		wrongLockPubkeyForSwap = '02' + 'd'.repeat(64)

		let caught: unknown
		try {
			await nip60Actions.lockAuctionBidFunds(lockParams)
		} catch (error) {
			caught = error
		}
		wrongLockPubkeyForSwap = null

		// The assert failure is classified mutation-possible (a swap request
		// WAS sent — the inputs may already be consumed).
		expect(caught).toBeInstanceOf(realNip60.AuctionBidLockMutationPossibleError)
		expect(((caught as AuctionBidLockMutationPossibleErrorInstance).cause as Error).message).toContain('wrong P2PK pubkey')
		// #1235 round-3 fix 5: the STRICT pending-token save SUCCEEDED before the
		// assert threw — the flag must be true (the wallet can observe and
		// reclaim the proofs after the refund timelock).
		expect((caught as AuctionBidLockMutationPossibleErrorInstance).pendingTokenPersisted).toBe(true)
		expect(swapCalls).toHaveLength(1)

		// THE ORDERING INVARIANT: the pending-token record IS durably on disk
		// despite the assert failure — the leg is reclaim-eligible after the
		// refund timelock instead of silently stranded.
		const persisted = loadUserData<Array<{ amount?: number; mintUrl?: string; status?: string }>>('nip60_pending_tokens', [])
		expect(persisted).toHaveLength(1)
		expect(persisted[0].amount).toBe(500)
		expect(persisted[0].mintUrl).toBe(TEST_MINT)
		expect(persisted[0].status).toBe('pending')
		expect(nip60Store.state.pendingTokens).toHaveLength(1)
	})

	test('happy path: locked proofs persist as a strict pending token and the result carries the lock identity', async () => {
		const result = await nip60Actions.lockAuctionBidFunds(lockParams)

		expect(swapCalls).toHaveLength(1)
		expect(swapCalls[0].lockPubkey).toBe(LOCK_PUBKEY)
		expect(result.amount).toBe(500)
		expect(result.mintUrl).toBe(TEST_MINT)
		expect(result.lockPubkey).toBe(LOCK_PUBKEY)
		expect(result.refundPubkey).toBe(REFUND_PUBKEY)
		expect(result.proofs).toHaveLength(1)
		// The pending-token record was durably persisted (strict write).
		const persisted = loadUserData<Array<{ amount?: number }>>('nip60_pending_tokens', [])
		expect(persisted).toHaveLength(1)
		expect(persisted[0].amount).toBe(500)
	})
})
