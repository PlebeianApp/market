/**
 * Auction-level validator policy assessment.
 *
 * The quorum rules in `verdictMajority.ts` decide how many agreeing validators an
 * outcome needs. This module decides whether the auction's *declared* validator
 * configuration is admissible at all, so a validator can mark the auction itself
 * invalid rather than pretending a broken configuration can still produce a valid
 * outcome.
 *
 * Two configurations are inadmissible for a multiparty auction:
 *
 * - **Too few validators.** A pool below `AUCTION_MINIMUM_VALIDATORS` cannot form a
 *   majority with any redundancy; the point of validators is corroboration, and one
 *   validator corroborates nothing.
 * - **A quorum below the strict-majority floor.** The seller declared a number a
 *   disjoint group could match, so the auction is forkable by construction.
 *
 * Note the deliberate asymmetry for the legacy single-party policy: those rules are
 * reported as **warnings**, not invalidity, because every auction published before
 * this rule has a single validator and invalidating live sales for a rule their
 * sellers never had the chance to meet would be indefensible. Tighten
 * `singlePartyMinimumPoolSeverity` when the policy is ready to be applied
 * retroactively — it is a one-line change and the tests pin both behaviours.
 *
 * The majority floor in `verdictQuorum.ts` stays as a backstop: even a client that
 * fails to run this assessment cannot accept an outcome with at most half the pool
 * behind it.
 *
 * Pure. No relay, wallet or persistence I/O.
 */

import { AUCTION_MULTIPARTY_SETTLEMENT_POLICY } from './multipartySchedule'
import { requiredVerdictMajority } from './verdictMajority'

/** A multiparty auction MUST list at least this many validators. */
export const AUCTION_MINIMUM_VALIDATORS = 2

/**
 * Recommended pool: the smallest size that is both fork-proof and tolerates one
 * unavailable validator (`P = 2` forces unanimity).
 */
export const AUCTION_RECOMMENDED_VALIDATOR_POOL = 3

/**
 * The one rule no ruleset can weaken: an outcome needs **more than half** of the
 * pool. Everything else about the validator set is the ruleset's business.
 */
export const AUCTION_HARD_MINIMUM_QUORUM_PERCENT = 50

/**
 * A validator's requirements of the auctions it will validate. Customizable per
 * validator — published in its policy document — with a single strict constraint:
 * `minimum_quorum_percent` MUST exceed 50, because a lower value admits two
 * disjoint groups agreeing on opposite outcomes.
 */
export interface AuctionValidatorRuleset {
	readonly minimum_validators: number
	readonly minimum_quorum_percent: number
}

export const DEFAULT_AUCTION_VALIDATOR_RULESET: AuctionValidatorRuleset = Object.freeze({
	minimum_validators: AUCTION_MINIMUM_VALIDATORS,
	minimum_quorum_percent: AUCTION_HARD_MINIMUM_QUORUM_PERCENT + 1,
})

export const AUCTION_VALIDATOR_RULESET_MAX_VALIDATORS = 16

/**
 * Clamp a caller-supplied ruleset to what the protocol permits. A ruleset is
 * data from a third party (a validator's published policy), so it is treated as
 * untrusted: percentages at or below the hard floor are raised, and non-integer or
 * out-of-range counts fall back to the defaults rather than being honoured.
 */
export const sanitizeAuctionValidatorRuleset = (ruleset?: Partial<AuctionValidatorRuleset>): AuctionValidatorRuleset => {
	const rawValidators = ruleset?.minimum_validators
	const rawPercent = ruleset?.minimum_quorum_percent

	const minimumValidators =
		Number.isSafeInteger(rawValidators) &&
		(rawValidators as number) >= 1 &&
		(rawValidators as number) <= AUCTION_VALIDATOR_RULESET_MAX_VALIDATORS
			? (rawValidators as number)
			: DEFAULT_AUCTION_VALIDATOR_RULESET.minimum_validators

	const minimumQuorumPercent =
		Number.isSafeInteger(rawPercent) && (rawPercent as number) > AUCTION_HARD_MINIMUM_QUORUM_PERCENT
			? Math.min(rawPercent as number, 100)
			: DEFAULT_AUCTION_VALIDATOR_RULESET.minimum_quorum_percent

	return Object.freeze({ minimum_validators: minimumValidators, minimum_quorum_percent: minimumQuorumPercent })
}

