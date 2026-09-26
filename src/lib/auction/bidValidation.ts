import type { Nut7ProofState, ValidatorClaim } from './constants'
import { VALIDATOR_CONFIRM_CLAIMS, VALIDATOR_CONDEMN_CLAIMS } from './constants'
import type { ParsedAuctionEvent, ParsedBidEvent, ParsedValidatorVerdictEvent } from './events'
import { validateBid } from './validation'
import { verifyBidDleqWithKeysets, type DleqProof } from '../cashu/dleq'
import type { MintKeys } from '@cashu/cashu-ts'
import { effectiveVerdictQuorum } from './verdictMajority'

export type BidClassification = 'valid' | 'pending' | 'invalid'

/**
 * Why a bid is `pending`. Optional, and only set for the cases a CONSUMER must
 * act on differently from ordinary quorum-pending (ADR-0011 review A2,
 * PR #1280 discussion_r3999446834).
 *
 * `dleq_evidence_unavailable` means the bid is quorum-confirmed and
 * structurally valid, but the keyset evidence needed to crypto-verify its
 * collateral could not be gathered (mint unreachable). That is a RETRY signal,
 * never a terminal verdict: such a bid is absent from `canonicalWinner`, so
 * consumers that ask "did anything meet the reserve?" must consult this field
 * or they will read "unavailable evidence" as "no such bid".
 */
export type BidPendingReason = 'dleq_evidence_unavailable'

export interface ClassifiedBid {
	bid: ParsedBidEvent
	classification: BidClassification
	observedAt: number
	nut7State?: Nut7ProofState
	invalidReason?: string
	pendingReason?: BidPendingReason
}

export interface TrustedCollateralLeg {
	readonly bid: ParsedBidEvent
	readonly expectedAmount: number
}

export interface ValidatedBidSet {
	classified: ClassifiedBid[]
	validBids: ParsedBidEvent[]
	pendingBids: ParsedBidEvent[]
	invalidBids: ParsedBidEvent[]
	canonicalWinner: ParsedBidEvent | null
	currentTopValidAmount: number
	/** Root-to-candidate collateral metadata for economically accepted bids. */
	trustedCollateralChains?: ReadonlyMap<string, readonly TrustedCollateralLeg[]>
}

/**
 * Pre-publish NUT-7 gate: before the seller publishes a settlement (an
 * irreversible action), verify that every bid in the winning bid chain has
 * NUT-7 evidence that is NOT `spent` (pre-settlement double-spend fraud).
 * The read/display path (`computeValidatedBids`) is lenient — a missing
 * NUT-7 poll leaves a quorum-confirmed bid valid. But the publish path
 * must not let the seller commit to a settlement for a double-spent bid.
 *
 * Returns `null` if the chain passes (safe to publish), or an error message
 * describing the first problem found (spent proof, or missing/unreachable
 * NUT-7 evidence for any leg).
 *
 * `nut7States` is the mint-reported NUT-7 states from `fetchNut7StatesForBids`.
 * `chainBids` is the rebid chain (oldest → newest) from walking `prevBidId`.
 * `now` is the current unix timestamp, used to determine whether a `spent`
 * leg is pre-locktime (already redeemed by this seller — resumable) or
 * post-locktime (ambiguous — could be bidder refund).
 */
export function validateBidChainNut7PrePublish(
	chainBids: ParsedBidEvent[],
	nut7States: Map<string, Nut7ProofState>,
	now: number,
): string | null {
	for (const bid of chainBids) {
		const state = nut7States.get(bid.id)
		if (state === 'spent') {
			// All proofs spent. Pre-locktime, only the seller's child privkey
			// can spend (the refund branch is timelocked), so all-spent
			// pre-locktime IS seller-bound redemption evidence (e.g. a
			// previous settlement attempt that crashed after this leg).
			// Post-locktime the bidder's refund path is also open — then
			// all-spent is ambiguous and we must abort (can't safely settle).
			if (now >= bid.locktime) {
				return `Chain leg ${bid.id.slice(0, 8)}… (${bid.amount} sats) has SPENT proofs post-locktime — ambiguous (could be bidder refund). Cannot safely publish a settlement.`
			}
			// Pre-locktime: already redeemed by this seller → skip, not fraud.
			continue
		}
		if (state === undefined || state === 'unknown') {
			return `Chain leg ${bid.id.slice(0, 8)}… (${bid.amount} sats) has no confirmed NUT-7 state (got ${state ?? 'undefined'}). The mint must confirm all proofs are unspent before publishing a settlement. Retry in a moment.`
		}
		if (state === 'missing') {
			return `Chain leg ${bid.id.slice(0, 8)}… (${bid.amount} sats) — the mint omitted at least one proof from its NUT-7 response. Cannot verify unspent state.`
		}
		if (state === 'pending') {
			// PENDING is an in-flight swap — possibly the bidder's own spend.
			// A leg can flip to SPENT between the gate and the seller's swap.
			// Per ADR-0004 §4.5, treat like unknown (retry), not publishable.
			return `Chain leg ${bid.id.slice(0, 8)}… (${bid.amount} sats) has PENDING NUT-7 state (in-flight swap). Retry when the mint confirms unspent.`
		}
		// 'unspent' → acceptable for publish
	}
	return null
}

