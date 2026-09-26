/**
 * Auction creation workflow resolution — which step the seller is on, whether the
 * V4V/validator step is complete, and what still blocks publishing.
 *
 * This mirrors `resolveProductWorkflow` for the product flow, with one structural
 * difference that matters: the product's V4V state is **account-level** (saved once,
 * reused, so "configured to zero" counts as configured), while an auction's payout
 * schedule is **per-auction** and cryptographically committed at publish. The
 * equivalent question is therefore not "has this seller ever configured V4V" but
 * "is *this draft* publishable": does it carry an admissible validator set, and if it
 * pays anyone besides the seller, does that schedule compile?
 *
 * Pure: no relay, wallet, storage or config-store I/O. The caller supplies the
 * resolved auditor pubkeys (the form may fall back to the app default) and the raw
 * recipient lines.
 */

import {
	type AuctionValidatorPolicyAssessment,
	type AuctionValidatorRuleset,
	assessAuctionValidatorPolicy,
} from '../auction/auctionValidatorPolicy'
import {
	type AuctionMultipartyRecipientLine,
	AuctionMultipartyPublishScheduleError,
	parseMultipartyRecipientLines,
	resolveMultipartyPayoutSchedule,
} from '../auction/multipartyPublishSchedule'
import { AuctionMultipartyScheduleError, type AuctionMultipartyCanonicalSchedule } from '../auction/multipartySchedule'

/** Tabs the auction form can open on. Mirrors the form's own tab order. */
export type AuctionWorkflowTab = 'name' | 'auction' | 'category' | 'spec' | 'images' | 'shipping' | 'v4v'

export const AUCTION_V4V_TAB: AuctionWorkflowTab = 'v4v'

export type AuctionWorkflowMode = 'create' | 'edit'

export interface AuctionWorkflowIssue {
	readonly code: string
	/** One sentence the tab may show verbatim. */
	readonly message: string
	/** Where the seller has to go to fix it. */
	readonly tab: AuctionWorkflowTab
	/** `blocking` stops publishing; `warning` is shown but does not. */
	readonly severity: 'blocking' | 'warning'
}

export interface AuctionWorkflowPreview {
	readonly recipientCount: number
	readonly auxiliaryAllocationBps: number
	/** The seller's implicit share, in basis points. */
	readonly sellerRemainderBps: number
	/** Full schedule commitment, for display and comparison. */
	readonly commitment: string
}

export interface AuctionWorkflowResolution {
	readonly initialTab: AuctionWorkflowTab
	/** The V4V/validator step still has to be completed before publishing. */
	readonly requiresV4VSetup: boolean
	/** Nothing blocks publishing. */
	readonly v4vComplete: boolean
	readonly validators: AuctionValidatorPolicyAssessment
	readonly recipients: readonly AuctionMultipartyRecipientLine[]
	/** The compiled schedule, or null when the auction pays only the seller. */
	readonly schedule: AuctionMultipartyCanonicalSchedule | null
	readonly preview: AuctionWorkflowPreview | null
	readonly issues: readonly AuctionWorkflowIssue[]
	/** Blocking issues only, ready to be shown as one reason list. */
	readonly blockingMessages: readonly string[]
}

export interface AuctionWorkflowInput {
	readonly mode: AuctionWorkflowMode
	/** The auditors the root will list, resolved by the caller. */
	readonly auditors: readonly string[]
	readonly auditor_quorum?: number
	readonly settlement_policy?: string
	/** Raw textarea contents, one recipient per line. */
	readonly recipientLines: string
	readonly ruleset?: Partial<AuctionValidatorRuleset>
	/** The seller's own pubkey, so an explicit self-share can be refused. */
	readonly sellerPubkey?: string
}

const issue = (code: string, message: string, severity: AuctionWorkflowIssue['severity']): AuctionWorkflowIssue =>
	Object.freeze({ code, message, tab: AUCTION_V4V_TAB, severity })

