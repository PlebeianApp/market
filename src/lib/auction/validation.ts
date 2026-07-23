/**
 * Pure validation pipeline for kind-1023 bids under
 * `cashu_p2pk_bidder_path_v1` — implements AUCTIONS.md §7.1.
 *
 * "Pure" in two senses:
 *
 * 1. Side-effect-free. {@link validateBid} returns a verdict; the
 *    caller does the network I/O (NUT-7 against the mint, fetching the
 *    auction event, etc.) and feeds the results in.
 *
 * 2. Decoupled from event publishing. The validator process turns the
 *    returned verdict into a kind-30440 event; this module only
 *    decides what the verdict *is*.
 *
 * The pipeline runs in the order specified in §7.1's flowchart and
 * **short-circuits at the first failure** — a bid that's both
 * past-end-window and below-the-curve gets reported as
 * `post_end` (the first check that fails). That keeps the verdict
 * stable: rerunning validation with the same inputs always yields
 * the same verdict, and validators sweeping the bid set produce
 * deterministic results across runs.
 *
 * Failure verdicts always carry a {@link ValidatorReason} via the
 * `reason` field. Successful verdicts carry no reason. Both shapes
 * are discriminated by the `claim` field so callers don't need to
 * type-guard.
 */

import {
	AUCTION_MIN_BID_LEG_SATS,
	AUCTION_MIN_BID_SATS,
	BID_FLOOR_TIME_GRACE_SECONDS,
	type PathReleaseReason,
	type Nut7ProofState,
	type ValidatorClaim,
	type ValidatorReason,
} from './constants'
import type { ParsedAuctionEvent, ParsedBidEvent, ParsedPathReleaseEvent } from './events'
import { hashToCurveHexFromString } from '../cashu/hashToCurve'
import { parseAuctionLockSecret } from '../cashu/p2pkSecret'
import { getDecodedToken } from '@cashu/cashu-ts'
import { addAuctionSettlementProofAmount } from '../auctionSettlementP2pk'
import { deriveAuctionChildP2pkPubkeyFromXpub } from '../auctionP2pk'

// ============================================================================
// Public API
// ============================================================================

/**
 * Output of {@link validateBid}. Discriminated by {@link claim}:
 *
 * - `valid_bid_placed`     → bid passes all checks; no `reason`.
 * - `bid_pending_review`   → NUT-7 hadn't returned yet; transient.
 * - `bid_invalid`          → `reason` carries the specific cause.
 */
export type BidValidationVerdict =
	| { claim: 'valid_bid_placed' }
	| { claim: 'bid_pending_review'; reason: 'nut7_unknown' }
	| { claim: 'bid_invalid'; reason: ValidatorReason; detail?: string }

/**
 * Hook for validator-specific policy decisions (relatr score,
 * blacklist, KYC, etc.). Returning `'pass'` is the default; returning
 * `{ reject, reason, detail? }` short-circuits the pipeline and the
 * verdict surfaces with `claim=bid_invalid` and the chosen reason.
 *
 * The hook receives the parsed auction + bid and the validator's own
 * observation timestamp. Policy callouts are wired here (rather than
 * as a post-pipeline step) so a policy-driven reject is indistinguishable
 * from a rule-driven reject in the verdict event — every reason gets
 * the same first-class treatment.
 */
export type PolicyHook = (input: {
	auction: ParsedAuctionEvent
	bid: ParsedBidEvent
	observedAt: number
}) => 'pass' | { reject: true; reason: ValidatorReason; detail?: string }

export type BidChainValidation = { ok: true; legAmount: number } | { ok: false; detail: string }

export interface ValidateBidInput {
	auction: ParsedAuctionEvent
	bid: ParsedBidEvent
	/** Validator's own observation timestamp in unix seconds. NOT the bidder's `created_at`. */
	observedAt: number
	/**
	 * Latest NUT-7 result the validator has for this bid's proof.
	 * `undefined` ≡ the validator hasn't queried yet — pipeline returns
	 * `bid_pending_review`.
	 */
	nut7State?: Nut7ProofState
	/**
	 * Current top valid bid amount on the auction at the moment of
	 * validation. Used by the floor computation. `undefined` means
	 * "no prior bid" → starting_bid is the baseline.
	 */
	currentTopBid?: number
	/**
	 * For a `prev_bid` continuation, the bidder's own replacement-chain
	 * delta (`bid.amount - previous bid amount`). Supplied by callers
	 * that hold the per-auction bid graph.
	 */
	bidChainLegAmount?: number
	/** Richer replacement-chain validation result from callers that hold the full bid graph. */
	bidChainValidation?: BidChainValidation
	/** Optional validator policy hook. */
	policy?: PolicyHook
}

