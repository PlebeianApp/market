import { describe, expect, test } from 'bun:test'
import { resolveAuctionMintSelection, type MintSelectionInput } from '@/lib/auctionMintSelection'

const MINT_A = 'https://mint-a.example.com'
const MINT_B = 'https://mint-b.example.com'
const MINT_C = 'https://mint-c.example.com'

function makeInput(overrides: Partial<MintSelectionInput> = {}): MintSelectionInput {
	return {
		trustedMints: [MINT_A, MINT_B],
		walletMints: [MINT_A, MINT_B],
		mintBalances: { [MINT_A]: 1000, [MINT_B]: 500 },
		bidAmount: 100,
		...overrides,
	}
}

describe('resolveAuctionMintSelection', () => {
	test('auto-selects first mint with sufficient balance', () => {
		const result = resolveAuctionMintSelection(makeInput())
		expect(result.selectedMint).toBe(MINT_A)
		expect(result.error).toBeNull()
		expect(result.eligibleMints).toHaveLength(2)
	})

	test('returns all available mints with balance info', () => {
		const result = resolveAuctionMintSelection(makeInput())
		expect(result.availableMints).toHaveLength(2)
		expect(result.availableMints[0]).toEqual({
			mintUrl: MINT_A,
			hostname: 'mint-a.example.com',
			balance: 1000,
			hasSufficientBalance: true,
		})
		expect(result.availableMints[1]).toEqual({
			mintUrl: MINT_B,
			hostname: 'mint-b.example.com',
			balance: 500,
			hasSufficientBalance: true,
		})
	})

	test('returns error when no trusted mints configured', () => {
		const result = resolveAuctionMintSelection(makeInput({ trustedMints: [] }))
		expect(result.selectedMint).toBeNull()
		expect(result.error).toContain('no trusted mints')
		expect(result.availableMints).toHaveLength(0)
	})

	test('returns error when user has no balance on any trusted mint', () => {
		const result = resolveAuctionMintSelection(
			makeInput({
				mintBalances: { [MINT_A]: 0, [MINT_B]: 0 },
			}),
		)
		expect(result.selectedMint).toBeNull()
		expect(result.error).toContain('No balance on any trusted mint')
		expect(result.availableMints).toHaveLength(0)
	})

	test('returns error when user has balance but below bid amount on all mints', () => {
		const result = resolveAuctionMintSelection(
			makeInput({
				mintBalances: { [MINT_A]: 50, [MINT_B]: 30 },
				bidAmount: 100,
			}),
		)
		expect(result.selectedMint).toBe(MINT_A)
		expect(result.error).toContain('Insufficient balance')
		expect(result.eligibleMints).toHaveLength(0)
		expect(result.insufficientBalanceMints).toHaveLength(2)
	})

	test('selects mint with sufficient balance even if it is not the first', () => {
		const result = resolveAuctionMintSelection(
			makeInput({
				mintBalances: { [MINT_A]: 0, [MINT_B]: 500 },
			}),
		)
		expect(result.selectedMint).toBe(MINT_B)
		expect(result.error).toBeNull()
		expect(result.eligibleMints).toHaveLength(1)
	})

	test('ignores wallet mints not in trusted list', () => {
		const result = resolveAuctionMintSelection(
			makeInput({
				trustedMints: [MINT_A],
				walletMints: [MINT_A, MINT_C],
				mintBalances: { [MINT_A]: 100, [MINT_C]: 5000 },
			}),
		)
		expect(result.selectedMint).toBe(MINT_A)
		expect(result.availableMints).toHaveLength(1)
	})

	test('normalizes trailing slashes on mint URLs', () => {
		const result = resolveAuctionMintSelection(
			makeInput({
				trustedMints: ['https://mint-a.example.com/'],
				walletMints: ['https://mint-a.example.com'],
				mintBalances: { 'https://mint-a.example.com': 200 },
			}),
		)
		expect(result.selectedMint).toBe('https://mint-a.example.com')
		expect(result.error).toBeNull()
	})

	test('handles empty wallet mints gracefully', () => {
		const result = resolveAuctionMintSelection(
			makeInput({
				walletMints: [],
				mintBalances: {},
			}),
		)
		expect(result.selectedMint).toBeNull()
		expect(result.error).toContain('No balance on any trusted mint')
	})

	test('tracks unfunded trusted mints separately', () => {
		const result = resolveAuctionMintSelection(
			makeInput({
				trustedMints: [MINT_A, MINT_B, MINT_C],
				walletMints: [MINT_A, MINT_B, MINT_C],
				mintBalances: { [MINT_A]: 500, [MINT_B]: 0, [MINT_C]: 0 },
			}),
		)
		expect(result.selectedMint).toBe(MINT_A)
		expect(result.unfundedTrustedMints).toEqual([MINT_B, MINT_C])
	})

	test('selects from eligible mints that are also in mintBalances even if not in walletMints', () => {
		const result = resolveAuctionMintSelection(
			makeInput({
				trustedMints: [MINT_A],
				walletMints: [],
				mintBalances: { [MINT_A]: 500 },
			}),
		)
		expect(result.selectedMint).toBe(MINT_A)
		expect(result.error).toBeNull()
	})

	test('single eligible mint is auto-selected without error', () => {
		const result = resolveAuctionMintSelection(
			makeInput({
				trustedMints: [MINT_A, MINT_B],
				mintBalances: { [MINT_A]: 500, [MINT_B]: 0 },
			}),
		)
		expect(result.selectedMint).toBe(MINT_A)
		expect(result.error).toBeNull()
		expect(result.availableMints).toHaveLength(1)
	})

	test('all eligible mints are correctly marked', () => {
		const result = resolveAuctionMintSelection(
			makeInput({
				trustedMints: [MINT_A, MINT_B],
				mintBalances: { [MINT_A]: 1000, [MINT_B]: 50 },
				bidAmount: 200,
			}),
		)
		expect(result.eligibleMints).toHaveLength(1)
		expect(result.eligibleMints[0].mintUrl).toBe(MINT_A)
		expect(result.insufficientBalanceMints).toHaveLength(1)
		expect(result.insufficientBalanceMints[0].mintUrl).toBe(MINT_B)
	})

	test('with previousBidAmount, eligibility uses delta instead of full bid', () => {
		const result = resolveAuctionMintSelection(
			makeInput({
				mintBalances: { [MINT_A]: 150, [MINT_B]: 50 },
				bidAmount: 500,
				previousBidAmount: 400,
			}),
		)
		expect(result.selectedMint).toBe(MINT_A)
		expect(result.error).toBeNull()
		expect(result.eligibleMints).toHaveLength(1)
		expect(result.eligibleMints[0].mintUrl).toBe(MINT_A)
	})

	test('with previousBidAmount, insufficient delta shows error with delta amount', () => {
		const result = resolveAuctionMintSelection(
			makeInput({
				mintBalances: { [MINT_A]: 30, [MINT_B]: 10 },
				bidAmount: 500,
				previousBidAmount: 400,
			}),
		)
		expect(result.selectedMint).toBe(MINT_A)
		expect(result.error).toContain('100')
		expect(result.error).toContain('delta')
		expect(result.eligibleMints).toHaveLength(0)
	})

	test('previousBidAmount equals bidAmount means zero delta — all mints eligible', () => {
		const result = resolveAuctionMintSelection(
			makeInput({
				mintBalances: { [MINT_A]: 1, [MINT_B]: 1 },
				bidAmount: 500,
				previousBidAmount: 500,
			}),
		)
		expect(result.selectedMint).toBe(MINT_A)
		expect(result.error).toBeNull()
		expect(result.eligibleMints).toHaveLength(2)
	})

	test('previousBidAmount exceeding bidAmount is clamped to zero delta', () => {
		const result = resolveAuctionMintSelection(
			makeInput({
				mintBalances: { [MINT_A]: 1, [MINT_B]: 1 },
				bidAmount: 100,
				previousBidAmount: 200,
			}),
		)
		expect(result.selectedMint).toBe(MINT_A)
		expect(result.error).toBeNull()
		expect(result.eligibleMints).toHaveLength(2)
	})
})
