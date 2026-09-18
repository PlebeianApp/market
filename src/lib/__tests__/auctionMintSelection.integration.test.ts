import { describe, expect, test } from 'bun:test'
import { resolveAuctionMintSelection } from '@/lib/auctionMintSelection'
import type { Nip60State } from '@/lib/stores/nip60'

const MINT_A = 'https://mint-a.example.com'
const MINT_B = 'https://mint-b.example.com'
const MINT_C = 'https://mint-c.example.com'

function makeNip60Snapshot(overrides: Partial<Nip60State> = {}): {
	mints: string[]
	mintBalances: Record<string, number>
} {
	return {
		mints: overrides.mints ?? [MINT_A, MINT_B],
		mintBalances: overrides.mintBalances ?? { [MINT_A]: 1000, [MINT_B]: 500 },
	}
}

describe('auctionMintSelection integration with nip60 store state', () => {
	test('resolves mint from fresh wallet with single mint', () => {
		const wallet = makeNip60Snapshot({
			mints: [MINT_A],
			mintBalances: { [MINT_A]: 2000 },
		})
		const result = resolveAuctionMintSelection({
			trustedMints: [MINT_A, MINT_B],
			walletMints: wallet.mints,
			mintBalances: wallet.mintBalances,
			bidAmount: 500,
		})
		expect(result.selectedMint).toBe(MINT_A)
		expect(result.error).toBeNull()
	})

	test('resolves second mint when first has no balance', () => {
		const wallet = makeNip60Snapshot({
			mints: [MINT_A, MINT_B],
			mintBalances: { [MINT_A]: 0, [MINT_B]: 2000 },
		})
		const result = resolveAuctionMintSelection({
			trustedMints: [MINT_A, MINT_B],
			walletMints: wallet.mints,
			mintBalances: wallet.mintBalances,
			bidAmount: 500,
		})
		expect(result.selectedMint).toBe(MINT_B)
		expect(result.error).toBeNull()
	})

	test('handles wallet with only untrusted mints', () => {
		const wallet = makeNip60Snapshot({
			mints: [MINT_C],
			mintBalances: { [MINT_C]: 5000 },
		})
		const result = resolveAuctionMintSelection({
			trustedMints: [MINT_A, MINT_B],
			walletMints: wallet.mints,
			mintBalances: wallet.mintBalances,
			bidAmount: 500,
		})
		expect(result.selectedMint).toBeNull()
		expect(result.error).toContain('No balance on any trusted mint')
	})

	test('handles rebid with higher amount requiring mint switch', () => {
		const wallet = makeNip60Snapshot({
			mints: [MINT_A, MINT_B],
			mintBalances: { [MINT_A]: 200, [MINT_B]: 2000 },
		})
		const firstResult = resolveAuctionMintSelection({
			trustedMints: [MINT_A, MINT_B],
			walletMints: wallet.mints,
			mintBalances: wallet.mintBalances,
			bidAmount: 100,
		})
		expect(firstResult.selectedMint).toBe(MINT_A)
		expect(firstResult.error).toBeNull()

		const rebidResult = resolveAuctionMintSelection({
			trustedMints: [MINT_A, MINT_B],
			walletMints: wallet.mints,
			mintBalances: wallet.mintBalances,
			bidAmount: 500,
			previousBidAmount: 100,
		})
		expect(rebidResult.selectedMint).toBe(MINT_B)
		expect(rebidResult.error).toBeNull()
	})

	test('handles wallet not yet initialized (empty state)', () => {
		const wallet = makeNip60Snapshot({
			mints: [],
			mintBalances: {},
		})
		const result = resolveAuctionMintSelection({
			trustedMints: [MINT_A],
			walletMints: wallet.mints,
			mintBalances: wallet.mintBalances,
			bidAmount: 100,
		})
		expect(result.selectedMint).toBeNull()
		expect(result.error).toContain('No balance on any trusted mint')
	})

	test('handles multiple eligible mints - picks first by auction order', () => {
		const wallet = makeNip60Snapshot({
			mints: [MINT_A, MINT_B],
			mintBalances: { [MINT_A]: 5000, [MINT_B]: 5000 },
		})
		const result = resolveAuctionMintSelection({
			trustedMints: [MINT_A, MINT_B],
			walletMints: wallet.mints,
			mintBalances: wallet.mintBalances,
			bidAmount: 100,
		})
		expect(result.selectedMint).toBe(MINT_A)
		expect(result.eligibleMints).toHaveLength(2)
		expect(result.availableMints.filter((m) => m.balance > 0)).toHaveLength(2)
	})

	test('bid amount of zero is handled gracefully', () => {
		const wallet = makeNip60Snapshot({
			mints: [MINT_A],
			mintBalances: { [MINT_A]: 500 },
		})
		const result = resolveAuctionMintSelection({
			trustedMints: [MINT_A],
			walletMints: wallet.mints,
			mintBalances: wallet.mintBalances,
			bidAmount: 0,
		})
		expect(result.selectedMint).toBe(MINT_A)
		expect(result.error).toBeNull()
	})

	test('reports partial balance correctly for error messaging', () => {
		const wallet = makeNip60Snapshot({
			mints: [MINT_A, MINT_B],
			mintBalances: { [MINT_A]: 50, [MINT_B]: 75 },
		})
		const result = resolveAuctionMintSelection({
			trustedMints: [MINT_A, MINT_B],
			walletMints: wallet.mints,
			mintBalances: wallet.mintBalances,
			bidAmount: 200,
		})
		expect(result.selectedMint).toBeNull()
		expect(result.error).toContain('Insufficient balance')
		expect(result.error).toContain('50')
		expect(result.availableMints).toHaveLength(2)
		expect(result.insufficientBalanceMints).toHaveLength(2)
	})

	test('rebid with small delta keeps first mint eligible', () => {
		const wallet = makeNip60Snapshot({
			mints: [MINT_A, MINT_B],
			mintBalances: { [MINT_A]: 200, [MINT_B]: 2000 },
		})
		const result = resolveAuctionMintSelection({
			trustedMints: [MINT_A, MINT_B],
			walletMints: wallet.mints,
			mintBalances: wallet.mintBalances,
			bidAmount: 500,
			previousBidAmount: 400,
		})
		expect(result.selectedMint).toBe(MINT_A)
		expect(result.error).toBeNull()
		expect(result.eligibleMints).toHaveLength(2)
	})

	test('rebid with large delta falls back to second mint', () => {
		const wallet = makeNip60Snapshot({
			mints: [MINT_A, MINT_B],
			mintBalances: { [MINT_A]: 100, [MINT_B]: 2000 },
		})
		const result = resolveAuctionMintSelection({
			trustedMints: [MINT_A, MINT_B],
			walletMints: wallet.mints,
			mintBalances: wallet.mintBalances,
			bidAmount: 1000,
			previousBidAmount: 200,
		})
		expect(result.selectedMint).toBe(MINT_B)
		expect(result.error).toBeNull()
	})
})