export type ReleaseTiming = 'prompt' | 'late'

export type ReleaseValidityFailureCode =
	| 'unauthorized_signer'
	| 'bid_reference_mismatch'
	| 'auction_mismatch'
	| 'seller_mismatch'
	| 'release_reason_invalid'
	| 'derivation_invalid'
	| 'child_pubkey_mismatch'
	| 'cashu_token_missing'
	| 'cashu_token_decode_failed'
	| 'cashu_token_mint_mismatch'
	| 'cashu_token_amount_mismatch'
	| 'cashu_token_proof_count_mismatch'
	| 'cashu_token_lock_mismatch'
	| 'cashu_token_secret_mismatch'
	| 'cashu_token_proof_y_mismatch'

export type ReleaseValidityResult =
	| {
			isValid: true
			releaseTiming: ReleaseTiming
			derivedChildPubkey: string
			decodedTokenSummary: {
				mintUrl: string
				amount: number
				proofCount: number
			}
	  }
	| {
			isValid: false
			failureCode: ReleaseValidityFailureCode
			releaseTiming: ReleaseTiming
			detail: string
	  }

export interface ValidatePathReleaseInput {
	auction: ParsedAuctionEvent
	bid: ParsedBidEvent
	release: ParsedPathReleaseEvent
	now: number
	postCloseDecision: 'winner' | 'loser' | null
	fallbackOfferedAt?: number | null
}

// ============================================================================
// Floor computation — pure
// ============================================================================

const computeFloorMultiplier = (
	atSeconds: number,
	endAt: number,
	maxEndAt: number,
	shape: 'none' | 'linear' | 'exponential',
	peakMultiplier: number,
): number => {
	if (shape === 'none' || peakMultiplier <= 1) return 1
	if (maxEndAt <= endAt) return 1
	if (atSeconds <= endAt) return 1
	if (atSeconds >= maxEndAt) return peakMultiplier
	const tNorm = (atSeconds - endAt) / (maxEndAt - endAt)
	if (shape === 'linear') return 1 + (peakMultiplier - 1) * tNorm
	return Math.pow(peakMultiplier, tNorm)
}

/**
 * Per AUCTIONS.md §6.1. `Math.ceil` so a fractional multiplier still
 * requires the bidder to pay AT LEAST the floor — never less.
 */
export const computeBidFloor = (input: { auction: ParsedAuctionEvent; topBid: number; atSeconds: number }): number => {
	const { auction, topBid, atSeconds } = input
	const baseline =
		topBid > 0 ? topBid + Math.max(auction.bidIncrement, AUCTION_MIN_BID_LEG_SATS) : Math.max(auction.startingBid, AUCTION_MIN_BID_SATS)
	const multiplier = computeFloorMultiplier(
		atSeconds,
		auction.endAt,
		auction.maxEndAt,
		auction.minBidCurve.shape,
		auction.minBidCurve.peakMultiplier,
	)
	return Math.max(0, Math.ceil(baseline * multiplier))
}

// ============================================================================
// validateBid — the §7.1 pipeline
// ============================================================================

/**
 * Run the full §7.1 decision tree against one bid. Pure: same inputs
 * always yield the same verdict. Order of checks matters — see the
 * module docstring on short-circuiting.
 */