export const resolveAuctionWorkflow = (input: AuctionWorkflowInput): AuctionWorkflowResolution => {
	const issues: AuctionWorkflowIssue[] = []

	const validators = assessAuctionValidatorPolicy(
		{
			auditors: input.auditors,
			auditor_quorum: input.auditor_quorum,
			settlement_policy: input.settlement_policy,
		},
		input.ruleset,
	)

	for (const problem of validators.issues) {
		issues.push(
			issue(
				problem.code,
				problem.detail,
				// An inadmissible validator set blocks a new publish. On an edit of an
				// already-published auction it is reported, not enforced: the root is
				// already live and its schedule is already committed.
				problem.severity === 'invalid' && input.mode === 'create' ? 'blocking' : 'warning',
			),
		)
	}

	let recipients: AuctionMultipartyRecipientLine[] = []
	let schedule: AuctionMultipartyCanonicalSchedule | null = null

	try {
		recipients = parseMultipartyRecipientLines(input.recipientLines)
	} catch (error) {
		const code =
			error instanceof AuctionMultipartyPublishScheduleError
				? error.code
				: error instanceof AuctionMultipartyScheduleError
					? error.code
					: 'payout_recipients_unreadable'
		issues.push(issue(code, describeRecipientFailure(code), 'blocking'))
	}

	if (recipients.length > 0) {
		try {
			const resolution = resolveMultipartyPayoutSchedule({
				recipients,
				auditors: input.auditors,
				sellerPubkey: input.sellerPubkey ?? '',
			})
			schedule = resolution?.schedule ?? null
		} catch (error) {
			const code =
				error instanceof AuctionMultipartyPublishScheduleError
					? error.code
					: error instanceof AuctionMultipartyScheduleError
						? error.code
						: 'payout_schedule_unresolved'
			issues.push(issue(code, describeRecipientFailure(code), 'blocking'))
			// A schedule that does not compile is not a partial schedule: publishing it
			// would commit bidders to something the seller never saw.
			schedule = null
		}
	}

	const blockingMessages = issues.filter((entry) => entry.severity === 'blocking').map((entry) => entry.message)
	const v4vComplete = blockingMessages.length === 0

	return Object.freeze({
		initialTab: 'name' as const,
		requiresV4VSetup: !v4vComplete,
		v4vComplete,
		validators,
		recipients: Object.freeze([...recipients]),
		schedule,
		preview:
			schedule === null
				? null
				: Object.freeze({
						recipientCount: schedule.entries.length,
						auxiliaryAllocationBps: schedule.auxiliary_allocation_bps,
						sellerRemainderBps: schedule.seller_remainder_bps,
						commitment: schedule.schedule_commitment,
					}),
		issues: Object.freeze(issues),
		blockingMessages: Object.freeze(blockingMessages),
	})
}

/** One sentence per failure code, so the tab and the publish refusal agree. */
export const describeRecipientFailure = (code: string): string => {
	const line = code.includes(':') ? code.slice(code.indexOf(':') + 1) : null
	const base = code.split(':')[0] as string
	const where = line === null ? '' : ` (line ${line})`

	switch (base) {
		case 'payout_recipient_line_invalid':
			return `A recipient line${where} does not have the expected fields: role, pubkey, bps, capability_event_id[, offer_event_id].`
		case 'payout_recipient_role_invalid':
			return `A recipient line${where} has an unknown role; use 'validator' or 'v4v'.`
		case 'payout_recipient_allocation_invalid':
			return `A recipient line${where} has an allocation that is not between 1 and 10000 basis points.`
		case 'payout_recipient_pubkey_noncanonical':
			return `A recipient line${where} has a pubkey that is not 64 lowercase hex characters.`
		case 'payout_recipient_capability_noncanonical':
			return `A recipient line${where} has a payout capability event id that is not 64 lowercase hex characters.`
		case 'payout_recipient_offer_noncanonical':
			return `A recipient line${where} has a validator offer event id that is not 64 lowercase hex characters.`
		case 'payout_recipient_offer_not_allowed_for_v4v':
			return `A v4v recipient${where} carries a validator offer id; only validators make offers.`
		case 'payout_recipient_validator_offer_missing':
			return 'A validator recipient has no validator offer event id; a validator share must name the offer it accepted.'
		case 'payout_recipient_validator_not_listed_as_auditor':
			return "A validator recipient is not one of the auction's auditors, so no verdict would exist for a share the schedule pays."
		case 'payout_recipient_seller_included':
			return 'The seller is listed as a recipient; the seller keeps the remainder automatically.'
		case 'payout_recipient_count_exceeds_limit':
			return 'Too many recipients: one seller plus at most sixteen entries.'
		case 'schedule_duplicate_role_recipient':
			return 'The same recipient appears twice with the same role.'
		case 'schedule_allocation_exceeds_total':
			return 'The allocations add up to 10000 basis points or more, leaving the seller nothing.'
		default:
			return `The payout schedule could not be built (${code}).`
	}
}
