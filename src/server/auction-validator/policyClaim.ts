/**
 * Auction-policy claim publisher — the daemon half of `auction_policy_invalid`.
 *
 * The assessment (`assessAuctionPolicyClaim`) is pure; this module is what makes it visible
 * on the wire. A validator that audits an auction whose own validator policy is broken
 * publishes a kind-30440 verdict about the auction ROOT, so a bidder who never saw the
 * seller's form can see that the auction's outcome is inadmissible, and the finding is
 * attributable to a validator's key rather than being a client-side opinion.
 *
 * Three disciplines, all of them the point:
 *
 * 1. **Assess, never assume.** The claim is published only when the assessment returns
 *    `broken` — a grandfathered legacy auction is not, and an auction that satisfies the
 *    ruleset is not.
 * 2. **Construct-then-verify.** The signed event is parsed back and re-derived from the
 *    auction root before it is published; a mismatch is dropped with a warning rather than
 *    shipped. Publishing a claim nobody can re-derive would be worse than publishing none.
 * 3. **Suppress unchanged claims.** The address is `auction_policy:<root>`, so the relay keeps
 *    the latest claim for that auction; re-publishing an identical one on every poll would
 *    just be noise. The in-memory record is keyed by the finding itself (pool, quorum, issue
 *    codes), so a *changed* finding is republished and an unchanged one is not.
 */

import type { NostrSigner } from '@contextvm/sdk'
import type { ApplesauceRelayPool } from '@contextvm/sdk'
import type { EventTemplate } from 'nostr-tools'
import { VALIDATOR_VERDICT_KIND } from '../../lib/auction/constants'
import {
	assessAuctionPolicyClaim,
	buildAuctionPolicyInvalidClaimContent,
	buildAuctionPolicyInvalidClaimTags,
	verifyAuctionPolicyInvalidClaim,
	type AuctionPolicyClaimInput,
} from '../../lib/auction/auctionPolicyInvalidClaim'
import type { AuctionValidatorRuleset } from '../../lib/auction/auctionValidatorPolicy'
import type { ParsedAuctionEvent } from '../../lib/auction/events'
import { parseAuctionPolicyVerdictEvent } from '../../lib/schemas/auction/validatorEvents'

export interface AuctionPolicyClaimPublisherDeps {
	signer: NostrSigner
	relayPool: ApplesauceRelayPool
	/** The ruleset this validator applies; defaults to the protocol default. */
	ruleset?: Partial<AuctionValidatorRuleset>
	/** Injectable clock — tests drive time rather than sleeping. */
	now?: () => number
	logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void }
}

export type AuctionPolicyClaimOutcome =
	/** The auction's policy holds; there is nothing to claim. */
	| { status: 'not_broken'; issues: readonly string[] }
	/** Broken, but this validator already announced exactly this finding. */
	| { status: 'unchanged'; issues: readonly string[] }
	/** Broken and published now. */
	| { status: 'published'; issues: readonly string[] }
	/** Broken, but the signed claim did not verify against the auction root. */
	| { status: 'refused'; issues: readonly string[]; reasons: readonly string[] }

export interface AuctionPolicyClaimPublisher {
	/**
	 * Assess one auction's policy and publish the claim when it is broken.
	 *
	 * Safe to call repeatedly for the same auction: an unchanged finding is suppressed.
	 */
	consider: (auction: ParsedAuctionEvent, observedAt?: number) => Promise<AuctionPolicyClaimOutcome>
	/** How many auctions this validator has announced a claim about — for logs/tests. */
	announcedCount: () => number
}

/** What we last announced, keyed by auction root: the finding, not the event. */
const findingSignature = (claim: NonNullable<ReturnType<typeof assessAuctionPolicyClaim>['claim']>): string =>
	[
		claim.document.pool_size,
		claim.document.declared_quorum,
		claim.document.required_quorum,
		claim.document.issues
			.map((issue) => issue.code)
			.sort()
			.join('+'),
	].join('|')

export const createAuctionPolicyClaimPublisher = (deps: AuctionPolicyClaimPublisherDeps): AuctionPolicyClaimPublisher => {
	const now = deps.now ?? (() => Math.floor(Date.now() / 1000))
	const announced = new Map<string, string>()

	const consider = async (auction: ParsedAuctionEvent, observedAt?: number): Promise<AuctionPolicyClaimOutcome> => {
		const input: AuctionPolicyClaimInput = {
			auctionRootEventId: auction.rootEventId,
			auctionCoordinate: auction.coordinate,
			policy: {
				auditors: auction.auditors,
				auditor_quorum: auction.auditorQuorum,
				settlement_policy: auction.settlementPolicy,
			},
			ruleset: deps.ruleset,
			observedAt: observedAt ?? now(),
		}

		const { broken, claim } = assessAuctionPolicyClaim(input)
		if (!broken || !claim) {
			return { status: 'not_broken', issues: [] }
		}

		const issues = claim.document.issues.map((issue) => issue.code)
		const signature = findingSignature(claim)
		if (announced.get(auction.rootEventId) === signature) {
			return { status: 'unchanged', issues }
		}

		const template: EventTemplate = {
			kind: VALIDATOR_VERDICT_KIND as unknown as number,
			// Publish time, so the relay's replaceable semantics keep the newest claim for this
			// auction; the validator's own observation time rides in `observed_at`.
			created_at: now(),
			tags: buildAuctionPolicyInvalidClaimTags(claim),
			content: buildAuctionPolicyInvalidClaimContent(claim),
		}

		const signed = await deps.signer.signEvent(template)

		// Construct-then-verify: the claim must be re-derivable from the auction root by anyone
		// reading it. Verify what we are about to send, not what we intended to send.
		const reparsed = parseAuctionPolicyVerdictEvent(signed)
		if (!reparsed.ok) {
			const reasons = ['the signed claim does not parse as an auction-level verdict']
			deps.logger?.warn(`[validator] refusing to publish policy claim for ${auction.rootEventId.slice(0, 8)}: ${reasons.join('; ')}`)
			return { status: 'refused', issues, reasons }
		}
		const verdict = verifyAuctionPolicyInvalidClaim(reparsed.value, input)
		if (!verdict.ok) {
			deps.logger?.warn(
				`[validator] refusing to publish policy claim for ${auction.rootEventId.slice(0, 8)}: ${verdict.reasons.join('; ')}`,
			)
			return { status: 'refused', issues, reasons: verdict.reasons }
		}

		await deps.relayPool.publish(signed)
		announced.set(auction.rootEventId, signature)
		deps.logger?.info(`[validator] published auction_policy_invalid for ${auction.rootEventId.slice(0, 8)} — ${issues.join(', ')}`)

		return { status: 'published', issues }
	}

	return { consider, announcedCount: () => announced.size }
}