export interface ComputeValidatedBidsInput {
	auction: ParsedAuctionEvent
	bids: ParsedBidEvent[]
	verdicts: ParsedValidatorVerdictEvent[]
	/**
	 * NUT-7 proof states from the client's own `checkProofStateBatch` query,
	 * keyed by bid event id. These are mint-reported truth values and are
	 * passed through to `validateBid` unmodified: an absent entry stays
	 * unconfirmed and yields `bid_pending_review` (NUT-7 is NEVER defaulted
	 * to `unspent`/`spent`, and NEVER remapped — see ADR-0004 §3).
	 */
	nut7States?: Map<string, Nut7ProofState>
	/**
	 * Whether a structurally-valid `settled` settlement already exists for
	 * this auction. When true, a mint-reported `spent` on a quorum-confirmed
	 * bid is interpreted by THIS FUNCTION (the consumer of the state) as the
	 * expected terminal condition — 'seller already redeemed' for the winner,
	 * or a legitimate post-locktime refund for losers — instead of
	 * pre-settlement fraud. The `nut7State` value itself is never rewritten;
	 * only the valid/invalid decision accounts for the settlement context.
	 * Defaults to false.
	 */
	postSettlement?: boolean
	/**
	 * Optional narrowing for `postSettlement`: the bid ids recorded in the
	 * `settled` settlement (winner + payout legs). When provided, the
	 * terminal-condition interpretation applies ONLY to those bids — a
	 * drained, higher-amount non-settlement bid (pre-settlement fraud the
	 * validators cannot see) stays invalid instead of displacing the real
	 * winner from `canonicalWinner` and breaking the settlement's structural
	 * cross-checks. Pass the ids from `winning_bid` + `payout` tags.
	 */
	settledBidIds?: Set<string>
	/**
	 * Pre-fetched mint keysets for DLEQ cryptographic verification (ADR-0011
	 * C1). Keyed by `${mintUrl}:${keysetId}` so the verification logic can
	 * look up the `MintKeys` for each bid's `dleqProofs` without async network
	 * calls inside this synchronous pure function. When absent for a post-
	 * rollout bid, DLEQ verification cannot run: the bid is classified
	 * `pending` — non-authoritative (never a `canonicalWinner` candidate),
	 * never valid and never `dleq_invalid` (the evidence has not been gathered
	 * yet, so nothing is being condemned). Same fail-safe direction as NUT-7's
	 * evidence-deferred handling (Decision 6).
	 * The same applies PER KEYSET inside a supplied map: an entry absent from
	 * the map (a failed `fetchDleqKeysetsForBids` fetch — temporary
	 * mint/network failure) leaves the evidence unavailable, so the bid is
	 * classified `pending` (ADR-0011 Decision 6a), never valid. Only a
	 * POSITIVE verification failure over COMPLETE evidence — every referenced
	 * keyset present and the DLEQ crypto check failing — invalidates the bid
	 * (`dleq_invalid`). Pending is not a pass: pending bids are excluded
	 * from `validBids`/winner selection, so a bidder-controlled
	 * `dleqProofs[].id` pointing at an unfetchable keyset can never yield a
	 * winning bid. Callers SHOULD cover every keyset id any accepted bid may
	 * reference (including rotated keysets) and MUST normalize mint URLs
	 * identically to bid parsing so the `${mintUrl}:${keysetId}` key matches
	 * exactly.
	 */
	dleqKeysets?: Map<string, MintKeys>
	/**
	 * `${mintUrl}:${keysetId}` pairs whose keyset fetch failed TERMINALLY — the
	 * mint answered but does not advertise that keyset id (ADR-0011 review R3,
	 * `fetchDleqKeysetsForBidsDetailed`). A bid whose only missing keyset is in
	 * this set names fabricated/foreign collateral, so it is `dleq_invalid`
	 * rather than `pending`. Absent set ⇒ every miss is treated as transient
	 * (`pending`), the pre-R3 behavior.
	 */
	dleqUnknownKeysets?: ReadonlySet<string>
}

