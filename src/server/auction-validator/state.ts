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
}

// ============================================================================
// State mutators (pure — no I/O)
// ============================================================================

export const createValidatorState = (validatorPubkey: string): ValidatorState => ({
	validatorPubkey,
	auctions: new Map(),
})

export interface UpsertAuctionResult {
	auctionState: ValidatorAuctionState
	status: 'inserted' | 'updated' | 'rejected_immutable'
}

/**
 * Register an auction we should track. Idempotent: if the auction is
 * already tracked, update the parsed event (handles re-publish of
 * mutable tags) and return the existing state.
 */
export const upsertAuction = (state: ValidatorState, auction: ParsedAuctionEvent): UpsertAuctionResult => {
	const existing = state.auctions.get(auction.rootEventId)
	if (existing) {
		if (!auctionImmutableFieldsMatch(existing.rootAuction.rawEvent, auction.rawEvent)) {
			return { auctionState: existing, status: 'rejected_immutable' }
		}
		// Refresh the parsed event but keep accumulated bid state.
		existing.auction = auction
		return { auctionState: existing, status: 'updated' }
	}
	const fresh: ValidatorAuctionState = {
		rootAuction: auction,
		auction,
		contextStatus: 'pending_mint_check',
		mintReachability: new Map(auction.mints.map((mintUrl) => [mintUrl, 'unreachable' as const])),
		bids: new Map(),
		settlement: null,
		pathReleases: new Map(),
		closeHandled: false,
		winnerHandled: false,
		fallbackOfferedAt: null,
	}
	state.auctions.set(auction.rootEventId, fresh)
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
	auctionState.contextStatus = Array.from(next.values()).every((status) => status === 'reachable') ? 'active' : 'pending_mint_check'
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

/** Record a kind-1025 path release. Returns the auction state, or `null` when unknown. */
export const recordPathRelease = (state: ValidatorState, release: ParsedPathReleaseEvent): ValidatorAuctionState | null => {
	// Path release references the bid event (`e` tag → bidEventId).
	// Find the owning auction by scanning auctions for that bid.
	for (const auctionState of Array.from(state.auctions.values())) {
		if (auctionState.bids.has(release.bidEventId)) {
			auctionState.pathReleases.set(release.bidEventId, release)
			return auctionState
		}
	}
	return null
}

/** Record a kind-1024 settlement. */
export const recordSettlement = (state: ValidatorState, settlement: ParsedSettlementEvent): ValidatorAuctionState | null => {
	const auctionState = state.auctions.get(settlement.auctionRootEventId)
	if (!auctionState) return null
	auctionState.settlement = settlement
	return auctionState
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
 * still "live" (no terminal verdict and the auction hasn't ended).
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
		if (auctionState.contextStatus !== 'active') continue
		// After settlement_grace expires we don't care about NUT-7
		// state anymore — the bid has either been settled or the
		// timelock refund window opened.
		if (now > auctionState.auction.maxEndAt + auctionState.auction.settlementGrace) continue
		for (const bidState of Array.from(auctionState.bids.values())) {
			if (isTerminalClaim(bidState.currentClaim)) continue
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
