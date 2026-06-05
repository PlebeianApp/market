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
	/** Bid amount in sats (sum of locked proof amounts). */
	amount: number
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
