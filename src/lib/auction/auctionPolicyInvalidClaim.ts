/**
 * The `auction_policy_invalid` claim — the auction-level verdict a validator publishes when
 * an auction's **own** validator policy is broken.
 *
 * Why this exists as its own module: the policy assessment (`assessAuctionValidatorPolicy`)
 * answers "is this auction admissible?" and is used by the publish path and the UI. This
 * module turns that same assessment into a *wire artifact* a validator can publish, so a
 * buyer who never opened the seller's form can see that the auction's outcome is
 * inadmissible — and so the finding is attributable to a validator's key rather than being
 * a client-side opinion.
 *
 * Two rules the shape encodes:
 *
 * 1. It addresses the auction ROOT, never a bid. The d-tag is
 *    `auction_policy:<root_event_id>`, disjoint from the per-bid `<bidder>:<root>:<bid>`
 *    space, and the per-bid parser refuses these events outright. Counting this claim as a
 *    bid condemnation would invalidate every bid in the auction (ADR-0003 Appendix D).
 * 2. It is published only when the assessment is actually broken, and the document carries
 *    the assessment's own numbers (pool, declared quorum, required quorum, issue codes) so a
 *    reader can re-derive it from the auction root and the validators' published rulesets
 *    instead of trusting the wording.
 */

import {
	AUCTION_POLICY_INVALID_CLAIM,
	AUCTION_POLICY_VERDICT_SCHEMA_TYPE,
	AUCTION_VERDICT_D_PREFIX,
	type AuctionLevelValidatorClaim,
} from './constants'
import {
	assessAuctionValidatorPolicy,
	type AuctionValidatorPolicyAssessment,
	type AuctionValidatorPolicyInput,
	type AuctionValidatorRuleset,
} from './auctionValidatorPolicy'
import type { AuctionPolicyVerdictDocument, ParsedAuctionPolicyVerdictEvent } from './events'

/** Everything a validator needs to decide, and to say, that an auction's policy is broken. */
export interface AuctionPolicyClaimInput {
	/** The auction root event id the claim addresses. */
	readonly auctionRootEventId: string
	/** The auction's addressable coordinate (`30408:<pubkey>:<d>`). */
	readonly auctionCoordinate: string
	/** The root's policy fields, as read from the event. */
	readonly policy: AuctionValidatorPolicyInput
	/** The observing validator's own ruleset; omitted means the legacy single-party policy. */
	readonly ruleset?: Partial<AuctionValidatorRuleset>
	/** The validator's own observation timestamp (not the publish time). */
	readonly observedAt: number
}

export interface AuctionPolicyInvalidClaim {
	readonly claim: AuctionLevelValidatorClaim
	readonly dTag: string
	readonly auctionRootEventId: string
	readonly auctionCoordinate: string
	readonly observedAt: number
	readonly document: AuctionPolicyVerdictDocument
}

export interface AuctionPolicyClaimAssessment {
	/** True when the policy carries at least one `invalid`-severity issue. */
	readonly broken: boolean
	/** The underlying assessment, so callers can show the same findings the claim names. */
	readonly assessment: AuctionValidatorPolicyAssessment
	/** Present iff `broken` — the claim to publish. */
	readonly claim?: AuctionPolicyInvalidClaim
}

/**
 * Assess an auction root's validator policy and, when it is broken, produce the claim.
 *
 * A policy that is merely *grandfathered* (legacy single-party findings) is not broken: those
 * auctions predate the multiparty rules and must keep behaving exactly as they did.
 */
export const assessAuctionPolicyClaim = (input: AuctionPolicyClaimInput): AuctionPolicyClaimAssessment => {
	const assessment = assessAuctionValidatorPolicy(input.policy, input.ruleset)
	if (assessment.valid) {
		// Nothing at `invalid` severity: the auction's policy holds, so there is no claim to make.
		return { broken: false, assessment }
	}

	return {
		broken: true,
		assessment,
		claim: {
			claim: AUCTION_POLICY_INVALID_CLAIM,
			dTag: `${AUCTION_VERDICT_D_PREFIX}${input.auctionRootEventId}`,
			auctionRootEventId: input.auctionRootEventId,
			auctionCoordinate: input.auctionCoordinate,
			observedAt: input.observedAt,
			document: {
				type: AUCTION_POLICY_VERDICT_SCHEMA_TYPE,
				pool_size: assessment.poolSize,
				declared_quorum: assessment.declaredQuorum,
				required_quorum: assessment.requiredQuorum,
				issues: assessment.issues
					.filter((issue) => issue.severity === 'invalid')
					.map((issue) => ({ code: issue.code, detail: issue.detail })),
			},
		},
	}
}

/**
 * Tags for the auction-level verdict event (kind 30440).
 *
 * Same tag vocabulary as a per-bid verdict minus the bid-specific ones (`p`, `bid`): there is
 * no bidder and no bid to name. `reason` carries the first issue's code so a relay-side
 * filter can find these without parsing content.
 */
