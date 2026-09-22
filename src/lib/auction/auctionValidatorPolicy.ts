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

export const AUCTION_VALIDATOR_POLICY_ISSUE_CODES = [
	'pool_below_minimum',
	'quorum_below_majority',
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
	/** `max(declaredQuorum, majorityFloor)` — what an outcome must actually reach. */
	readonly requiredQuorum: number
	readonly minimumPool: number
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

export const assessAuctionValidatorPolicy = (input: AuctionValidatorPolicyInput): AuctionValidatorPolicyAssessment => {
	const pool = Array.from(new Set(input.auditors))
	const poolSize = pool.length
	const declaredQuorum =
		Number.isSafeInteger(input.auditor_quorum) && (input.auditor_quorum as number) > 0 ? (input.auditor_quorum as number) : 0
	const majorityFloor = requiredVerdictMajority(poolSize)
	const requiredQuorum = Math.max(declaredQuorum, majorityFloor)

	// The multiparty policy is the strict one. Anything else is treated as the
	// legacy single-party policy, whose existing auctions are grandfathered.
	const isMultiparty = input.settlement_policy === AUCTION_MULTIPARTY_SETTLEMENT_POLICY
	const minimumPool = isMultiparty ? AUCTION_MINIMUM_VALIDATORS : 1
	const poolSeverity: AuctionValidatorPolicySeverity = isMultiparty ? 'invalid' : 'warning'

	const issues: AuctionValidatorPolicyIssue[] = []

	// Reported against the same threshold for both policies, so a grandfathered
	// single-validator auction is still visible — it is merely not invalidated.
	if (poolSize < AUCTION_MINIMUM_VALIDATORS) {
		issues.push({
			code: 'pool_below_minimum',
			severity: poolSeverity,
			detail:
				`This auction lists ${poolSize} validator(s); at least ${minimumPool} ` +
				(isMultiparty ? 'are required.' : 'is required, and new auctions require at least 2.') +
				` A pool of ${AUCTION_RECOMMENDED_VALIDATOR_POOL} is recommended, since two validators ` +
				'must agree unanimously to form a majority.',
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
		requiredQuorum,
		minimumPool,
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
export const AUCTION_POLICY_INVALID_CLAIM = 'auction_policy_invalid'

/** Whether a bid may be treated as valid at all, given the auction's assessment. */
export const bidSelectableUnderAuctionPolicy = (assessment: AuctionValidatorPolicyAssessment): boolean => assessment.valid
