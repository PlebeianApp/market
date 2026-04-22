import type { Proof } from '@cashu/cashu-ts'

/**
 * Extended proof information with optional mint context.
 * Compatible with both cashu-ts Proof and NDKCashuWallet dump structures.
 */
export interface ProofInfo extends Proof {
	mint?: string
}

export interface AuctionBidPendingTokenContext {
	kind: 'auction_bid'
	auctionEventId: string
	auctionCoordinates?: string
	bidEventId?: string
	sellerPubkey: string
	pathIssuerPubkey: string
	lockPubkey: string
	refundPubkey: string
	locktime: number
	derivationPath?: string
	childPubkey?: string
	grantId?: string
}

export type PendingTokenContext = AuctionBidPendingTokenContext

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
	context?: PendingTokenContext
	/** Attempt counter for reclaim retries — drives exponential backoff. */
	reclaimAttempts?: number
	/** Unix seconds of the last reclaim attempt (successful or failed). */
	lastReclaimAttemptAt?: number
	/** Human-readable reason the last reclaim attempt failed, preserved for UX. */
	reclaimFailureReason?: string
	/**
	 * Marked true when the mint *permanently* rejects a refund-path spend for
	 * this token (e.g. the locking secret uses a different keyset or the
	 * refund keys don't match what the wallet has). Auto-reclaim skips these
	 * so we don't hammer the mint; a manual retry resets the flag.
	 */
	reclaimPermanentlyFailed?: boolean
}

/**
 * Entry structure when proofs are grouped by mint in wallet state dump.
 */
export interface ProofEntry {
	mint: string
	proofs: Proof[]
}
