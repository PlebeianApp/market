/**
 * Validator state — in-memory model the auction-validator daemon keeps
 * to derive kind-30440 verdicts.
 *
 * The validator is a passive Nostr subscriber; it doesn't own
 * authoritative state. The relays + the Cashu mint are the sources of
 * truth. This state is the *derived* view we maintain to decide
 * what verdict to publish next.
 *
 * Process-restart safety: everything here is rebuilt on subscribe.
 * Kind-30440 is parameterised-replaceable (d-tag = `<bidder>:<auction
 * root>`), so re-emitting an identical verdict is a no-op for relays
 * and clients. Restart re-derives + re-publishes → eventually
 * consistent without a journal.
 *
 * No DB. No persistence. Memory-only.
 */

import type { Nut7ProofState, ValidatorClaim, ValidatorReason } from '../../lib/auction/constants'
import { auctionImmutableFieldsMatch } from '../../lib/auction/immutability'
import type { ParsedAuctionEvent, ParsedBidEvent, ParsedPathReleaseEvent, ParsedSettlementEvent } from '../../lib/auction/events'

// ============================================================================
// Per-bid state
// ============================================================================

/**
 * Per-proof NUT-7 snapshot. We keep one of these per `proof_y` in the
 * bid so a partial poll (e.g. mint returned 3 of 4 Ys) doesn't
 * overwrite all four with stale data.
 */
export interface ProofStateSnapshot {
	state: Nut7ProofState
	observedAt: number
}

/**
 * Aggregate of a bid's individual proof states. Worst-case semantics:
 *  - `spent` if ANY proof is spent (pre-settlement → fraudulent).
 *  - `unspent` if ALL proofs are unspent.
 *  - `missing` if no proof is spent and at least one proof is absent
 *    from an otherwise successful mint response.
 *  - `pending` if no proof is spent/missing and at least one is pending.
 *  - `unknown` otherwise (no signal yet for at least one proof).
 */
export type AggregateProofState = Nut7ProofState

export const aggregateProofStates = (perProof: Map<string, ProofStateSnapshot>, expectedProofYs: string[]): AggregateProofState => {
	if (!expectedProofYs.length) return 'unknown'
	let sawPending = false
	let sawMissing = false
	let allUnspent = true
	for (const y of expectedProofYs) {
		const snap = perProof.get(y.toLowerCase())
		if (!snap || snap.state === 'unknown') {
			allUnspent = false
			continue
		}
		if (snap.state === 'spent') return 'spent'
		if (snap.state === 'missing') {
			sawMissing = true
			allUnspent = false
			continue
		}
		if (snap.state === 'pending') sawPending = true
		if (snap.state !== 'unspent') allUnspent = false
	}
	if (allUnspent) return 'unspent'
	if (sawMissing) return 'missing'
	if (sawPending) return 'pending'
	return 'unknown'
}

export interface ValidatorBidState {
	bid: ParsedBidEvent
	/** Unix seconds when this validator first observed the bid event. */
	observedAt: number

	/**
	 * NUT-7 snapshots per `proof_y` (lowercased). Empty until the
	 * poller's first round-trip; updated incrementally as polls return.
	 */
	nut7States: Map<string, ProofStateSnapshot>

	/**
	 * Most-recently-computed verdict. `null` before any verdict has
	 * been derived (initial-load gap before first publish).
	 */
	currentClaim: ValidatorClaim | null
	currentReason: ValidatorReason | string | undefined
	currentDetail: string | undefined
	lastPublishedAt: number | null

	/** Set by the close lifecycle once the auction's `max_end_at` elapses. */
	postCloseDecision: 'winner' | 'loser' | null
}

// ============================================================================
// Per-auction state
// ============================================================================

export interface ValidatorAuctionState {
	rootAuction: ParsedAuctionEvent
	auction: ParsedAuctionEvent
	contextStatus: AuctionContextStatus
	mintReachability: Map<string, MintReachabilityStatus>

	/** bidEventId -> per-bid state. */
	bids: Map<string, ValidatorBidState>

	/** Seller's kind-1024, when observed. */
	settlement: ParsedSettlementEvent | null

	/** bidEventId -> kind-1025 from the bidder, when observed. */
	pathReleases: Map<string, ParsedPathReleaseEvent>

	/** bidEventId -> unix seconds when this validator first observed the kind-1025. */
	pathReleaseObservedAt: Map<string, number>

	// ---- Lifecycle markers -------------------------------------------------

