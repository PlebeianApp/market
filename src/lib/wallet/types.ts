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

/**
 * A multiparty (V4V) bid leg's pending-token context.
 *
 * Its own `kind` rather than extra optional fields on the single-party context, because a multiparty
 * leg is **one token per manifest row** and the lock key is per row: the single-party shape carries one
 * `lockPubkey`/`childPubkey` pair, and bolting a row index onto it would leave every existing reader
 * reading a token that describes only one of the leg's rows. Kept additive — no existing reader is
 * changed by adding a kind to the union, and nothing constructs this one yet.
 */
export interface AuctionMultipartyBidPendingTokenContext {
	kind: 'auction_bid_multiparty'
	auctionEventId: string
	auctionCoordinates?: string
	bidEventId?: string
	sellerPubkey: string
	pathIssuerPubkey: string
	/** The leg's refund authority (compressed secp256k1 hex) — the same on every row of the leg. */
	refundPubkey: string
	/** The leg's shared locktime, identical on every row. */
	locktime: number
	/** The leg's shared derivation path (D8: one path, per-recipient xpub). */
	derivationPath: string
	/** The manifest row this token's proofs belong to. */
	rowManifestIndex: number
	/**
	 * This row's lock key, **compressed** — the form that carries the parity, and the one a reclaim
	 * needs to rebuild the row's lock secret. The x-only projection is not stored: it can be derived
	 * from this, and only this direction is safe.
	 */
	rowChildPubkeyCompressed: string
	grantId?: string
}

export type PendingTokenContext = AuctionBidPendingTokenContext | AuctionMultipartyBidPendingTokenContext

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