export const validateBid = (input: ValidateBidInput): BidValidationVerdict => {
	const { auction, bid, observedAt, nut7State, currentTopBid = 0, bidChainLegAmount, bidChainValidation, policy } = input

	// --- Step 1: cross-event reference integrity -----------------------------

	if (bid.auctionRootEventId !== auction.rootEventId) {
		return {
			claim: 'bid_invalid',
			reason: 'bad_lock',
			detail: `bid references root ${bid.auctionRootEventId}, auction root is ${auction.rootEventId}`,
		}
	}
	if (bid.auctionCoordinate !== auction.coordinate) {
		return {
			claim: 'bid_invalid',
			reason: 'bad_lock',
			detail: `bid coordinate ${bid.auctionCoordinate} doesn't match auction ${auction.coordinate}`,
		}
	}
	if (bid.sellerPubkey.toLowerCase() !== auction.sellerPubkey.toLowerCase()) {
		return { claim: 'bid_invalid', reason: 'bad_lock', detail: 'bid `p` tag does not match auction seller pubkey' }
	}

	// --- Step 2: time-window checks ------------------------------------------

	if (bid.createdAt < auction.startAt) {
		return { claim: 'bid_invalid', reason: 'pre_start', detail: `created_at=${bid.createdAt} < start_at=${auction.startAt}` }
	}
	if (bid.createdAt > auction.maxEndAt) {
		return { claim: 'bid_invalid', reason: 'post_end', detail: `created_at=${bid.createdAt} > max_end_at=${auction.maxEndAt}` }
	}
	if (observedAt < auction.startAt || observedAt > auction.maxEndAt) {
		return {
			claim: 'bid_invalid',
			reason: 'late_arrival',
			detail: `observed_at=${observedAt} outside [${auction.startAt}, ${auction.maxEndAt}]`,
		}
	}
	if (Math.abs(bid.createdAt - observedAt) > auction.maxSkewSec) {
		return {
			claim: 'bid_invalid',
			reason: 'timestamp_skew',
			detail: `|created_at - observed_at|=${Math.abs(bid.createdAt - observedAt)} > max_skew_sec=${auction.maxSkewSec}`,
		}
	}

	// --- Step 3: mint allowlist ---------------------------------------------

	if (!auction.mints.includes(bid.mint)) {
		return {
			claim: 'bid_invalid',
			reason: 'unsupported_mint',
			detail: `mint ${bid.mint} not in auction allowlist [${auction.mints.join(', ')}]`,
		}
	}

	// --- Step 4: lock secret structure --------------------------------------

	const expectedLocktime = auction.maxEndAt + auction.settlementGrace
	if (bid.locktime !== expectedLocktime) {
		return {
			claim: 'bid_invalid',
			reason: 'bad_lock',
			detail: `bid locktime tag=${bid.locktime}, expected max_end_at+settlement_grace=${expectedLocktime}`,
		}
	}
	if (bid.lockSecrets.length !== bid.proofYs.length) {
		return {
			claim: 'bid_invalid',
			reason: 'bad_lock',
			detail: `lock_secret and proof_y tags must be parallel: ${bid.lockSecrets.length} vs ${bid.proofYs.length}`,
		}
	}
	// Validate every proof's secret independently. All MUST share the same
	// lock parameters — the bidder split their input across multiple
	// denominations but each output proof is its own P2PK lock with its
	// own nonce. Reject the bid if any proof is malformed; we don't want
	// validators to selectively trust subsets of a lock set.
	for (let i = 0; i < bid.lockSecrets.length; i++) {
		const lockParse = parseAuctionLockSecret(bid.lockSecrets[i], {
			expectedLocktime,
			expectedChildPubkey: bid.childPubkey,
			expectedRefundPubkey: bid.refundPubkey,
		})
		if (!lockParse.ok) {
			return {
				claim: 'bid_invalid',
				reason: 'bad_lock',
				detail: `proof ${i + 1}/${bid.lockSecrets.length}: ${lockParse.reason}${lockParse.detail ? `: ${lockParse.detail}` : ''}`,
			}
		}

		const derivedProofY = hashToCurveHexFromString(bid.lockSecrets[i])
		if (derivedProofY.toLowerCase() !== bid.proofYs[i].toLowerCase()) {
			return {
				claim: 'bid_invalid',
				reason: 'bad_proof_y',
				detail: `proof ${i + 1}/${bid.proofYs.length}: derived proof_y ${derivedProofY} does not match published ${bid.proofYs[i]}`,
			}
		}
	}

	// --- Step 5: amount + curve floor ---------------------------------------

	const effectiveT = clamp(observedAt - BID_FLOOR_TIME_GRACE_SECONDS, auction.endAt, auction.maxEndAt)
	const minRequired = computeBidFloor({ auction, topBid: currentTopBid, atSeconds: effectiveT })

	if (bid.amount < minRequired) {
		// Two distinct reasons depending on whether the curve was active.
		const inCurveWindow = observedAt > auction.endAt && auction.minBidCurve.shape !== 'none'
		return {
			claim: 'bid_invalid',
			reason: inCurveWindow ? 'under_curve' : 'under_increment',
			detail: `amount=${bid.amount} < required=${minRequired} (top_bid=${currentTopBid}, t=${effectiveT})`,
		}
	}
	if (bid.prevBidId) {
		const chainValidationResult = normaliseBidChainValidation({ bid, bidChainLegAmount, bidChainValidation })
		if (!chainValidationResult.ok) {
			return {
				claim: 'bid_invalid',
				reason: 'replacement_chain_invalid',
				detail: chainValidationResult.detail,
			}
		}
		if (!Number.isSafeInteger(chainValidationResult.legAmount) || chainValidationResult.legAmount < AUCTION_MIN_BID_LEG_SATS) {
			return {
				claim: 'bid_invalid',
				reason: 'under_increment',
				detail: `replacement-chain delta=${chainValidationResult.legAmount} must be an integer of at least ${AUCTION_MIN_BID_LEG_SATS} sats`,
			}
		}
	}

	// --- Step 6: NUT-7 proof state ------------------------------------------

	switch (nut7State) {
		case undefined:
		case 'unknown':
			return { claim: 'bid_pending_review', reason: 'nut7_unknown' }
		case 'missing':
			return {
				claim: 'bid_invalid',
				reason: 'proof_missing',
				detail: `mint omitted at least one of ${bid.proofYs.length} proof(s) from a successful NUT-7 response`,
			}
		case 'pending':
			return { claim: 'bid_pending_review', reason: 'nut7_unknown' }
		case 'spent':
			// Pre-settlement spent = fake / fraudulent bid. The bidder either
			// controlled the lock pubkey themselves and drained behind the
			// scenes, or the bid was already redeemed somehow. Either way it's
			// invalid for the auction. Reason `proof_spent` covers the
			// not-yet-deemed-fraudulent variant; the fraudulent_bid claim is
			// raised at settlement time when a kind-1025 reveals a path that
			// doesn't derive to the lock pubkey.
			return {
				claim: 'bid_invalid',
				reason: 'proof_spent',
				detail: `mint reports at least one of ${bid.proofYs.length} proof(s) as SPENT (any spent proof invalidates the bid)`,
			}
		case 'unspent':
			// Proceed to policy.
			break
	}

	// --- Step 7: validator-specific policy ----------------------------------

	if (policy) {
		const verdict = policy({ auction, bid, observedAt })
		if (verdict !== 'pass') {
			return { claim: 'bid_invalid', reason: verdict.reason, detail: verdict.detail }
		}
	}

	// --- Step 8: success ----------------------------------------------------

	return { claim: 'valid_bid_placed' }
}