	/** True once the close lifecycle has assigned winner/loser roles. */
	closeHandled: boolean

	/**
	 * True once the winning bidder has either settled (kind-1025
	 * published) or been declared `griefed` (terminal). Once true the
	 * close lifecycle no longer needs to re-evaluate.
	 */
	winnerHandled: boolean

	/**
	 * Unix seconds when this validator emitted `griefed_pending_fallback`
	 * for the winner, or `null` if it hasn't yet. Used to avoid
	 * re-emitting it on every tick.
	 */
	fallbackOfferedAt: number | null
}

export type AuctionContextStatus = 'pending_mint_check' | 'active'

export type MintReachabilityStatus = 'reachable' | 'unreachable'

// ============================================================================
// Top-level state
// ============================================================================

export interface ValidatorState {
	/** This validator's own Nostr pubkey. */
	validatorPubkey: string

	/** auctionRootEventId -> per-auction state. */
	auctions: Map<string, ValidatorAuctionState>

	/**
	 * Canonical auction coordinate (`30408:<seller>:<d>`) -> pinned
	 * `rootEventId`. Lets an addressable replacement that carries a
	 * *new* event id and no `auction_root_event_id` tag resolve to the
	 * existing pinned auction instead of being inserted as a second
	 * auction. The coordinate includes the seller pubkey, so distinct
	 * sellers sharing a `d` tag never collide here.
	 */
	auctionsByCoordinate: Map<string, string>
}

// ============================================================================
// State mutators (pure — no I/O)
// ============================================================================

export const createValidatorState = (validatorPubkey: string): ValidatorState => ({
	validatorPubkey,
	auctions: new Map(),
	auctionsByCoordinate: new Map(),
})

export interface UpsertAuctionResult {
	auctionState: ValidatorAuctionState
	status: 'inserted' | 'updated' | 'rejected_immutable'
}

/**
 * Identity check for a candidate that carries the original
 * `auction_root_event_id` tag (so `candidate.rootEventId` equals the
 * pinned root). Every identity field — root id, seller, `d` tag,
 * `kind:pubkey:d` coordinate, and signer — must match the pinned
 * auction.
 */
const sameAuctionIdentity = (root: ParsedAuctionEvent, candidate: ParsedAuctionEvent): boolean => {
	if (root.rootEventId !== candidate.rootEventId) return false
	return sameAuctionCoordinate(root, candidate)
}

/**
 * Coordinate-only identity check for a normal addressable replacement
 * that has a *new* event id and no `auction_root_event_id` tag. Such a
 * replacement legitimately changes `rootEventId`, so we pin to the
 * original root and verify the addressable identity instead: seller,
 * `d` tag, `kind:pubkey:d` coordinate, and signer. A different valid
 * signer or coordinate cannot replace the pinned auction.
 */
const sameAuctionCoordinate = (root: ParsedAuctionEvent, candidate: ParsedAuctionEvent): boolean => {
	if (root.sellerPubkey.toLowerCase() !== candidate.sellerPubkey.toLowerCase()) return false
	if (root.dTag !== candidate.dTag) return false
	if (root.coordinate !== candidate.coordinate) return false
	if (root.rawEvent.kind !== candidate.rawEvent.kind) return false
	if (root.rawEvent.pubkey.toLowerCase() !== candidate.rawEvent.pubkey.toLowerCase()) return false
	return true
}

/**
 * Register an auction we should track. Idempotent: if the auction is
 * already tracked, update the parsed event (handles re-publish of
 * mutable tags) and return the existing state.
 *
 * Resolution order:
 *   1. By pinned `rootEventId` (first publish, and replacements that
 *      carry `auction_root_event_id`).
 *   2. By canonical coordinate `30408:<seller>:<d>` — a normal
 *      addressable replacement with a new event id and no root tag
 *      resolves to the existing pinned auction instead of being
 *      inserted as a second auction. The pinned root event id is
 *      retained; only the mutable parsed event refreshes.
 */
