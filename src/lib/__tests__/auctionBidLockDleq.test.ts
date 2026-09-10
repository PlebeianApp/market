import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { CashuWallet } from '@cashu/cashu-ts'

// Track `swap` invocations + control the swap outputs so we can assert the
// ADR-0011 Blocker 2 behaviour: the DLEQ security property lives on the
// freshly issued P2PK swap OUTPUTS, not on the input proofs. The lock must
// swap ALL eligible inputs (so a legacy non-DLEQ balance can still lock on a
// grandfathered auction) and then validate OUTPUT DLEQ.
let swapCalls = 0
let nextSwapResult: { send: unknown[]; keep: unknown[] } = { send: [], keep: [] }
let originalLoadMint: typeof CashuWallet.prototype.loadMint | undefined
let originalSwap: typeof CashuWallet.prototype.swap | undefined

beforeEach(() => {
	swapCalls = 0
	nextSwapResult = { send: [], keep: [] }
	originalLoadMint = CashuWallet.prototype.loadMint
	originalSwap = CashuWallet.prototype.swap
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	;(CashuWallet.prototype as any).loadMint = async (): Promise<void> => {}
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	;(CashuWallet.prototype as any).swap = async (
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		_amount: number,
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		_proofs: unknown[],
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		_opts: unknown,
	): Promise<{ send: unknown[]; keep: unknown[] }> => {
		swapCalls += 1
		return nextSwapResult
	}
})

afterEach(() => {
	if (originalLoadMint) CashuWallet.prototype.loadMint = originalLoadMint
	if (originalSwap) CashuWallet.prototype.swap = originalSwap
	originalLoadMint = undefined
	originalSwap = undefined
})

import { nip60Actions, nip60Store } from '@/lib/stores/nip60'
import { authStore } from '@/lib/stores/auth'

// Bun's test runtime doesn't provide localStorage by default.
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

const FAKE_USER_PUBKEY = 'f'.repeat(64)
authStore.setState((s) => ({
	...s,
	user: { pubkey: FAKE_USER_PUBKEY } as unknown as NonNullable<typeof s.user>,
	isAuthenticated: true,
}))

const MINT = 'https://mint.example.com'
const LOCK_PUBKEY = '03b72fc0f74836f2066957875bc0e48c6fe734f537117c8fc80d4a365a84f31712'
const REFUND_PUBKEY = '02b72fc0f74836f2066957875bc0e48c6fe734f537117c8fc80d4a365a84f31712'
const LOCKTIME = 1_700_000_000

interface FakeProof {
	id: string
	amount: number
	C: string
	secret: string
	dleq?: unknown
	// A helper flag to build a locked-output proof shape below.
	Y?: string
}

/** A wallet proof with NO DLEQ metadata (a legacy/grandfathered balance). */
const noDleqProof = (amount: number): FakeProof => ({ id: 'p', amount, C: '02', secret: '', dleq: undefined })

/**
 * A swap-output proof locked to LOCK_PUBKEY. Secret encodes a P2PK lock to
 * LOCK_PUBKEY (so assertAuctionBidProofsLockedToP2pk passes).
 */
const lockedOutputProof = (amount: number, includeDleq: boolean): FakeProof => {
	// Encode a P2PK lock secret with data = LOCK_PUBKEY, so
	// assertAuctionBidProofsLockedToP2pk passes (it parses the lock pubkey
	// from the secret). see AUCTIONS.md §5.2 lock-secret format.
	const secret = JSON.stringify(['P2PK', { nonce: `lock-${(Math.random() * 1e6) | 0}`, data: LOCK_PUBKEY, tags: [] }])
	// Also derive the proof_y the P2PK secret would need — the assert only
	// checks the pubkey, so a plain hex Y is fine for the count.
	return {
		id: '00' + 'a'.repeat(14),
		amount,
		C: '02' + '7'.repeat(64),
		secret,
		dleq: includeDleq ? { e: 'aa', s: 'bb', r: 'cc' } : undefined,
	}
}

