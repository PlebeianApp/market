/**
 * Verdict publisher — turns a `DerivedVerdict` into a signed kind-30440
 * Nostr event and ships it to the validator's relay pool.
 *
 * Suppression discipline: we only publish when the derived verdict
 * differs from what we last published for that bid (claim or reason
 * change). `detail` differences are noise and don't trigger
 * republish. Since kind-30440 is parameterised-replaceable on d-tag =
 * `<bidder>:<auction_root>:<bid_event_id>` (per-bid addressability,
 * ADR-0003 §4.4.1 amendment), each (validator, bidder, auction, bid)
 * quadruple has at most one event per validator in flight on relays at
 * any time. A bid's lifecycle verdicts (valid_bid_placed →
 * won_pending_settlement → settled) share the d-tag (same bid) and
 * replace one another; different bids get independent addresses so a
 * rebid no longer deletes the prior leg's verdict.
 *
 * No state mutation here — the caller (lifecycle composer) updates
 * the in-memory bid state via {@link markVerdictPublished} after the
 * publish succeeds. That keeps "what we put on the wire" and "what we
 * remember publishing" in a single transactional step.
 */

import type { NostrSigner } from '@contextvm/sdk'
import type { ApplesauceRelayPool } from '@contextvm/sdk'
import type { EventTemplate } from 'nostr-tools'
import { VALIDATOR_VERDICT_KIND } from '../../lib/auction/constants'
import { buildValidatorVerdictTags } from '../../lib/auction/tagBuilders'
import { markVerdictPublished, type ValidatorAuctionState, type ValidatorBidState } from './state'
import { assignCloseRoles, assignLateValidLoserRole, deriveVerdict, verdictChanged, type DerivedVerdict } from './lifecycle'

// ============================================================================
// Public API
// ============================================================================

export interface VerdictPublisherDeps {
	signer: NostrSigner
	relayPool: ApplesauceRelayPool
	/**
	 * Source of "current time" — defaults to `Date.now() / 1000` but
	 * injectable so integration tests can drive the lifecycle without
	 * sleep().
	 */
	now?: () => number
}

export interface PublishVerdictInput {
	auctionState: ValidatorAuctionState
	bidState: ValidatorBidState
	/** Pre-computed current top valid bid amount for floor checks. */
	currentTopBid: number
}

export interface PublishVerdictResult {
	/** The verdict we derived (whether or not we published). */
	verdict: DerivedVerdict
	/** True if we actually sent the kind-30440 event. */
	published: boolean
}

export const createVerdictPublisher = (deps: VerdictPublisherDeps) => {
	const now = deps.now ?? (() => Math.floor(Date.now() / 1000))

	/**
	 * Compute the verdict for a bid and, if it has changed, sign + send
	 * the kind-30440 update. Returns whether we published so callers
	 * (the subscriber, the NUT-7 poller) can log or batch.
	 */
	const publishIfChanged = async (input: PublishVerdictInput): Promise<PublishVerdictResult> => {
		const nowUnix = now()
		// Stamp `observed_at` with this validator's FIRST observation of the
		// bid (AUCTIONS.md §4.4.1), not publish time. On close, kind-30440
		// upgrades (won_pending_settlement / lost_pending_refund) REPLACE the
		// in-window valid_bid_placed verdicts — if they were re-stamped to
		// `now() > maxEndAt`, a client-side quorum-eligibility screen
		// (ADR-0003 §2.3 amendment) would drop every previously confirmed
		// bid to `pending` after close and winner derivation would break.
		const observedAt = input.bidState.observedAt

		if (!input.auctionState.closeHandled && nowUnix > input.auctionState.auction.maxEndAt) {
			assignCloseRoles(input.auctionState)
		}

		let verdict = deriveVerdict({
			auctionState: input.auctionState,
			bidState: input.bidState,
			now: nowUnix,
			currentTopBid: input.currentTopBid,
		})

		// Snapshot semantics: a bid that only reached valid_bid_placed
		// after the close snapshot (postCloseDecision still null while
		// closeHandled) cannot become the winner — assign the loser role
		// and re-derive so it never enters winner settlement processing.
		if (
			input.auctionState.closeHandled &&
			verdict.claim === 'valid_bid_placed' &&
			input.bidState.postCloseDecision === null &&
			assignLateValidLoserRole(input.auctionState, input.bidState)
		) {
			verdict = deriveVerdict({
				auctionState: input.auctionState,
				bidState: input.bidState,
				now: nowUnix,
				currentTopBid: input.currentTopBid,
			})
		}

		if (!verdictChanged(verdict, input.bidState.currentClaim, input.bidState.currentReason)) {
			return { verdict, published: false }
		}

		// Fix 3 (defense-in-depth): suppress publishing `bid_invalid: late_arrival`
		// once the auction has closed (`now > max_end_at`). Post-close, a fresh
		// (unrecovered) `observed_at` is always outside the window, so any
		// in-window bid observed for the first time post-close would derive
		// `late_arrival`. But `late_arrival` (T2.3) only fires for bids whose
		// own `created_at` IS in-window (T2.1/T2.2 already passed) — the
		// validator simply saw it late, which is not grounds to CONDEMN a
		// validly-placed bid. Publishing it would (a) feed a condemn the
		// quorum-eligibility screen drops anyway (ADR-0003 §2.3), and (b)
		// replace a surviving prior `valid_bid_placed` on the relay with a
		// condemn. Suppressing keeps the prior verdict intact so the client
		// still recognizes the winner; with no prior verdict the bid simply
		// stays `pending` (correct — the validator can't attest to timing it
		// didn't observe). Fix 1 (observed_at recovery) is the primary restart
		// defense; this ensures that even when recovery misses a bid, a
		// post-close restart never condemns an in-window bid. Pre-close
		// `late_arrival` (observed before `start_at`) is left untouched.
		if (verdict.claim === 'bid_invalid' && verdict.reason === 'late_arrival' && nowUnix > input.auctionState.auction.maxEndAt) {
			return { verdict, published: false }
		}

		const template = buildVerdictEventTemplate({
			auctionState: input.auctionState,
			bidState: input.bidState,
			verdict,
			observedAt,
		})

		const signed = await deps.signer.signEvent(template)
		await deps.relayPool.publish(signed)
		markVerdictPublished(input.bidState, verdict.claim, verdict.reason, verdict.detail, observedAt)

		return { verdict, published: true }
	}

	return { publishIfChanged }
}

// ============================================================================
// Event template builder
// ============================================================================

interface BuildTemplateInput {
	auctionState: ValidatorAuctionState
	bidState: ValidatorBidState
	verdict: DerivedVerdict
	observedAt: number
}

const buildVerdictEventTemplate = (input: BuildTemplateInput): EventTemplate => {
	const { auctionState, bidState, verdict, observedAt } = input
	const tags = buildValidatorVerdictTags({
		bidderPubkey: bidState.bid.bidderPubkey,
		auctionRootEventId: auctionState.auction.rootEventId,
		auctionCoordinate: auctionState.auction.coordinate,
		bidEventId: bidState.bid.id,
		claim: verdict.claim,
		observedAt,
		reason: typeof verdict.reason === 'string' ? verdict.reason : undefined,
	})

	// Free-form content carries diagnostics: bid amount and the verdict's
	// detail (when present). NUT-7 state is no longer included — the client
	// queries the mint directly via checkProofStateBatch (ADR-0004).
	const content = JSON.stringify({
		bid_amount: bidState.bid.amount,
		detail: verdict.detail,
	})

	return {
		kind: VALIDATOR_VERDICT_KIND as unknown as number,
		created_at: observedAt,
		tags,
		content,
	}
}