/** The count a ruleset's percentage demands of a pool: `ceil(P × percent / 100)`. */
export const rulesetRequiredQuorum = (ruleset: AuctionValidatorRuleset, poolSize: number): number =>
	poolSize <= 0 ? 0 : Math.ceil((poolSize * ruleset.minimum_quorum_percent) / 100)

/**
 * The caution a pool of one or two validators deserves, or `null` when the pool is big
 * enough to tolerate an absence.
 *
 * Copy, not policy: the ruleset decides whether a pool is *admissible*, this only states
 * what a small pool costs. It lives here rather than in the form so the wording is one
 * string with one owner, testable without a render.
 */
export const describeValidatorPoolCaution = (poolSize: number): string | null => {
	if (poolSize <= 0 || poolSize >= AUCTION_RECOMMENDED_VALIDATOR_POOL) return null
	if (poolSize === 1) {
		return 'With one validator nothing corroborates its verdict: that validator alone decides whether a bid is real, and if it is offline the auction has no outcome at all.'
	}
	return `With two validators both must agree, so one of them being offline stalls the auction. A pool of ${AUCTION_RECOMMENDED_VALIDATOR_POOL} is the smallest that still tolerates an absence.`
}

export const AUCTION_VALIDATOR_POLICY_ISSUE_CODES = [
	/** No validator at all: nothing corroborates the outcome, so publishing refuses. */
	'no_validator',
	'pool_below_minimum',
	'quorum_below_majority',
	/** The declared quorum is below this validator's own ruleset requirement. */
	'quorum_below_ruleset',
	'quorum_exceeds_pool',
	'duplicate_auditors',
] as const

export type AuctionValidatorPolicyIssueCode = (typeof AUCTION_VALIDATOR_POLICY_ISSUE_CODES)[number]

export type AuctionValidatorPolicySeverity = 'invalid' | 'warning'

export interface AuctionValidatorPolicyIssue {
	readonly code: AuctionValidatorPolicyIssueCode
	readonly severity: AuctionValidatorPolicySeverity
	/** One sentence a UI may show verbatim. */
	readonly detail: string
}

export interface AuctionValidatorPolicyAssessment {
	/** Distinct auditor pubkeys; duplicates never inflate this. */
	readonly poolSize: number
	readonly declaredQuorum: number
	readonly majorityFloor: number
	/** The count the validator's ruleset percentage demands of this pool. */
	readonly rulesetQuorum: number
	/** `max(declaredQuorum, majorityFloor, rulesetQuorum)` — what an outcome must reach. */
	readonly requiredQuorum: number
	readonly minimumPool: number
	/** The sanitized ruleset this assessment applied. */
	readonly ruleset: AuctionValidatorRuleset
	/** Any issue at `invalid` severity. */
	readonly valid: boolean
	readonly issues: readonly AuctionValidatorPolicyIssue[]
	/** True when the only findings are grandfathered legacy-policy warnings. */
	readonly legacyTolerated: boolean
}

export interface AuctionValidatorPolicyInput {
	readonly auditors: readonly string[]
	readonly auditor_quorum?: number
	/** Defaults to the legacy single-party policy when absent. */
	readonly settlement_policy?: string
}