const baseParams = {
	amount: 1000,
	locktime: LOCKTIME,
	refundPubkey: REFUND_PUBKEY,
	lockPubkey: LOCK_PUBKEY,
	mint: MINT,
}

function installWallet(proofs: FakeProof[]): void {
	const mockWallet = {
		mints: [MINT],
		mintBalances: { [MINT]: 10000 },
		state: {
			dump: () => ({ balances: { [MINT]: 10000 }, totalBalance: 10000 }),
			getProofs: ({ mint }: { mint: string }) => (mint === MINT ? proofs : []),
			update: async () => {},
		},
		publish: async () => {},
	}
	nip60Store.setState((s) => ({
		...s,
		status: 'ready',
		wallet: mockWallet as never,
		pendingTokens: [],
	}))
}

describe('lockAuctionBidFunds ADR-0011 Blocker 2 — DLEQ applies to swap OUTPUTS', () => {
	test('swaps ALL eligible inputs regardless of input DLEQ metadata (grandfathered balance can bid)', async () => {
		// A balance whose proofs carry NO DLEQ (legacy/grandfathered). Under the
		// old design this failed at proof selection; under Blocker 2 it is a
		// valid swap input and the DLEQ check moves to the output.
		const proofsWithoutDleq: FakeProof[] = [noDleqProof(2000), noDleqProof(2000)]
		installWallet(proofsWithoutDleq)
		// The mint returns locked outputs WITH DLEQ.
		nextSwapResult = {
			send: [lockedOutputProof(1000, true)],
			keep: [noDleqProof(3000)],
		}

		// Not a DLEQ-required auction (default false) → no output requirement.
		await expect(nip60Actions.lockAuctionBidFunds(baseParams)).resolves.toMatchObject({ amount: 1000 })
		// The swap WAS attempted exactly once with the full input set (no
		// input-side DLEQ filter).
		expect(swapCalls).toBe(1)
	})

	test('a DLEQ-required lock fails closed when the freshly issued P2PK OUTPUT proof lacks DLEQ', async () => {
		const proofsWithoutDleq: FakeProof[] = [noDleqProof(2000)]
		installWallet(proofsWithoutDleq)
		// The mint returns a locked P2PK output proof WITHOUT a DLEQ proof → the
		// output-side DLEQ requirement must fail closed (Blocker 2).
		nextSwapResult = {
			send: [lockedOutputProof(1000, false)],
			keep: [noDleqProof(3000)],
		}

		await expect(nip60Actions.lockAuctionBidFunds({ ...baseParams, dleqRequired: true })).rejects.toThrow(
			/locked proof at index 0 lacks a NUT-12 DLEQ proof/i,
		)

		// The swap was attempted (output validation happens after swap + after
		// the pending-token persist).
		expect(swapCalls).toBe(1)
	})

	test('a DLEQ-required lock succeeds when the output proof carries DLEQ', async () => {
		const proofsWithoutDleq: FakeProof[] = [noDleqProof(2000)]
		installWallet(proofsWithoutDleq)
		nextSwapResult = {
			send: [lockedOutputProof(1000, true)],
			keep: [noDleqProof(3000)],
		}
		await expect(nip60Actions.lockAuctionBidFunds({ ...baseParams, dleqRequired: true })).resolves.toMatchObject({
			amount: 1000,
		})
		expect(swapCalls).toBe(1)
	})

	test('still fails closed when the swap returns no locked proofs (mint misbehaviour)', async () => {
		const proofsWithoutDleq: FakeProof[] = [noDleqProof(2000)]
		installWallet(proofsWithoutDleq)
		nextSwapResult = { send: [], keep: [] }
		await expect(nip60Actions.lockAuctionBidFunds({ ...baseParams, dleqRequired: true })).rejects.toThrow(/outcome is uncertain/i)
		expect(swapCalls).toBe(1)
	})
})
