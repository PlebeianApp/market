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
import { loadUserData, saveUserData, type SaveUserDataOptions } from '../wallet/storage'

const BIDDER_RECORDS_KEY = 'auction_bidder_records_v1'

// #1235 round-3 B1 — pre-lock recovery record store. Bounded at 25 entries
// but (unlike the republish cache) NEVER evicts: records are short-lived
// (removed once the full bidder record supersedes them, on a provably-
// pre-mint lock failure, or after a successful reclaim), and at the bound a
// persist of a NEW record fails closed instead of silently deleting a
// still-pending leg's refund key (see persistPreLockRecoveryRecordMap).
const PRE_LOCK_RECOVERY_RECORDS_KEY = 'auction_bid_pre_lock_recovery_v1'
const PRE_LOCK_RECOVERY_RECORDS_MAX_ENTRIES = 25

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

export const saveBidderRecords = (records: BidderBidRecord[], options?: SaveUserDataOptions): void =>
	saveUserData(BIDDER_RECORDS_KEY, records, options)

/**
 * Insert or overwrite by `bidEventId`.
 *
 * #1235 follow-up (fail-closed bidder records): STRICT persistence. This
 * record is the ONLY durable copy of the locked leg's refund private key
 * and full locked proofs — a silent storage failure (quota, disabled
 * storage, no user scope) would strand the locked leg with no recoverable
 * refund key while the publish pipeline otherwise continued (and could
 * even succeed). The strict write rethrows so the bid publish flow fails
 * CLOSED instead of publishing a locked leg without a durable recovery
 * record. Other record writes (status updates, removals) keep the
 * historical swallow-by-default behavior.
 */
export const upsertBidderRecord = (record: BidderBidRecord): void => {
	const records = loadBidderRecords()
	const existing = records.findIndex((r) => r.bidEventId === record.bidEventId)
	if (existing >= 0) {
		records[existing] = record
	} else {
		records.push(record)
	}
	saveBidderRecords(records, { strict: true })
}

export const findBidderRecord = (bidEventId: string): BidderBidRecord | undefined => {
	return loadBidderRecords().find((r) => r.bidEventId === bidEventId)
}

/**
 * Find the bidder record whose `refundPubkey` matches the given hex
 * pubkey. Used by the reclaim flow: each bid leg generates a fresh
 * refund keypair, persisted as `refundPrivateKey` here. The NIP-60
 * wallet's `privkeys` map doesn't track those (we don't want refund
 * keys polluting the wallet's general signing keys), so reclaim falls
 * back here to recover the privkey at locktime.
 *
 * Matches are case-insensitive — pubkeys are hex, but downstream
 * callers may pass them with different casing depending on whether
 * they came from a tag or the wallet store.
 */