export const validatePathRelease = (input: ValidatePathReleaseInput): ReleaseValidityResult => {
	const { auction, bid, release, now, postCloseDecision, fallbackOfferedAt = null } = input
	const releaseTiming: ReleaseTiming = now > auction.maxEndAt + auction.settlementGrace ? 'late' : 'prompt'

	if (release.bidderPubkey.toLowerCase() !== bid.bidderPubkey.toLowerCase()) {
		return invalidRelease('unauthorized_signer', releaseTiming, 'kind-1025 author does not match the original bidder')
	}
	if (release.bidEventId !== bid.id) {
		return invalidRelease('bid_reference_mismatch', releaseTiming, `release references bid ${release.bidEventId}, expected ${bid.id}`)
	}
	if (release.auctionCoordinate !== bid.auctionCoordinate || release.auctionCoordinate !== auction.coordinate) {
		return invalidRelease(
			'auction_mismatch',
			releaseTiming,
			`release auction coordinate ${release.auctionCoordinate} does not match bid/auction coordinate ${auction.coordinate}`,
		)
	}
	if (
		release.sellerPubkey.toLowerCase() !== bid.sellerPubkey.toLowerCase() ||
		release.sellerPubkey.toLowerCase() !== auction.sellerPubkey.toLowerCase()
	) {
		return invalidRelease('seller_mismatch', releaseTiming, 'release seller pubkey does not match the referenced bid and auction seller')
	}

	const releaseReasonValidity = validateReleaseReason({
		releaseReason: release.releaseReason,
		postCloseDecision,
		now,
		graceExpiresAt: auction.maxEndAt + auction.settlementGrace,
		fallbackOfferedAt,
	})
	if (!releaseReasonValidity.ok) {
		return invalidRelease('release_reason_invalid', releaseTiming, releaseReasonValidity.detail)
	}

	let derivedChildPubkey: string
	try {
		derivedChildPubkey = deriveAuctionChildP2pkPubkeyFromXpub(auction.p2pkXpub, release.derivationPath)
	} catch (err) {
		return invalidRelease(
			'derivation_invalid',
			releaseTiming,
			`derive(p2pk_xpub, path) failed: ${err instanceof Error ? err.message : String(err)}`,
		)
	}

	if (derivedChildPubkey.toLowerCase() !== release.childPubkey.toLowerCase()) {
		return invalidRelease(
			'child_pubkey_mismatch',
			releaseTiming,
			`derive(p2pk_xpub, path)=${derivedChildPubkey} does not match release.child_pubkey=${release.childPubkey}`,
		)
	}
	if (derivedChildPubkey.toLowerCase() !== bid.childPubkey.toLowerCase()) {
		return invalidRelease(
			'child_pubkey_mismatch',
			releaseTiming,
			`derive(p2pk_xpub, path)=${derivedChildPubkey} does not match bid.child_pubkey=${bid.childPubkey}`,
		)
	}
	if (!release.cashuToken?.trim()) {
		return invalidRelease('cashu_token_missing', releaseTiming, 'kind-1025 is missing the cashu_token tag required for redemption')
	}

	let decodedToken: ReturnType<typeof getDecodedToken>
	try {
		decodedToken = getDecodedToken(release.cashuToken)
	} catch (err) {
		return invalidRelease(
			'cashu_token_decode_failed',
			releaseTiming,
			`cashu_token could not be decoded: ${err instanceof Error ? err.message : String(err)}`,
		)
	}

	if (!decodedToken.proofs.length) {
		return invalidRelease('cashu_token_proof_count_mismatch', releaseTiming, 'cashu_token contains no proofs')
	}
	if (decodedToken.proofs.length !== bid.proofYs.length) {
		return invalidRelease(
			'cashu_token_proof_count_mismatch',
			releaseTiming,
			`cashu_token proof count ${decodedToken.proofs.length} does not match bid proof count ${bid.proofYs.length}`,
		)
	}

	const tokenMintUrl = normalizeMintUrl(decodedToken.mint ?? '')
	const bidMintUrl = normalizeMintUrl(bid.mint)
	if (!tokenMintUrl || tokenMintUrl !== bidMintUrl) {
		return invalidRelease(
			'cashu_token_mint_mismatch',
			releaseTiming,
			`cashu_token mint ${decodedToken.mint ?? '<missing>'} does not match bid mint ${bid.mint}`,
		)
	}

	const expectedSecrets = buildCounter(bid.lockSecrets)
	const expectedProofYs = buildCounter(bid.proofYs.map((proofY) => proofY.toLowerCase()))
	let tokenAmount = 0

	for (let index = 0; index < decodedToken.proofs.length; index++) {
		const proof = decodedToken.proofs[index]
		if (!Number.isSafeInteger(proof.amount) || proof.amount <= 0) {
			return invalidRelease(
				'cashu_token_amount_mismatch',
				releaseTiming,
				`cashu_token proof ${index + 1} has invalid amount ${proof.amount}`,
			)
		}
		tokenAmount = addAuctionSettlementProofAmount(tokenAmount, proof.amount)

		const parsedLock = parseAuctionLockSecret(proof.secret, {
			expectedLocktime: bid.locktime,
			expectedChildPubkey: bid.childPubkey,
			expectedRefundPubkey: bid.refundPubkey,
		})
		if (!parsedLock.ok) {
			return invalidRelease(
				'cashu_token_lock_mismatch',
				releaseTiming,
				`cashu_token proof ${index + 1} lock mismatch: ${parsedLock.reason}${parsedLock.detail ? `: ${parsedLock.detail}` : ''}`,
			)
		}

		if (!consumeCounterValue(expectedSecrets, proof.secret)) {
			return invalidRelease(
				'cashu_token_secret_mismatch',
				releaseTiming,
				`cashu_token proof ${index + 1} secret was not committed in the original bid`,
			)
		}

		const proofY = hashToCurveHexFromString(proof.secret).toLowerCase()
		if (!consumeCounterValue(expectedProofYs, proofY)) {
			return invalidRelease(
				'cashu_token_proof_y_mismatch',
				releaseTiming,
				`cashu_token proof ${index + 1} hash_to_curve(secret) does not match the bid's proof_y set`,
			)
		}
	}

	if (!counterIsEmpty(expectedSecrets)) {
		return invalidRelease('cashu_token_secret_mismatch', releaseTiming, 'cashu_token is missing one or more secrets committed in the bid')
	}
	if (!counterIsEmpty(expectedProofYs)) {
		return invalidRelease(
			'cashu_token_proof_y_mismatch',
			releaseTiming,
			'cashu_token is missing one or more proof_y commitments from the bid',
		)
	}
	if (tokenAmount !== bid.amount) {
		return invalidRelease(
			'cashu_token_amount_mismatch',
			releaseTiming,
			`cashu_token proof sum ${tokenAmount} does not match bid amount ${bid.amount}`,
		)
	}

	return {
		isValid: true,
		releaseTiming,
		derivedChildPubkey,
		decodedTokenSummary: {
			mintUrl: tokenMintUrl,
			amount: tokenAmount,
			proofCount: decodedToken.proofs.length,
		},
	}
}