export const upsertAuction = (state: ValidatorState, auction: ParsedAuctionEvent): UpsertAuctionResult => {
	// 1. Resolve by pinned root event id.
	let existing = state.auctions.get(auction.rootEventId) ?? null
	let resolvedByCoordinate = false

	// 2. Resolve by canonical coordinate for an addressable
	//    replacement whose new event id is not yet pinned.
	if (!existing) {
		const pinnedRootId = state.auctionsByCoordinate.get(auction.coordinate)
		if (pinnedRootId !== undefined) {
			existing = state.auctions.get(pinnedRootId) ?? null
			resolvedByCoordinate = existing !== null
		}
	}

	if (existing) {
		const identityOk = resolvedByCoordinate
			? sameAuctionCoordinate(existing.rootAuction, auction)
			: sameAuctionIdentity(existing.rootAuction, auction)
		if (!identityOk) {
			return { auctionState: existing, status: 'rejected_immutable' }
		}
		if (!auctionImmutableFieldsMatch(existing.rootAuction.rawEvent, auction.rawEvent)) {
			return { auctionState: existing, status: 'rejected_immutable' }
		}
		// Refresh the parsed event but keep the pinned root auction and
		// all accumulated bid/settlement state.
		existing.auction = auction
		return { auctionState: existing, status: 'updated' }
	}

	// New lineage: pin this first event as the root.
	const fresh: ValidatorAuctionState = {
		rootAuction: auction,
		auction,
		contextStatus: 'pending_mint_check',
		mintReachability: new Map(auction.mints.map((mintUrl) => [mintUrl, 'unreachable' as const])),
		bids: new Map(),
		settlement: null,
		pathReleases: new Map(),
		pathReleaseObservedAt: new Map(),
		closeHandled: false,
		winnerHandled: false,
		fallbackOfferedAt: null,
	}
	state.auctions.set(auction.rootEventId, fresh)
	state.auctionsByCoordinate.set(auction.coordinate, auction.rootEventId)
	return { auctionState: fresh, status: 'inserted' }
}

export const setAuctionMintReachability = (
	auctionState: ValidatorAuctionState,
	reachability: ReadonlyArray<readonly [string, boolean]>,
): void => {
	const next = new Map<string, MintReachabilityStatus>()
	for (const [mintUrl, isReachable] of reachability) {
		next.set(mintUrl, isReachable ? 'reachable' : 'unreachable')
	}
	for (const mintUrl of auctionState.rootAuction.mints) {
		if (!next.has(mintUrl)) next.set(mintUrl, 'unreachable')
	}
	auctionState.mintReachability = next
	auctionState.contextStatus = Array.from(next.values()).some((status) => status === 'reachable') ? 'active' : 'pending_mint_check'
}

/**
 * Register a bid against an auction we already know about. Returns
 * the per-bid state. If we don't know the auction, returns `null` —
 * the subscriber will retry once the auction event arrives.
 *
 * `observedAt` is the validator's local timestamp at first-sight; we
 * never overwrite it on later observations (so timestamp_skew checks
 * stay deterministic).
 */
export const upsertBid = (
	state: ValidatorState,
	bid: ParsedBidEvent,
	observedAt: number,
): { auctionState: ValidatorAuctionState; bidState: ValidatorBidState } | null => {
	const auctionState = state.auctions.get(bid.auctionRootEventId)
	if (!auctionState) return null

	const existing = auctionState.bids.get(bid.id)
	if (existing) {
		// Bids are regular events (not replaceable); same id means
		// duplicate delivery — keep the original record.
		return { auctionState, bidState: existing }
	}
	const fresh: ValidatorBidState = {
		bid,
		observedAt,
		nut7States: new Map(),
		currentClaim: null,
		currentReason: undefined,
		currentDetail: undefined,
		lastPublishedAt: null,
		postCloseDecision: null,
	}
	auctionState.bids.set(bid.id, fresh)
	return { auctionState, bidState: fresh }
}

/** Result of attempting to record a kind-1025 path release. */
export type RecordPathReleaseResult =
	| { status: 'recorded'; auctionState: ValidatorAuctionState }
	| { status: 'unknown_bid' }
	| { status: 'wrong_author' }

/**
 * Record a kind-1025 path release. The release is only stored once the
 * referenced bid is resolved **and** the authenticated signer matches
 * that bid's bidder pubkey — a correctly-signed third-party release
 * must not overwrite an honest bidder's selected release. Wrong-author
 * evidence is dropped without influencing state or reputation; the
 * caller distinguishes `unknown_bid` (ordering gap → buffer + replay)
 * from `wrong_author` (drop, do not buffer).
 *
 * On replay (after the bid lands) the same authorization is re-applied.
 */