export const findBidderRecordByRefundPubkey = (refundPubkey: string): BidderBidRecord | undefined => {
	const needle = refundPubkey.trim().toLowerCase()
	if (!needle) return undefined
	return loadBidderRecords().find((r) => r.refundPubkey.toLowerCase() === needle)
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

// ---------- #1235 round-3 B1: pre-lock recovery records -------------------

/**
 * Recovery material for an auction bid leg, persisted BEFORE the mint lock
 * call that could consume it (#1235 round-3 B1).
 *
 * Once `lockAuctionBidFunds` may have sent a swap/lock request to the mint,
 * failure handling must assume the mint mutated state (inputs consumed,
 * P2PK-locked proofs issued). The ONLY durable copy of the leg's refund
 * private key must already be on disk at that point — without it the locked
 * leg is not even timelock-reclaimable (the refund branch requires the refund
 * privkey). This record is that durable copy: it is written with
 * CONFIRMED-WRITE semantics (strict save + read-back equality — see
 * {@link persistPreLockRecoveryRecord}) before the lock call, and removed
 * once the full {@link BidderBidRecord} supersedes it (the leg became
 * publishable), on a provably-pre-mint lock failure, or after a successful
 * reclaim.
 *
 * NOTE (deliberately scoped): the record contains NO proof set — the locked
 * proofs themselves live in the wallet's pending-token store once the lock
 * returns. This is application data the auction domain must own (refund-key
 * material, identifiers, derivation paths, lock metadata), not a second
 * spendable-proof authority.
 */
export interface AuctionBidPreLockRecoveryRecord {
	/** Locally generated record id (uuid) — carried by AuctionBidLockOutcomeUncertainError. */
	id: string
	/** When the record was written (unix ms). */
	createdAt: number
	/** Root auction event id (kind-30408). */
	auctionEventId: string
	/** Auction coordinate `30408:<seller>:<d>` — named `auctionCoordinates` (the form-data name), NOT the bidder record's `auctionCoordinate`. */
	auctionCoordinates: string
	/** Seller's Nostr pubkey. */
	sellerPubkey: string
	/** Seller's auction HD xpub. */
	p2pkXpub: string
	/** Bidder-chosen derivation path for this leg. */
	derivationPath: string
	/** `derive(p2pk_xpub, derivationPath)` — the lock pubkey. */
	childPubkey: string
	/** Bidder's refund pubkey (compressed secp256k1 hex); the map key. */
	refundPubkey: string
	/** Bidder's refund private key (hex) — the recovery authority this record protects. */
	refundPrivateKey: string
	/** Best-effort pre-lock mint hint (first declared candidate) — diagnostic only. */
	mintUrl: string
	/** Sats this leg intends to lock (the delta). */
	legLockAmount: number
	/** Cumulative bid value this leg commits to. */
	cumulativeAmount: number
	/** Cashu locktime in unix seconds. */
	locktime: number
	/** Previous leg's bid event id when this is a rebid chain leg. */
	prevBidEventId: string | null
}

/** Pre-lock recovery records, keyed by refund pubkey. */
type PreLockRecoveryRecordMap = Record<string, AuctionBidPreLockRecoveryRecord>

export const loadPreLockRecoveryRecords = (): PreLockRecoveryRecordMap =>
	loadUserData<PreLockRecoveryRecordMap>(PRE_LOCK_RECOVERY_RECORDS_KEY, {})

const persistPreLockRecoveryRecordMap = (map: PreLockRecoveryRecordMap): void => {
	// #1235 round-3 fix 4 (felixfelix #5) — FAIL CLOSED at the bound, never
	// evict. The old oldest-first eviction silently deleted the refund key of
	// a still-pending leg the moment a 26th record arrived. Each recovery
	// record is the ONLY durable copy of its leg's refund private key from
	// before the mint call — deleting one is never safe. A NEW key pushing
	// the map past the bound throws BEFORE saveUserData; the publish layer
	// maps the throw to AuctionBidPreLockRecordWriteFailedError and aborts
	// with zero mint interaction (safe re-submit). Superseding an EXISTING
	// key keeps the entry count unchanged, so in-place updates still succeed
	// at the bound (the publish flow's supersede path relies on that).
	if (Object.keys(map).length > PRE_LOCK_RECOVERY_RECORDS_MAX_ENTRIES) {
		throw new Error(
			`Pre-lock recovery record store is full (${PRE_LOCK_RECOVERY_RECORDS_MAX_ENTRIES} entries) — ` +
				'refusing to persist a NEW recovery record instead of evicting an existing one. ' +
				"Each record is the only durable copy of a pending leg's refund key. Nothing was locked; re-submitting the bid once the store has room is safe.",
		)
	}
	saveUserData(PRE_LOCK_RECOVERY_RECORDS_KEY, map, { strict: true })
}

/**
 * Persist a pre-lock recovery record with CONFIRMED-WRITE semantics
 * (#1235 round-3 B1).
 *
 * The write is only "confirmed" when BOTH the strict save succeeded AND a
 * read-back of the user-scoped store returns a record that deep-equals the
 * one we intended to write. Any throw or mismatch propagates — callers must
 * treat the record as NOT durably present and must NOT proceed to the mint
 * call that could consume the recovery material.
 */
export const persistPreLockRecoveryRecord = (record: AuctionBidPreLockRecoveryRecord): void => {
	const map = { ...loadPreLockRecoveryRecords() }
	// Map keys are normalized to lowercase hex so the case-insensitive lookup
	// in findPreLockRecoveryRecordByRefundPubkey always hits.
	map[record.refundPubkey.trim().toLowerCase()] = record
	persistPreLockRecoveryRecordMap(map)

	const readBack = loadPreLockRecoveryRecords()[record.refundPubkey]
	if (!readBack || JSON.stringify(readBack) !== JSON.stringify(record)) {
		throw new Error(
			`Failed to confirm the pre-lock recovery record write for refund pubkey ${record.refundPubkey} ` +
				'(read-back mismatch — the record is not durably present).',
		)
	}
}

export const removePreLockRecoveryRecord = (refundPubkey: string): void => {
	const map = { ...loadPreLockRecoveryRecords() }
	if (!(refundPubkey in map)) return
	delete map[refundPubkey]
	// Removal is best-effort (the default swallow semantics): a failed removal
	// leaves a stale recovery record behind — harmless for money safety (it is
	// superseded by the full bidder record or by a provably-pre-mint failure)
	// and still a valid refund authority if it ever gets used.
	saveUserData(PRE_LOCK_RECOVERY_RECORDS_KEY, map)
}

export const findPreLockRecoveryRecordByRefundPubkey = (refundPubkey: string): AuctionBidPreLockRecoveryRecord | undefined => {
	const needle = refundPubkey.trim().toLowerCase()
	if (!needle) return undefined
	return loadPreLockRecoveryRecords()[needle]
}