/** Verdict claims that confirm a bid as valid (per AUCTIONS.md §4.4.3). Re-exported from constants so the client quorum screen and the validator publisher agree. */
const CONFIRM_CLAIMS = VALIDATOR_CONFIRM_CLAIMS
/** Verdict claims that condemn a bid as invalid. */
const CONDEMN_CLAIMS = VALIDATOR_CONDEMN_CLAIMS

/**
 * A verdict is quorum-eligible only when the validator's own `observed_at`
 * satisfies the same temporal constraints the validator pipeline enforces
 * (AUCTIONS.md §7.1 T2.3/T2.4, ADR-0003 §2.3):
 *
 *   - `observed_at` inside the auction window `[start_at, max_end_at]`, and
 *   - `|bid.created_at - observed_at| <= max_skew_sec`.
 *
 * This is the anti-poisoning gate for verdict timestamps: a malicious
 * validator that publishes a verdict with an inflated `observed_at` (e.g. far
 * past `max_end_at`) simply fails its own timing check and DOES NOT COUNT
 * toward quorum — the bid stays `pending` rather than becoming `invalid`.
 * One bad validator cannot veto a bid; condemning or confirming requires
 * `auditorQuorum` eligible verdicts, and an honest quorum is achieved
 * independently by the remaining validators. (A validator that poisons
 * timestamps also destroys its own reputation and financial incentive.)
 */
function isQuorumEligibleVerdict(v: ParsedValidatorVerdictEvent, bid: ParsedBidEvent, auction: ParsedAuctionEvent): boolean {
	if (v.observedAt < auction.startAt || v.observedAt > auction.maxEndAt) return false
	if (Math.abs(bid.createdAt - v.observedAt) > auction.maxSkewSec) return false
	return true
}

function classifyBid(
	bid: ParsedBidEvent,
	auction: ParsedAuctionEvent,
	eligibleConfirms: ParsedValidatorVerdictEvent[],
	condemnVerdicts: ParsedValidatorVerdictEvent[],
	nut7States?: Map<string, Nut7ProofState>,
): ClassifiedBid {
	// The auction's declared quorum can only ever RAISE the requirement: the
	// strict-majority floor applies here too, so a seller cannot declare a quorum
	// two disjoint groups of validators could each reach. Otherwise this path would
	// be a second, weaker quorum implementation than `computeVerdictQuorum`.
	const quorum = effectiveVerdictQuorum(auction.auditorQuorum, new Set(auction.auditors).size)
	// A `won_pending_settlement` verdict is a strictly stronger assertion than
	// `valid_bid_placed` (the validator confirmed the bid is valid AND is the
	// canonical pending-settlement winner). Both are collected as confirm
	// claims by the caller. Kind-30440 is addressable on
	// `d = bidder:auction:bid` (per-bid, ADR-0003 §4.4.1 amendment), so a
	// validator has exactly one latest verdict per bid. Within a single bid's
	// lifecycle, once the validator upgrades to `won_pending_settlement`, the
	// earlier `valid_bid_placed` is replaced on the relay (same d-tag for the
	// same bid). Counting only `valid_bid_placed` here would make winner
	// determination break the moment validators publish the settlement-ready
	// state that `publishBidderPathRelease` requires.
	if (eligibleConfirms.length >= quorum) {
		return {
			bid,
			classification: 'valid',
			// The client-side re-run (validateBid below) uses the bid's own
			// signed `created_at` rather than any validator timestamp:
			//   - deterministic across clients (relay verdict timing varies;
			//     signed event data does not — AUCTIONS.md §8 tie-breaks are
			//     created_at-based for the same reason);
			//   - always passes the window/skew checks for an in-window bid;
			//   - the curve floor at placement time is never HIGHER than the
			//     floor quorum validators already accepted at their own
			//     (within-skew) observation times, so no quorum-confirmed bid
			//     can be rejected here by the amount check.
			observedAt: bid.createdAt,
			// NUT-7 is passed through truthfully (ADR-0004 §3): unconfirmed
			// stays unconfirmed, `spent` stays `spent`. Consumer logic below
			// accounts for the settlement context when interpreting it.
			nut7State: nut7States?.get(bid.id),
		}
	}

	// Condemnation also requires quorum. A single `bid_invalid` verdict must
	// not veto a bid (same anti-poisoning principle as the confirm side):
	// structural invalidity is deterministic, so honest validators converge on
	// the same condemnation and quorum forms; a lone malicious validator's
	// condemn verdict leaves the bid `pending` instead of `invalid`.
	if (condemnVerdicts.length >= quorum) {
		return {
			bid,
			classification: 'invalid',
			observedAt: bid.createdAt,
			invalidReason: condemnVerdicts[0].reason,
		}
	}

	return {
		bid,
		classification: 'pending',
		observedAt: bid.createdAt,
	}
}