export const recordPathRelease = (
	state: ValidatorState,
	release: ParsedPathReleaseEvent,
	observedAt: number,
): RecordPathReleaseResult => {
	// Path release references the bid event (`e` tag → bidEventId).
	// Find the owning auction for that bid.
	for (const auctionState of Array.from(state.auctions.values())) {
		const bidState = auctionState.bids.get(release.bidEventId)
		if (!bidState) continue
		if (release.bidderPubkey.toLowerCase() !== bidState.bid.bidderPubkey.toLowerCase()) {
			return { status: 'wrong_author' }
		}
		auctionState.pathReleases.set(release.bidEventId, release)
		const existingObservedAt = auctionState.pathReleaseObservedAt.get(release.bidEventId)
		if (existingObservedAt === undefined || observedAt < existingObservedAt) {
			auctionState.pathReleaseObservedAt.set(release.bidEventId, observedAt)
		}
		return { status: 'recorded', auctionState }
	}
	return { status: 'unknown_bid' }
}

/** Result of attempting to record a kind-1024 settlement. */
export type RecordSettlementResult =
	| { status: 'recorded'; auctionState: ValidatorAuctionState }
	| { status: 'unknown_auction' }
	| { status: 'wrong_seller' }

/**
 * Record a kind-1024 settlement. The single settlement slot is only
 * overwritten once the authenticated signer matches the pinned auction
 * seller — a correctly-signed non-seller event must not replace valid
 * seller evidence. `unknown_auction` (ordering gap → buffer + replay)
 * is distinct from `wrong_seller` (drop, do not buffer); replay
 * re-applies the same authorization.
 */
export const recordSettlement = (state: ValidatorState, settlement: ParsedSettlementEvent): RecordSettlementResult => {
	const auctionState = state.auctions.get(settlement.auctionRootEventId)
	if (!auctionState) return { status: 'unknown_auction' }
	if (settlement.sellerPubkey.toLowerCase() !== auctionState.rootAuction.sellerPubkey.toLowerCase()) {
		return { status: 'wrong_seller' }
	}
	auctionState.settlement = settlement
	return { status: 'recorded', auctionState }
}

/**
 * Record an updated NUT-7 state for a specific Y under a bid. Returns
 * the snapshot we stored. Lowercases the key so the lookup matches
 * however the mint cased its response.
 */
export const recordNut7State = (
	bidState: ValidatorBidState,
	proofY: string,
	state: Nut7ProofState,
	observedAt: number,
): ProofStateSnapshot => {
	const snap: ProofStateSnapshot = { state, observedAt }
	bidState.nut7States.set(proofY.toLowerCase(), snap)
	return snap
}

/**
 * Mark a verdict as published. The publisher calls this after
 * successfully sending the kind-30440 event.
 */
export const markVerdictPublished = (
	bidState: ValidatorBidState,
	claim: ValidatorClaim,
	reason: ValidatorReason | string | undefined,
	detail: string | undefined,
	at: number,
): void => {
	bidState.currentClaim = claim
	bidState.currentReason = reason
	bidState.currentDetail = detail
	bidState.lastPublishedAt = at
}

/**
 * Convenience: collect every (auction, bid) tuple where the bid is
 * still "live" and the bid's selected mint is currently reachable.
 * Used by the NUT-7 poller to decide what to query.
 */
export const collectLiveBids = (
	state: ValidatorState,
	now: number,
): Array<{
	auctionState: ValidatorAuctionState
	bidState: ValidatorBidState
}> => {
	const out: Array<{ auctionState: ValidatorAuctionState; bidState: ValidatorBidState }> = []
	for (const auctionState of Array.from(state.auctions.values())) {
		// After settlement_grace expires we don't care about NUT-7
		// state anymore — the bid has either been settled or the
		// timelock refund window opened.
		if (now > auctionState.auction.maxEndAt + auctionState.auction.settlementGrace) continue
		for (const bidState of Array.from(auctionState.bids.values())) {
			if (isTerminalClaim(bidState.currentClaim)) continue
			if (auctionState.mintReachability.get(bidState.bid.mint) !== 'reachable') continue
			out.push({ auctionState, bidState })
		}
	}
	return out
}

/**
 * Terminal claims — once a bid lands in one of these, the verdict
 * doesn't change again. The poller skips them, the lifecycle stops
 * re-evaluating them.
 */
const TERMINAL_CLAIMS = new Set<ValidatorClaim>(['settled_promptly', 'settled_late', 'griefed', 'fraudulent_bid', 'cancelled'])

export const isTerminalClaim = (claim: ValidatorClaim | null): boolean => {
	if (!claim) return false
	return TERMINAL_CLAIMS.has(claim)
}