export const buildAuctionPolicyInvalidClaimTags = (claim: AuctionPolicyInvalidClaim): string[][] => {
	const tags: string[][] = [
		['d', claim.dTag],
		['a', claim.auctionCoordinate],
		['e', claim.auctionRootEventId],
		['claim', claim.claim],
		['observed_at', String(claim.observedAt)],
	]
	const firstIssue = claim.document.issues[0]
	if (firstIssue) tags.push(['reason', firstIssue.code])
	return tags
}

/** The claim's content JSON: the assessment's own numbers, verbatim. */
export const buildAuctionPolicyInvalidClaimContent = (claim: AuctionPolicyInvalidClaim): string => JSON.stringify(claim.document)

/**
 * Re-derive a received claim from the auction root and compare — construct-then-verify, the
 * same discipline the multiparty publishers use.
 *
 * Deliberately *not* compared: `observedAt` (a validator's clock is its own) and the event's
 * `created_at` (the publish time). Everything that changes what the claim *means* is checked.
 */
export const verifyAuctionPolicyInvalidClaim = (
	parsed: ParsedAuctionPolicyVerdictEvent,
	input: AuctionPolicyClaimInput,
): { ok: boolean; reasons: readonly string[] } => {
	const reasons: string[] = []

	if (parsed.claim !== AUCTION_POLICY_INVALID_CLAIM) {
		reasons.push(`claim is "${parsed.claim}", not "${AUCTION_POLICY_INVALID_CLAIM}"`)
	}
	if (parsed.dTag !== `${AUCTION_VERDICT_D_PREFIX}${input.auctionRootEventId}`) {
		reasons.push(`d tag "${parsed.dTag}" does not address auction root ${input.auctionRootEventId}`)
	}
	if (parsed.auctionRootEventId !== input.auctionRootEventId) {
		reasons.push(`event tag names root ${parsed.auctionRootEventId}, expected ${input.auctionRootEventId}`)
	}
	if (parsed.auctionCoordinate !== input.auctionCoordinate) {
		reasons.push(`event tag names coordinate ${parsed.auctionCoordinate}, expected ${input.auctionCoordinate}`)
	}

	const derived = assessAuctionPolicyClaim(input)
	if (!derived.broken || !derived.claim) {
		reasons.push('the auction policy is not broken, so this claim is not warranted')
		return { ok: false, reasons }
	}

	const expected = derived.claim.document
	if (parsed.document.pool_size !== expected.pool_size) {
		reasons.push(`pool_size ${parsed.document.pool_size}, expected ${expected.pool_size}`)
	}
	if (parsed.document.declared_quorum !== expected.declared_quorum) {
		reasons.push(`declared_quorum ${parsed.document.declared_quorum}, expected ${expected.declared_quorum}`)
	}
	if (parsed.document.required_quorum !== expected.required_quorum) {
		reasons.push(`required_quorum ${parsed.document.required_quorum}, expected ${expected.required_quorum}`)
	}
	const parsedCodes = parsed.document.issues.map((issue) => issue.code).sort()
	const expectedCodes = expected.issues.map((issue) => issue.code).sort()
	if (parsedCodes.join(',') !== expectedCodes.join(',')) {
		reasons.push(`issues [${parsedCodes.join(', ')}], expected [${expectedCodes.join(', ')}]`)
	}

	return { ok: reasons.length === 0, reasons }
}

/** What a page needs to say about the claims it found for one auction. */
export interface AuctionPolicyInvalidSummary {
	/** One claim per validator — the newest the caller supplied for each. */
	readonly claims: readonly ParsedAuctionPolicyVerdictEvent[]
	/** The union of the claimed issues, de-duplicated by code, in first-seen order. */
	readonly issues: readonly { readonly code: string; readonly detail: string }[]
}

/**
 * Collapse the auction-level claims observed for one auction into what a reader should see.
 *
 * Input order decides which claim wins for a validator: callers pass newest-first (the verdict
 * query already sorts that way), and the first claim per validator is kept — the address
 * `auction_policy:<root>` is parameterized-replaceable, so an older claim for the same
 * validator is stale by construction.
 *
 * Issues are unioned by code, not concatenated: when several validators report the same broken
 * rule, the reader should see the rule once, not once per validator. A reader therefore cannot
 * conclude "three problems" from three validators agreeing on one.
 */
export const summarizeAuctionPolicyClaims = (claims: readonly ParsedAuctionPolicyVerdictEvent[]): AuctionPolicyInvalidSummary => {
	const perValidator = new Map<string, ParsedAuctionPolicyVerdictEvent>()
	const issues = new Map<string, string>()

	for (const claim of claims) {
		if (perValidator.has(claim.validatorPubkey)) continue
		perValidator.set(claim.validatorPubkey, claim)
		for (const issue of claim.document.issues) {
			if (!issues.has(issue.code)) issues.set(issue.code, issue.detail)
		}
	}

	return {
		claims: Array.from(perValidator.values()),
		issues: Array.from(issues.entries()).map(([code, detail]) => ({ code, detail })),
	}
}