// ============================================================================
// Convenience helpers
// ============================================================================

const validateReleaseReason = (input: {
	releaseReason: PathReleaseReason
	postCloseDecision: 'winner' | 'loser' | null
	now: number
	graceExpiresAt: number
	fallbackOfferedAt: number | null
}): { ok: true } | { ok: false; detail: string } => {
	const { releaseReason, postCloseDecision, now, graceExpiresAt, fallbackOfferedAt } = input
	if (postCloseDecision === null) {
		return { ok: false, detail: 'release arrived before the validator assigned winner/loser roles' }
	}
	if (releaseReason === 'settlement') {
		if (postCloseDecision !== 'winner') {
			return { ok: false, detail: 'release_reason=settlement is only valid for the winning bid' }
		}
		return { ok: true }
	}
	if (releaseReason === 'fallback_settlement') {
		if (postCloseDecision !== 'loser') {
			return { ok: false, detail: 'release_reason=fallback_settlement is only valid for fallback bidders' }
		}
		if (fallbackOfferedAt === null) {
			return { ok: false, detail: 'release_reason=fallback_settlement requires fallback context from the validator lifecycle' }
		}
		return { ok: true }
	}
	if (postCloseDecision !== 'winner') {
		return { ok: false, detail: 'release_reason=voluntary_late is only valid for the original winning bid' }
	}
	if (now <= graceExpiresAt) {
		return { ok: false, detail: 'release_reason=voluntary_late is only valid after settlement_grace has elapsed' }
	}
	return { ok: true }
}

