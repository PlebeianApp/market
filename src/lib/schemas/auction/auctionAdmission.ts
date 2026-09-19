/**
 * Spec-validity admission for kind-30408 auction listing events.
 *
 * Why this exists
 * ---------------
 * The auction feed and the browse surfaces are ordered by "Ending Soon", which
 * makes any event that is *shaped* like a 30408 but is not a well-formed
 * auction a first-class problem: a malformed event whose `end_at` is absent
 * reads as `0`, `0` is never "ended", and `0` beats every real `end_at` in the
 * comparison — so it takes slot #1 on the browse page and renders "No end
 * date". See AUCTIONS.md §4.1 (required tags) and §6.0 (the three timestamps).
 *
 * The rule, stated once
 * ---------------------
 * An event is admissible when the repository's own parser accepts it. There is
 * deliberately no second definition of "valid" here: `inspectAuctionAdmission`
 * calls `parseAuctionEvent` and only translates its structured failure into
 * tag-scoped, user-facing reasons. If the parser learns a new constraint, the
 * gate learns it too — the alternative (a hand-maintained required-tag list)
 * is the drift that produced the original defect.
 *
 * No warning tier: everything gates
 * ---------------------------------
 * Every issue this module reports excludes the event from the discovery
 * surfaces, and the detail page (which still resolves it by direct link, per
 * ADR-0009's reachability rule) shows a notice naming the offending tags.
 *
 * There used to be a second, non-gating severity for the one zero-cutoff shape
 * the parser accepted (`start_at = 0` + `end_at = 0`): it was warned about and
 * sorted last instead of being refused, because §4.1 constrains the *format* of
 * the timing tags ("unix seconds") rather than their range. The maintainer
 * ruled on 2026-09-19 that a malformed event format gates completely — so the
 * range is now part of the format, the parser refuses a zero timing value
 * (`positiveUnixSeconds`), and that severity has no cases left. Keeping the
 * branch would have meant keeping a rule the spec no longer has.
 */

import type { ZodError } from 'zod'

import type { NostrEventLike } from '../../nostr/eventLike'
import { parseAuctionEvent } from './auctionEvent'

export type AuctionAdmissionIssueCode = 'wrong_kind' | 'missing_required_tag' | 'invalid_tag_value'

export interface AuctionAdmissionIssue {
	code: AuctionAdmissionIssueCode
	/** Protocol tag the issue is about, when it is tag-scoped. */
	tag?: string
	/** One-clause, user-facing reason. Rendered by the malformed-event notice. */
	message: string
}

export interface AuctionAdmission {
	/** True when the parser accepted the event, i.e. `issues` is empty. */
	admissible: boolean
	issues: AuctionAdmissionIssue[]
}

/**
 * Parser field path → protocol tag, so a Zod failure can be reported against
 * the tag the publisher actually wrote. Fields that are not tags (`content`,
 * `coordinate`) map to themselves and are reported without a tag name.
 */
const AUCTION_FIELD_TAGS: Record<string, string> = {
	dTag: 'd',
	coordinate: 'd',
	sellerPubkey: 'pubkey',
	rootEventId: 'auction_root_event_id',
	title: 'title',
	summary: 'summary',
	auctionType: 'auction_type',
	startAt: 'start_at',
	endAt: 'end_at',
	maxEndAt: 'max_end_at',
	settlementGrace: 'settlement_grace',
	currency: 'currency',
	reserve: 'reserve',
	startingBid: 'starting_bid',
	bidIncrement: 'bid_increment',
	minBidCurve: 'min_bid_curve',
	settlementPolicy: 'settlement_policy',
	keyScheme: 'key_scheme',
	mints: 'mint',
	p2pkXpub: 'p2pk_xpub',
	auditors: 'auditors',
	auditorQuorum: 'auditor_quorum',
	maxSkewSec: 'max_skew_sec',
	fallbackDelaySec: 'fallback_delay_sec',
	vadiumRatioBps: 'vadium_ratio_bps',
	schema: 'schema',
}

const tagForFieldPath = (path: readonly PropertyKey[]): string | undefined => {
	const field = path[0]
	if (typeof field !== 'string') return undefined
	return AUCTION_FIELD_TAGS[field] ?? field
}

/**
 * Translate a Zod failure into tag-scoped issues. One issue per failing field:
 * the schema can report several constraints on the same value, and the notice
 * needs one line per tag, not one line per constraint.
 */
const issuesFromZodError = (error: ZodError): AuctionAdmissionIssue[] => {
	const byTag = new Map<string, AuctionAdmissionIssue>()
	for (const issue of error.issues) {
		const tag = tagForFieldPath(issue.path)
		const key = `${tag ?? 'event'}:${issue.code}`
		if (byTag.has(key)) continue
		byTag.set(key, {
			code: 'invalid_tag_value',
			tag,
			message: tag ? `tag \`${tag}\` is invalid — ${issue.message}` : `event is invalid — ${issue.message}`,
		})
	}
	return Array.from(byTag.values())
}

/**
 * Inspect a single event. Pure and synchronous: the feed gate runs it per
 * event, and the detail-page notice runs it during render.
 */
export const inspectAuctionAdmission = (event: NostrEventLike): AuctionAdmission => {
	const issues: AuctionAdmissionIssue[] = []

	const parsed = parseAuctionEvent(event)
	if (!parsed.ok) {
		if ('issues' in parsed.error) {
			issues.push(...issuesFromZodError(parsed.error))
		} else {
			const failure = parsed.error
			issues.push({
				// The parser only emits these two codes today; anything new is
				// reported as a structural failure rather than silently dropped.
				code: failure.code === 'wrong_kind' ? 'wrong_kind' : 'missing_required_tag',
				tag: failure.tag,
				message: failure.message,
			})
		}
	}

	return {
		admissible: issues.length === 0,
		issues,
	}
}

/** Convenience predicate for a single event. */
export const isAdmissibleAuctionEvent = (event: NostrEventLike): boolean => inspectAuctionAdmission(event).admissible

/**
 * The feed/browse gate. Fail-open in the same sense as the label gate: an event
 * is dropped only because the parser actively rejected it, never because a
 * dependency was missing.
 */
export const filterAdmissibleAuctionEvents = <T extends NostrEventLike>(events: T[]): T[] => events.filter(isAdmissibleAuctionEvent)

/** Compact "missing `end_at`, missing `starting_bid`" summary for notices/logs. */
export const summarizeAuctionAdmissionIssues = (issues: AuctionAdmissionIssue[]): string =>
	issues.map((issue) => (issue.tag ? `${issue.tag}` : issue.code)).join(', ')
