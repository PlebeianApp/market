/**
 * Bidder-side persistent record for each placed bid.
 *
 * Under `cashu_p2pk_bidder_path_v1` the bidder holds the derivation
 * path locally — losing it means the seller can't redeem the bid even
 * if the bidder wins. The bidder also holds the locked Cashu proofs
 * (full proofs including the `C` value) so they can refund via the
 * timelock branch if they grief or the seller is unreachable.
 *
 * Everything lives under user-scoped localStorage via the existing
 * wallet/storage helpers, so each Nostr identity has its own record
 * set and switching accounts doesn't bleed bid state across users.
 *
 * Threat model: the records contain the locked proofs (bearer
 * material) and the refund private key (used to claim the timelock
 * branch). Both are already locally-stored secrets in the user's
 * wallet; we're just adding auction-specific context on top.
 */

import type { Proof } from '@cashu/cashu-ts'
import { loadUserData, saveUserData } from '../wallet/storage'

const BIDDER_RECORDS_KEY = 'auction_bidder_records_v1'

export type BidderRecordStatus = 'live' | 'settled' | 'refunded' | 'griefed' | 'cancelled'

export interface BidderBidRecord {
	/** kind-1023 bid event id; doubles as the lookup key. */
	bidEventId: string
	/** Root auction event id (kind-30408). */
	auctionRootEventId: string
	/** Auction coordinate `30408:<seller>:<d>`. */
	auctionCoordinate: string
	/** Seller's Nostr pubkey. */
	sellerPubkey: string
	/** Seller's auction HD xpub (so we can sanity-check derivation later). */
	p2pkXpub: string

	/** Bidder-chosen high-entropy derivation path. Kept secret until kind-1025. */
	derivationPath: string
	/** `derive(p2pk_xpub, derivationPath)` — the lock pubkey. */
	childPubkey: string

	/** Bidder's refund pubkey (compressed secp256k1 hex). */
	refundPubkey: string
	/**
	 * Bidder's refund private key (hex, 64 chars). Needed to sign the
	 * timelock refund branch. The wallet already stores private keys
	 * locally; we colocate the per-bid refund key here so refund flows
	 * don't have to traverse a separate key store.
	 */
	refundPrivateKey: string

	/** Mint URL the locked proofs belong to. */
	mintUrl: string
	/**
	 * Cumulative bid value this leg commits to (sats). Matches the kind-
	 * 1023 event's `amount` tag and what the validator uses for the
	 * min-increment check. On a rebid this is the new total bid, NOT the
	 * delta that this leg locks.
	 */
	amount: number
	/**
	 * Sats actually locked at the mint by THIS leg. Equals the sum of
	 * `proofs[].amount`. On a chain's first leg this equals `amount`; on
	 * subsequent legs it's the delta `amount - prev_leg.amount`. Settling
	 * the chain redeems each leg's `legLockedAmount` independently — the
	 * total redeemed equals the latest leg's `amount` (cumulative bid).
	 */
	legLockedAmount: number
	/**
	 * Previous leg's bid event id, when this is part of a rebid chain.
	 * Mirrors the kind-1023 `prev_bid` tag. `null` on chain root.
	 */
	prevBidEventId: string | null
	/** Cashu locktime in unix seconds. */
	locktime: number

	/**
	 * Full locked Cashu proofs (one or more). Used to redeem via the
	 * timelock refund branch after `locktime` if the seller never
	 * settled; also referenced for diagnostics.
	 */
	proofs: Proof[]

	/** Derived from proofs — parallel arrays for quick lookup. */
	lockSecrets: string[]
	proofYs: string[]

	/** When the bid was placed (unix seconds). */
	createdAt: number
	/**
	 * Lifecycle status. `live` until either the seller redeems
	 * (`settled`), the bidder refunds via timelock (`refunded`), or the
	 * auction is cancelled (`cancelled`). `griefed` is marked when the
	 * bidder skipped a winning settlement past `settlement_grace`.
	 */
	status: BidderRecordStatus
}

// ---------- CRUD --------------------------------------------------------

export const loadBidderRecords = (): BidderBidRecord[] => loadUserData<BidderBidRecord[]>(BIDDER_RECORDS_KEY, [])

export const saveBidderRecords = (records: BidderBidRecord[]): void => saveUserData(BIDDER_RECORDS_KEY, records)

/** Insert or overwrite by `bidEventId`. */
export const upsertBidderRecord = (record: BidderBidRecord): void => {
	const records = loadBidderRecords()
	const existing = records.findIndex((r) => r.bidEventId === record.bidEventId)
	if (existing >= 0) {
		records[existing] = record
	} else {
		records.push(record)
	}
	saveBidderRecords(records)
}

export const findBidderRecord = (bidEventId: string): BidderBidRecord | undefined => {
	return loadBidderRecords().find((r) => r.bidEventId === bidEventId)
}

export const findBidderRecordsForAuction = (auctionRootEventId: string): BidderBidRecord[] => {
	return loadBidderRecords().filter((r) => r.auctionRootEventId === auctionRootEventId)
}

/**
 * Find the most recent leg (highest `amount` — the cumulative bid value)
 * the current user has on this auction. Used by the bid flow to chain a
 * rebid via the `prev_bid` tag and lock only the delta. Returns `null`
 * when the user hasn't bid here yet.
 */
export const findLatestBidderRecordForAuction = (auctionRootEventId: string): BidderBidRecord | null => {
	const records = findBidderRecordsForAuction(auctionRootEventId)
	if (records.length === 0) return null
	return records.reduce((best, r) => (r.amount > best.amount ? r : best), records[0])
}

/**
 * Walk the rebid chain starting from a given leg, oldest → newest.
 * Each entry is one leg from the local records. Stops at chain root
 * (record with `prevBidEventId === null`) or when an ancestor is
 * missing locally (returns whatever was traversable). Callers should
 * check the final array length against expectations before assuming
 * the chain is complete.
 */
export const walkBidderRecordChain = (latestBidEventId: string): BidderBidRecord[] => {
	const allRecords = loadBidderRecords()
	const byId = new Map(allRecords.map((r) => [r.bidEventId, r]))
	const chain: BidderBidRecord[] = []
	let cursor: string | null = latestBidEventId
	const seen = new Set<string>()
	while (cursor) {
		if (seen.has(cursor)) break // cycle guard
		seen.add(cursor)
		const record = byId.get(cursor)
		if (!record) break
		chain.unshift(record)
		cursor = record.prevBidEventId
	}
	return chain
}

export const updateBidderRecordStatus = (bidEventId: string, status: BidderRecordStatus): BidderBidRecord | null => {
	const records = loadBidderRecords()
	const idx = records.findIndex((r) => r.bidEventId === bidEventId)
	if (idx < 0) return null
	const updated = { ...records[idx], status }
	records[idx] = updated
	saveBidderRecords(records)
	return updated
}

export const removeBidderRecord = (bidEventId: string): void => {
	const records = loadBidderRecords().filter((r) => r.bidEventId !== bidEventId)
	saveBidderRecords(records)
}
