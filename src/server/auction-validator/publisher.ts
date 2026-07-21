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
import { aggregateProofStates, markVerdictPublished, type ValidatorAuctionState, type ValidatorBidState } from './state'
import { deriveVerdict, verdictChanged, type DerivedVerdict } from './lifecycle'

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
		const observedAt = now()
		const verdict = deriveVerdict({
			auctionState: input.auctionState,
			bidState: input.bidState,
			now: observedAt,
			currentTopBid: input.currentTopBid,
		})

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
	const nut7State = aggregateProofStates(bidState.nut7States, bidState.bid.proofYs)
	const tags = buildValidatorVerdictTags({
		bidderPubkey: bidState.bid.bidderPubkey,
		auctionRootEventId: auctionState.auction.rootEventId,
		auctionCoordinate: auctionState.auction.coordinate,
		bidEventId: bidState.bid.id,
		claim: verdict.claim,
		observedAt,
		reason: typeof verdict.reason === 'string' ? verdict.reason : undefined,
		nut7State: nut7State === 'unknown' ? undefined : nut7State,
		nut7ObservedAt: nut7State !== 'unknown' ? observedAt : undefined,
	})

	// Free-form content carries diagnostics: bid amount, the verdict's
	// detail (when present), and the per-proof NUT-7 snapshot count.
	// Strict consumers ignore it; debug UIs surface it.
	const content = JSON.stringify({
		bid_amount: bidState.bid.amount,
		detail: verdict.detail,
		nut7_proof_count: bidState.nut7States.size,
		nut7_proofs_expected: bidState.bid.proofYs.length,
	})

	return {
		kind: VALIDATOR_VERDICT_KIND as unknown as number,
		created_at: observedAt,
		tags,
		content,
	}
}
