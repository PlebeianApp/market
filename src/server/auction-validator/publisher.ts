/**
 * Verdict publisher — turns a `DerivedVerdict` into a signed kind-30440
 * Nostr event and ships it to the validator's relay pool.
 *
 * Suppression discipline: we only publish when the derived verdict
 * differs from what we last published for that bid (claim or reason
 * change). `detail` differences are noise and don't trigger
 * republish. Since kind-30440 is parameterised-replaceable (d-tag =
 * `<bidder>:<auction_root>`), each (bidder, auction) triple has at
 * most one event per validator in flight on relays at any time.
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