/**
 * The collateral identity keys a bid claims, namespaced per field so a locked
 * secret can never collide with a proof `Y` or a DLEQ `C`. Compared as opaque
 * lowercased hex/JSON strings (the same normalization the M5 rules use).
 */
const collateralClaimKeys = (bid: ParsedBidEvent): string[] => [
	...bid.lockSecrets.map((secret) => `lock_secret:${secret.toLowerCase()}`),
	...bid.proofYs.map((proofY) => `proof_y:${proofY.toLowerCase()}`),
	...(bid.dleqProofs ?? []).flatMap((proof) => (proof.C ? [`dleq_c:${proof.C.toLowerCase()}`] : [])),
]

const MAX_COLLATERAL_CHAIN_LENGTH = 256

type CollateralChainResult = { status: 'valid'; chain: readonly TrustedCollateralLeg[] } | { status: 'pending' } | { status: 'invalid' }

/**
 * Verify the complete collateral history required to make `candidate.amount`
 * economically authoritative. Validator verdicts remain per-bid: ancestors
 * need no inferred quorum, but every sat credited from them must come from a
 * structurally safe same-bidder/same-auction chain leg with valid NUT-12 DLEQ.
 */
function verifyBidCollateralChain(input: {
	candidate: ParsedBidEvent
	auction: ParsedAuctionEvent
	bidsById: ReadonlyMap<string, ParsedBidEvent>
	dleqKeysets?: Map<string, MintKeys>
	dleqUnknownKeysets?: ReadonlySet<string>
	disallowedCollateralBidIds: ReadonlySet<string>
}): CollateralChainResult {
	const { candidate, auction, bidsById, dleqKeysets, dleqUnknownKeysets, disallowedCollateralBidIds } = input
	const bidder = candidate.bidderPubkey.toLowerCase()
	const seen = new Set<string>()
	const chain: Array<{ bid: ParsedBidEvent; requiredAmount: number }> = []
	let current: ParsedBidEvent | undefined = candidate

	while (current) {
		if (chain.length >= MAX_COLLATERAL_CHAIN_LENGTH || seen.has(current.id)) return { status: 'invalid' }
		seen.add(current.id)

		if (
			current.bidderPubkey.toLowerCase() !== bidder ||
			current.auctionRootEventId !== auction.rootEventId ||
			current.auctionCoordinate !== auction.coordinate ||
			disallowedCollateralBidIds.has(current.id)
		) {
			return { status: 'invalid' }
		}

		// Parsed ancestors do not need validator quorum, but they must satisfy
		// the same self-contained structural rules as the directly attested bid.
		if (validateBid({ auction, bid: current, observedAt: current.createdAt }).claim !== 'valid_bid_placed') {
			return { status: 'invalid' }
		}

		let requiredAmount = current.amount
		if (current.prevBidId) {
			const parent = bidsById.get(current.prevBidId)
			if (!parent || parent.amount >= current.amount) return { status: 'invalid' }
			requiredAmount = current.amount - parent.amount
			chain.push({ bid: current, requiredAmount })
			current = parent
			continue
		}

		chain.push({ bid: current, requiredAmount })
		break
	}

	// Keyset absence is classified before crypto verification so transiently
	// incomplete evidence remains pending, preserving ADR-0011 Decision 6a.
	if (!dleqKeysets) return { status: 'pending' }
	let hasTransientMissingKeyset = false
	for (const { bid } of chain) {
		for (const proof of bid.dleqProofs ?? []) {
			const key = `${bid.mint}:${proof.id}`
			if (dleqKeysets.has(key)) continue
			if (dleqUnknownKeysets?.has(key)) return { status: 'invalid' }
			hasTransientMissingKeyset = true
		}
	}
	if (hasTransientMissingKeyset) return { status: 'pending' }

	for (const { bid, requiredAmount } of chain) {
		const proofsWithSecrets: Array<DleqProof & { secret: string }> = (bid.dleqProofs ?? []).map((proof, index) => ({
			...proof,
			secret: bid.lockSecrets[index] ?? '',
		}))
		const result = verifyBidDleqWithKeysets({ mint: bid.mint, legDelta: requiredAmount, proofs: proofsWithSecrets }, dleqKeysets)
		if (!result.ok) return { status: 'invalid' }
	}

	return {
		status: 'valid',
		chain: Object.freeze(chain.reverse().map(({ bid, requiredAmount }) => Object.freeze({ bid, expectedAmount: requiredAmount }))),
	}
}

