import type { Proof } from '@cashu/cashu-ts'

/**
 * Extended proof information with optional mint context.
 * Compatible with both cashu-ts Proof and NDKCashuWallet dump structures.
 */
export interface ProofInfo extends Proof {
	mint?: string
}

/**
 * Pending token that has been generated but not yet claimed.
 * Used for recovery if the app crashes or user wants to reclaim.
 */
export interface PendingToken {
	id: string
	token: string
	amount: number
	mintUrl: string
	createdAt: number
	status: 'pending' | 'claimed' | 'reclaimed'
}

/**
 * Entry structure when proofs are grouped by mint in wallet state dump.
 */
export interface ProofEntry {
	mint: string
	proofs: Proof[]
}