const normalizeMintUrl = (mintUrl: string): string => mintUrl.trim().replace(/\/$/, '')

const invalidRelease = (failureCode: ReleaseValidityFailureCode, releaseTiming: ReleaseTiming, detail: string): ReleaseValidityResult => ({
	isValid: false,
	failureCode,
	releaseTiming,
	detail,
})

const buildCounter = (values: string[]): Map<string, number> => {
	const counter = new Map<string, number>()
	for (const value of values) {
		counter.set(value, (counter.get(value) ?? 0) + 1)
	}
	return counter
}

const consumeCounterValue = (counter: Map<string, number>, value: string): boolean => {
	const current = counter.get(value) ?? 0
	if (current <= 0) return false
	if (current === 1) counter.delete(value)
	else counter.set(value, current - 1)
	return true
}

const counterIsEmpty = (counter: Map<string, number>): boolean => counter.size === 0

const clamp = (value: number, min: number, max: number): number => {
	if (value < min) return min
	if (value > max) return max
	return value
}

const normaliseBidChainValidation = (input: {
	bid: ParsedBidEvent
	bidChainLegAmount?: number
	bidChainValidation?: BidChainValidation
}): BidChainValidation => {
	if (input.bidChainValidation) return input.bidChainValidation
	if (input.bidChainLegAmount !== undefined) {
		return { ok: true, legAmount: input.bidChainLegAmount }
	}
	return {
		ok: false,
		detail: `prev_bid=${input.bid.prevBidId} context unavailable for replacement-chain validation`,
	}
}

/**
 * The set of {@link ValidatorClaim} values produced by {@link validateBid}.
 * Validators may later transition these to post-close claims
 * (`won_pending_settlement`, etc.) — that lifecycle is handled by the
 * validator service rather than this module.
 */
export const VALIDATE_BID_CLAIMS: readonly ValidatorClaim[] = ['valid_bid_placed', 'bid_invalid', 'bid_pending_review']