export const assessAuctionValidatorPolicy = (
	input: AuctionValidatorPolicyInput,
	rulesetInput?: Partial<AuctionValidatorRuleset>,
): AuctionValidatorPolicyAssessment => {
	const pool = Array.from(new Set(input.auditors))
	const poolSize = pool.length
	const declaredQuorum =
		Number.isSafeInteger(input.auditor_quorum) && (input.auditor_quorum as number) > 0 ? (input.auditor_quorum as number) : 0
	const majorityFloor = requiredVerdictMajority(poolSize)

	// The validator's own requirements. The hard >50% rule is enforced inside
	// `sanitizeAuctionValidatorRuleset`, so an untrusted ruleset cannot weaken it.
	const ruleset = sanitizeAuctionValidatorRuleset(rulesetInput)
	const rulesetQuorum = rulesetRequiredQuorum(ruleset, poolSize)
	const requiredQuorum = Math.max(declaredQuorum, majorityFloor, rulesetQuorum)

	// The multiparty policy is the strict one. Anything else is treated as the
	// legacy single-party policy, whose existing auctions are grandfathered.
	const isMultiparty = input.settlement_policy === AUCTION_MULTIPARTY_SETTLEMENT_POLICY
	const minimumPool = isMultiparty ? ruleset.minimum_validators : 1
	const poolSeverity: AuctionValidatorPolicySeverity = isMultiparty ? 'invalid' : 'warning'

	const issues: AuctionValidatorPolicyIssue[] = []

	// A validator set with nobody in it is not a warning: without a validator there is
	// nothing to corroborate a bid, so a new publish must refuse. Reported for both
	// policies — the single-party policy grandfathers an *existing* one-validator
	// auction, but it cannot wave through an auction that names nobody.
	if (poolSize === 0) {
		issues.push({
			code: 'no_validator',
			severity: 'invalid',
			detail: 'No validator is selected. An auction needs at least one validator to corroborate its outcome.',
		})
	}

	// Reported against the same threshold for both policies, so a grandfathered
	// single-validator auction is still visible — it is merely not invalidated.
	if (poolSize > 0 && poolSize < ruleset.minimum_validators) {
		issues.push({
			code: 'pool_below_minimum',
			severity: poolSeverity,
			detail:
				`This auction lists ${poolSize} validator(s); at least ${minimumPool} ` +
				(isMultiparty ? 'are required.' : `is required, and this validator requires at least ${ruleset.minimum_validators}.`) +
				` A pool of ${AUCTION_RECOMMENDED_VALIDATOR_POOL} is the smallest that still tolerates one ` +
				'being offline, and more validators make the outcome more resilient.',
		})
	}

	if (declaredQuorum > 0 && declaredQuorum < majorityFloor) {
		issues.push({
			code: 'quorum_below_majority',
			severity: 'invalid',
			detail:
				`This auction declares a quorum of ${declaredQuorum}, below the strict majority of ` +
				`${majorityFloor} required for a pool of ${poolSize}. Two disjoint groups could each reach ` +
				'quorum on opposite outcomes, so the auction is invalid until the validators agree on one result.',
		})
	}

	if (declaredQuorum > 0 && rulesetQuorum > majorityFloor && declaredQuorum < rulesetQuorum) {
		issues.push({
			code: 'quorum_below_ruleset',
			severity: 'invalid',
			detail:
				`This auction declares a quorum of ${declaredQuorum}, but this validator's ruleset requires ` +
				`${ruleset.minimum_quorum_percent}% of the pool (${rulesetQuorum} of ${poolSize}).`,
		})
	}

	if (declaredQuorum > poolSize && poolSize > 0) {
		issues.push({
			code: 'quorum_exceeds_pool',
			severity: 'invalid',
			detail:
				`This auction declares a quorum of ${declaredQuorum} but lists only ${poolSize} validator(s), ` +
				'so no outcome can ever reach quorum.',
		})
	}

	if (input.auditors.length !== poolSize) {
		issues.push({
			code: 'duplicate_auditors',
			severity: 'warning',
			detail:
				`This auction lists ${input.auditors.length} validator tag(s) but only ${poolSize} distinct ` +
				'pubkey(s); duplicates do not count toward the quorum.',
		})
	}

	const issuesOut = Object.freeze(issues.map((issue) => Object.freeze(issue)))

	return Object.freeze({
		poolSize,
		declaredQuorum,
		majorityFloor,
		rulesetQuorum,
		requiredQuorum,
		minimumPool,
		ruleset,
		valid: !issues.some((issue) => issue.severity === 'invalid'),
		issues: issuesOut,
		legacyTolerated: !isMultiparty && issuesOut.every((issue) => issue.severity === 'warning') && issuesOut.length > 0,
	})
}

/**
 * The claim a validator publishes when an auction's own validator configuration is
 * inadmissible. Root-level: it is about the auction, not about one bid, so it is
 * deliberately NOT part of `VALIDATOR_CONDEMN_CLAIMS`, which condemn bids.
 */
/**
 * The claim a validator publishes when the auction's own validator policy is broken.
 *
 * Declared in `constants.ts` with the rest of the verdict vocabulary; re-exported here
 * because this module owns the ruleset that decides when it is warranted.
 */
export { AUCTION_POLICY_INVALID_CLAIM } from './constants'

/** Whether a bid may be treated as valid at all, given the auction's assessment. */
export const bidSelectableUnderAuctionPolicy = (assessment: AuctionValidatorPolicyAssessment): boolean => assessment.valid
