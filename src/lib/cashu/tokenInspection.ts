import { getTokenMetadata } from '@cashu/cashu-ts'

export interface InspectedCashuTokenProof {
	amount: number
	secret: string
	C: string
}

export interface InspectedCashuToken {
	mint: string
	unit: string
	proofs: InspectedCashuTokenProof[]
}

/**
 * Decode only the public metadata needed for Auction commitment checks.
 * cashu-ts v5's full decoder requires mint keyset IDs even though these
 * checks need only mint, unit, amounts, secrets, and commitments.
 */
export const inspectCashuToken = (token: string): InspectedCashuToken => {
	const metadata = getTokenMetadata(token)
	return {
		mint: metadata.mint,
		unit: metadata.unit,
		proofs: metadata.incompleteProofs.map((proof) => {
			const amount = Number(proof.amount.toString())
			if (!Number.isSafeInteger(amount)) throw new Error('Cashu token proof amount exceeds the safe integer range')
			return {
				amount,
				secret: proof.secret,
				C: proof.C,
			}
		}),
	}
}
