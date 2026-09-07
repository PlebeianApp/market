import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { CashuWallet } from '@cashu/cashu-ts'

// Track `swap` invocations so we can assert the bid-lock path is fail-closed:
// a DLEQ lock that fails must NOT silently fall back to a non-DLEQ swap.
let swapCalls = 0
let originalLoadMint: typeof CashuWallet.prototype.loadMint | undefined
let originalSwap: typeof CashuWallet.prototype.swap | undefined

// Stub only the two network/mint-touching methods on the REAL CashuWallet class
// (prototype patch, restored after each test) so `createCashuWalletForMint`
// never performs a network `loadMint()` and the lock/swap outcome is fully
// deterministic. This avoids `mock.module` on `@cashu/cashu-ts`, which is a
// shared dependency across dozens of other test files and leaks under Bun 1.3+.
beforeEach(() => {
	swapCalls = 0
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
		// Empty `send` means any (unexpected) fallback that reaches here surfaces
		// as "Mint returned no locked proofs" — never a silent non-DLEQ token.
		return { send: [], keep: [] }
	}
})

afterEach(() => {
	if (originalLoadMint) CashuWallet.prototype.loadMint = originalLoadMint
	if (originalSwap) CashuWallet.prototype.swap = originalSwap
	originalLoadMint = undefined
	originalSwap = undefined
})

import { nip60Actions, nip60Store } from '@/lib/stores/nip60'

const MINT = 'https://mint.example.com'
const LOCK_PUBKEY = '03b72fc0f74836f2066957875bc0e48c6fe734f537117c8fc80d4a365a84f31712'
const REFUND_PUBKEY = '02b72fc0f74836f2066957875bc0e48c6fe734f537117c8fc80d4a365a84f31712'

interface FakeProof {
	id: string
	amount: number
	C: string
	secret: string
	dleq?: unknown
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

const baseParams = {
	amount: 1000,
	locktime: 1700000000,
	refundPubkey: REFUND_PUBKEY,
	lockPubkey: LOCK_PUBKEY,
	mint: MINT,
}

describe('lockAuctionBidFunds DLEQ fail-closed behaviour', () => {
	test('rejects when wallet proofs lack DLEQ metadata instead of silently retrying non-DLEQ', async () => {
		// Proofs with sufficient total value but NO DLEQ metadata. A pre-D3
		// implementation would catch the DLEQ-selection failure and retry a
		// non-DLEQ swap (buildLockOptions(false)) — a silent security regression.
		const proofsWithoutDleq: FakeProof[] = [
			{ id: 'p1', amount: 600, C: '02', secret: '', dleq: undefined },
			{ id: 'p2', amount: 600, C: '02', secret: '', dleq: undefined },
		]
		installWallet(proofsWithoutDleq)

		await expect(nip60Actions.lockAuctionBidFunds(baseParams)).rejects.toThrow('Not enough funds available to send')

		// Fail-closed: the DLEQ attempt threw before any swap, and there was NO
		// follow-up non-DLEQ swap retry.
		expect(swapCalls).toBe(0)
	})

	test('still performs the DLEQ attempt against proof selection', async () => {
		const proofsWithoutDleq: FakeProof[] = [{ id: 'p1', amount: 5000, C: '02', secret: '', dleq: undefined }]
		installWallet(proofsWithoutDleq)

		await expect(nip60Actions.lockAuctionBidFunds({ ...baseParams, amount: 5000 })).rejects.toThrow('Not enough funds available to send')

		expect(swapCalls).toBe(0)
	})
})