function computeCanonicalWinner(validBids: ParsedBidEvent[]): ParsedBidEvent | null {
	if (validBids.length === 0) return null

	return validBids.reduce((winner, bid) => {
		if (bid.amount > winner.amount) return bid
		if (bid.amount === winner.amount) {
			// Tie-break per AUCTIONS.md §8.0: earliest `created_at` wins,
			// then lexical smallest bid event id. Deterministic — never
			// relay-state-dependent (observed_at varies by relay, so two
			// compliant clients could otherwise display different winners).
			if (bid.createdAt < winner.createdAt) return bid
			if (bid.createdAt === winner.createdAt && bid.id < winner.id) return bid
		}
		return winner
	})
}

export function computeValidatedBids(input: ComputeValidatedBidsInput): ValidatedBidSet {
	const { auction, bids, verdicts, nut7States } = input
	const postSettlement = input.postSettlement ?? false

	const bidsById = new Map(bids.map((b) => [b.id, b]))

	// Step 1: Screen verdicts. Only auction auditors count, verdicts are
	// deduplicated per (validator, referenced bid) keeping the latest
	// (kind-30440 is replaceable; multi-relay fetches can return stale copies),
	// and confirm claims must be quorum-eligible (see isQuorumEligibleVerdict).
	const latestByValidatorAndBid = new Map<string, ParsedValidatorVerdictEvent>()
	for (const v of verdicts) {
		if (!auction.auditors.includes(v.validatorPubkey)) continue
		const key = `${v.validatorPubkey}:${v.bidEventId}`
		const existing = latestByValidatorAndBid.get(key)
		if (!existing || (v.createdAt ?? 0) >= (existing.createdAt ?? 0)) {
			latestByValidatorAndBid.set(key, v)
		}
	}

	const eligibleConfirmsByBidId = new Map<string, ParsedValidatorVerdictEvent[]>()
	const condemnByBidId = new Map<string, ParsedValidatorVerdictEvent[]>()
	for (const v of latestByValidatorAndBid.values()) {
		const refBidForScreen = bidsById.get(v.bidEventId)
		if (CONDEMN_CLAIMS.has(v.claim)) {
			if (!refBidForScreen) continue
			if (!isQuorumEligibleVerdict(v, refBidForScreen, auction)) continue
			const arr = condemnByBidId.get(v.bidEventId) ?? []
			arr.push(v)
			condemnByBidId.set(v.bidEventId, arr)
			continue
		}
		if (!CONFIRM_CLAIMS.has(v.claim)) continue
		if (!refBidForScreen) continue
		if (!isQuorumEligibleVerdict(v, refBidForScreen, auction)) continue
		const arr = eligibleConfirmsByBidId.get(v.bidEventId) ?? []
		arr.push(v)
		eligibleConfirmsByBidId.set(v.bidEventId, arr)
	}

	// Step 2: Classify each bid based only on verdicts addressed to that bid.
	const classified = bids.map((bid) =>
		classifyBid(bid, auction, eligibleConfirmsByBidId.get(bid.id) ?? [], condemnByBidId.get(bid.id) ?? [], nut7States),
	)

	// M5 FIX: Cross-bid dedup check at parse/classification time.
	// Two different bids in the same auction must not share the same
	// lock_secret or proof_y. If they do, one bid is reusing proofs
	// from another — the bid amount is not cryptographically bound to
	// the proofs, so an attacker could submit a high-amount bid reusing
	// proofs committed in a lower-amount bid. Mark any bid whose
	// lock_secret/proof_y multiset collides with an earlier-observed bid
	// as invalid. We process in order of observedAt (earliest wins).
	const seenLockSecretsByBidder = new Map<string, Set<string>>()
	const seenProofYsByBidder = new Map<string, Set<string>>()
	const seenDleqCsByBidder = new Map<string, Set<string>>()
	// ADR-0011 review A3 (PR #1280 discussion_r3999446835): scoping these sets
	// per Nostr pubkey is NOT sufficient. DLEQ authenticates the Cashu proof
	// against the mint keyset — it says nothing about OWNERSHIP by the event
	// author — and `lock_secret` / `proof_y` / `C` are public in whichever bid
	// event first published them. A second author can therefore republish
	// another bidder's collateral under its own (higher) amount and a fresh
	// DLEQ tuple, so two bids would both be authoritative for the SAME coins
	// while only one can ever be redeemed. Collateral is therefore bound to
	// exactly ONE bidder across authors: the first-observed claim wins and any
	// later claim by a DIFFERENT author is invalid. (Same-author reuse remains
	// the M5 rule above.)
	const collateralClaimant = new Map<string, string>()
	const sortedByObserved = [...classified].sort((a, b) => a.observedAt - b.observedAt)
	const bidsWithDuplicateProofs = new Set<string>()
	for (const c of sortedByObserved) {
		if (c.classification === 'invalid') continue
		const bidder = c.bid.bidderPubkey.toLowerCase()
		const bidderSeenSecrets = seenLockSecretsByBidder.get(bidder) ?? new Set()
		const bidderSeenProofYs = seenProofYsByBidder.get(bidder) ?? new Set()
		const bidderSeenDleqCs = seenDleqCsByBidder.get(bidder) ?? new Set()
		// A3: collateral already claimed by a DIFFERENT author is a cross-author
		// collision — the same coins cannot back two bids. Checked before the
		// same-author reuse rules because it is the security-critical one.
		let hasDup = false
		const claimKeys = collateralClaimKeys(c.bid)
		for (const key of claimKeys) {
			const claimant = collateralClaimant.get(key)
			if (claimant && claimant !== bidder) {
				hasDup = true
				break
			}
		}
		if (!hasDup) {
			for (const secret of c.bid.lockSecrets) {
				if (bidderSeenSecrets.has(secret.toLowerCase())) {
					hasDup = true
					break
				}
			}
		}
		if (!hasDup) {
			for (const proofY of c.bid.proofYs) {
				if (bidderSeenProofYs.has(proofY.toLowerCase())) {
					hasDup = true
					break
				}
			}
		}
		if (!hasDup) {
			// M5: extend the dup check to DLEQ mint signatures `C` — two proofs
			// sharing the same `C` are the same proof (fabricated collateral).
			for (const proof of c.bid.dleqProofs ?? []) {
				const dleqC = proof.C?.toLowerCase()
				if (dleqC && bidderSeenDleqCs.has(dleqC)) {
					hasDup = true
					break
				}
			}
		}
		if (hasDup) {
			bidsWithDuplicateProofs.add(c.bid.id)
		} else {
			for (const secret of c.bid.lockSecrets) bidderSeenSecrets.add(secret.toLowerCase())
			for (const proofY of c.bid.proofYs) bidderSeenProofYs.add(proofY.toLowerCase())
			for (const proof of c.bid.dleqProofs ?? []) {
				const dleqC = proof.C?.toLowerCase()
				if (dleqC) bidderSeenDleqCs.add(dleqC)
			}
			seenLockSecretsByBidder.set(bidder, bidderSeenSecrets)
			seenProofYsByBidder.set(bidder, bidderSeenProofYs)
			seenDleqCsByBidder.set(bidder, bidderSeenDleqCs)
			// A3: bind this collateral to this bidder for the rest of the pass.
			for (const key of claimKeys) {
				if (!collateralClaimant.has(key)) collateralClaimant.set(key, bidder)
			}
		}
	}
	// Step 4: run the structural verdict for each quorum-confirmed bid.
	//
	// ADR-0012 Phase 1: `validateBid` is a pure function of the bid, the
	// auction and `observed_at`. It is deliberately NOT fed the current top
	// valid amount (which made the amount check depend on which other bids had
	// been seen, and in what order), the `prev_bid` chain, or any NUT-7 state.
	const finalValid: ParsedBidEvent[] = []
	const finalPending: ParsedBidEvent[] = []
	const finalInvalid: ParsedBidEvent[] = []
	const trustedCollateralChains = new Map<string, readonly TrustedCollateralLeg[]>()

	for (const c of classified) {
		if (c.classification === 'invalid') {
			finalInvalid.push(c.bid)
			continue
		}
		// M5: Bids with duplicate lock_secret/proof_y are invalid.
		if (bidsWithDuplicateProofs.has(c.bid.id)) {
			finalInvalid.push(c.bid)
			continue
		}
		if (c.classification === 'pending') {
			finalPending.push(c.bid)
			continue
		}
	}

	// Build validCandidates from classified bids that passed M5 duplicate checks.
	const validCandidates = classified
		.filter((c) => c.classification === 'valid' && !bidsWithDuplicateProofs.has(c.bid.id))
		.sort((a, b) => a.observedAt - b.observedAt)

	for (const c of validCandidates) {
		const verdict = validateBid({
			auction,
			bid: c.bid,
			observedAt: c.observedAt,
		})

		if (verdict.claim === 'valid_bid_placed') {
			// Economic authority is stricter than validator validity. A direct
			// quorum confirms this exact bid only; cumulative backing comes from
			// independently verifying every required DLEQ leg in its bounded chain.
			const collateral = verifyBidCollateralChain({
				candidate: c.bid,
				auction,
				bidsById,
				dleqKeysets: input.dleqKeysets,
				dleqUnknownKeysets: input.dleqUnknownKeysets,
				disallowedCollateralBidIds: bidsWithDuplicateProofs,
			})
			if (collateral.status === 'pending') {
				c.classification = 'pending'
				c.pendingReason = 'dleq_evidence_unavailable'
				finalPending.push(c.bid)
				continue
			}
			if (collateral.status === 'invalid') {
				c.classification = 'invalid'
				c.invalidReason = 'dleq_invalid'
				finalInvalid.push(c.bid)
				continue
			}

			// NUT-7 positive-spend evidence applies to every collateral leg whose
			// value is credited to this cumulative bid. DLEQ proves authenticity,
			// not that the proof remains unspent. The narrow post-settlement
			// exception is therefore evaluated independently for each exact leg.
			const hasDisqualifyingSpentLeg = collateral.chain.some(({ bid }) => {
				if (nut7States?.get(bid.id) !== 'spent') return false
				return !(postSettlement && input.settledBidIds?.has(bid.id))
			})
			if (hasDisqualifyingSpentLeg) {
				c.classification = 'invalid'
				finalInvalid.push(c.bid)
				continue
			}
			// No NUT-7 evidence, or unspent → valid.
			trustedCollateralChains.set(c.bid.id, collateral.chain)
			finalValid.push(c.bid)
			continue
		}

		// The only remaining claim is `bid_invalid`: ADR-0012 Phase 1 removed the
		// NUT-7-derived `bid_pending_review` variant from the verdict union, so a
		// quorum-confirmed candidate can no longer come back "pending".
		finalInvalid.push(c.bid)
	}

	// The running top must NOT be derived during validation: the verdict no
	// longer depends on it, so the only definition consistent with the new
	// pipeline is "the highest amount among the bids that ended up valid".
	// Turning this into leadership / current price / a winner is selection's
	// job (ADR-0012 Phase 2, `select()`).
	const currentTopValidAmount = finalValid.reduce((top, bid) => Math.max(top, bid.amount), 0)

	const canonicalWinner = computeCanonicalWinner(finalValid)

	return {
		classified,
		validBids: finalValid,
		pendingBids: finalPending,
		invalidBids: finalInvalid,
		canonicalWinner,
		currentTopValidAmount,
		trustedCollateralChains,
	}
}
