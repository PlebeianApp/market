import { getMintHostname } from '@/lib/wallet'

export interface AvailableMint {
	mintUrl: string
	hostname: string
	balance: number
	hasSufficientBalance: boolean
}

export interface MintSelectionInput {
	trustedMints: string[]
	walletMints: string[]
	mintBalances: Record<string, number>
	bidAmount: number
}

export interface MintSelectionResult {
	selectedMint: string | null
	availableMints: AvailableMint[]
	eligibleMints: AvailableMint[]
	insufficientBalanceMints: AvailableMint[]
	unfundedTrustedMints: string[]
	error: string | null
}

const normalizeMintUrl = (url: string): string => url.trim().replace(/\/+$/, '')

export function resolveAuctionMintSelection(input: MintSelectionInput): MintSelectionResult {
	const { trustedMints, walletMints, mintBalances, bidAmount } = input

	if (!trustedMints.length) {
		return {
			selectedMint: null,
			availableMints: [],
			eligibleMints: [],
			insufficientBalanceMints: [],
			unfundedTrustedMints: [],
			error: 'Auction has no trusted mints configured',
		}
	}

	const normalizedWalletMints = new Set(walletMints.map(normalizeMintUrl))

	const availableMints: AvailableMint[] = []
	const unfundedTrustedMints: string[] = []

	for (const rawMint of trustedMints) {
		const mintUrl = normalizeMintUrl(rawMint)
		if (normalizedWalletMints.has(mintUrl) || mintBalances[mintUrl] !== undefined) {
			const balance = mintBalances[mintUrl] ?? 0
			if (balance > 0) {
				availableMints.push({
					mintUrl,
					hostname: getMintHostname(mintUrl),
					balance,
					hasSufficientBalance: balance >= bidAmount,
				})
			} else {
				unfundedTrustedMints.push(mintUrl)
			}
		} else {
			unfundedTrustedMints.push(mintUrl)
		}
	}

	const eligibleMints = availableMints.filter((m) => m.hasSufficientBalance)
	const insufficientBalanceMints = availableMints.filter((m) => !m.hasSufficientBalance)

	if (!availableMints.length) {
		return {
			selectedMint: null,
			availableMints: [],
			eligibleMints: [],
			insufficientBalanceMints: [],
			unfundedTrustedMints,
			error: `No balance on any trusted mint. Add funds to one of: ${unfundedTrustedMints.map(getMintHostname).join(', ')}`,
		}
	}

	if (!eligibleMints.length) {
		const bestMint = insufficientBalanceMints[0]
		return {
			selectedMint: bestMint.mintUrl,
			availableMints,
			eligibleMints: [],
			insufficientBalanceMints,
			unfundedTrustedMints,
			error: `Insufficient balance. Need ${bidAmount} sats. Closest: ${getMintHostname(bestMint.mintUrl)} (${bestMint.balance} sats)`,
		}
	}

	return {
		selectedMint: eligibleMints[0].mintUrl,
		availableMints,
		eligibleMints,
		insufficientBalanceMints,
		unfundedTrustedMints,
		error: null,
	}
}
