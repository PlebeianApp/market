/**
 * Auction multiparty participation — validator presence gate.
 *
 * Under `cashu_p2pk_bidder_path_multiparty_v1`, validator verdicts (kind 30440)
 * count only when the validator has confirmed participation in **that** auction
 * (kind 1029 acceptance, itself bound to a kind 1028 offer and a kind 1027 payout
 * capability). A verdict from a validator that never announced participation is
 * indistinguishable from a stale or unowned voice.
 *
 * Presence is required at the **quorum**, not for every configured auditor:
 * requiring all of them would fail auctions over relay propagation differences,
 * because a client reading a different relay set may simply not see one
 * acceptance. With quorum satisfied, a client can rely on seeing that set's
 * verdicts.
 *
 * There is no separate "rejection" event. A scheduled recipient or auditor that
 * does not confirm is treated as absent — silence is a rejection, which is why
 * the projection reports `missing` rather than a rejection list.
 *
 * Policy: maintainer direction 2026-09-21, see
 * `docs/adr/proposals/auction-v4v-participation.md` D4–D6.
 *
 * This module is a **projection**, not an authorization check: it assumes its
 * inputs already passed kind-level and relation-level validation
 * (`validateMultipartyAuthorizationSnapshotRelations`). It performs no relay,
 * wallet, Cashu or persistence I/O.
 */

import type { ParsedMultipartyRoot, ParsedMultipartyValidatorAcceptance } from './multipartyAuthorization'
import { requiredVerdictMajority } from './verdictMajority'

/** The subset of a parsed root this projection depends on. */
export type MultipartyParticipationRoot = Pick<
	ParsedMultipartyRoot,
	'coordinate' | 'payout_schedule_commitment' | 'auditors' | 'auditor_quorum'
>

export const AUCTION_MULTIPARTY_PARTICIPATION_WARNINGS = [
	'quorum_not_configured',
	'quorum_exceeds_auditors',
	/** The declared `auditor_quorum` is below the strict-majority floor (§4.1). */
	'quorum_below_majority',
	'acceptance_root_mismatch',
	'acceptance_commitment_mismatch',
	'acceptance_expired',
	'acceptance_not_scheduled',
	'acceptance_duplicate',
	'validators_missing',
] as const

export type AuctionMultipartyParticipationWarning = (typeof AUCTION_MULTIPARTY_PARTICIPATION_WARNINGS)[number]

export type MultipartyParticipationStatus =
	/** No auditors configured (single-party or unvalidated): no gate applies. */
	| 'not_required'
	/** Configured quorum reached: verdicts from participating auditors count. */
	| 'quorum_met'
	/** Configured quorum not reached: bids may never become valid. */
	| 'quorum_not_met'

export interface MultipartyParticipation {
	readonly status: MultipartyParticipationStatus
	/** The requirement applied: `max(declared auditor_quorum, majority floor)`. */
	readonly quorum: number
	/** The seller's declared `auditor_quorum` (0 when the tag is absent). */
	readonly declaredQuorum: number
	/** `floor(auditorCount / 2) + 1` — the count no disjoint set can match. */
	readonly majorityFloor: number
	readonly auditorCount: number
	/** Auditors with a matching, unexpired acceptance, sorted for determinism. */
	readonly participatingAuditors: readonly string[]
	/** Configured auditors without a matching acceptance, sorted. */
	readonly missingAuditors: readonly string[]
	/** Acceptances that did not count, with the reason, for display and audit. */
	readonly disregardedAcceptances: readonly {
		readonly validatorPubkey: string
		readonly warning: AuctionMultipartyParticipationWarning
	}[]
	readonly warnings: readonly AuctionMultipartyParticipationWarning[]
	/** Whether a client should allow bidding on this auction. */
	readonly bidAllowed: boolean
}

export interface MultipartyParticipationInput {
	readonly root: MultipartyParticipationRoot
	readonly acceptances: readonly ParsedMultipartyValidatorAcceptance[]
	/** Observation time in unix seconds; acceptances at or before it are expired. */
	readonly nowUnixSeconds?: number
}

const comparePubkeys = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const uniqSorted = (values: readonly string[]): string[] => Array.from(new Set(values)).sort(comparePubkeys)

export const projectMultipartyParticipation = (input: MultipartyParticipationInput): MultipartyParticipation => {
	const { root, acceptances } = input
	const now = input.nowUnixSeconds ?? Math.floor(Date.now() / 1000)

	const auditors = uniqSorted(root.auditors)
	const auditorSet = new Set(auditors)
	const declaredQuorum = Number.isSafeInteger(root.auditor_quorum) && root.auditor_quorum > 0 ? root.auditor_quorum : 0
	// The declared quorum may only raise the bar: a pool that disagrees with itself
	// must never produce two valid outcomes (§4.1 amendment, verdictMajority.ts).
	const majorityFloor = requiredVerdictMajority(auditors.length)
	const quorum = auditors.length === 0 || declaredQuorum === 0 ? 0 : Math.max(declaredQuorum, majorityFloor)

	const warnings = new Set<AuctionMultipartyParticipationWarning>()
	const disregarded: { validatorPubkey: string; warning: AuctionMultipartyParticipationWarning }[] = []
	const accepted = new Map<string, ParsedMultipartyValidatorAcceptance>()

	for (const acceptance of acceptances) {
		const validatorPubkey = acceptance.validator_pubkey

		const disregard = (warning: AuctionMultipartyParticipationWarning): void => {
			disregarded.push({ validatorPubkey, warning })
			warnings.add(warning)
		}

		if (!auditorSet.has(validatorPubkey)) {
			disregard('acceptance_not_scheduled')
			continue
		}
		if (acceptance.auction_coordinate !== root.coordinate) {
			disregard('acceptance_root_mismatch')
			continue
		}
		if (acceptance.payout_schedule_commitment !== root.payout_schedule_commitment) {
			disregard('acceptance_commitment_mismatch')
			continue
		}
		if (acceptance.expires_at <= now) {
			disregard('acceptance_expired')
			continue
		}
		if (accepted.has(validatorPubkey)) {
			disregard('acceptance_duplicate')
			continue
		}
		accepted.set(validatorPubkey, acceptance)
	}

	const participatingAuditors = uniqSorted(Array.from(accepted.keys()))
	const missingAuditors = auditors.filter((auditor) => !accepted.has(auditor))

	if (auditors.length === 0 || quorum === 0) {
		warnings.add('quorum_not_configured')
		return Object.freeze({
			status: 'not_required' as const,
			quorum,
			declaredQuorum,
			majorityFloor,
			auditorCount: auditors.length,
			participatingAuditors,
			missingAuditors,
			disregardedAcceptances: Object.freeze(disregarded),
			warnings: Object.freeze(Array.from(warnings)),
			bidAllowed: true,
		})
	}

	if (declaredQuorum > 0 && declaredQuorum < majorityFloor) {
		// The seller declared a quorum a disjoint group could match. Clients apply the
		// majority floor and say so, rather than honouring a forkable value (§4.1).
		warnings.add('quorum_below_majority')
	}
	if (quorum > auditors.length) {
		warnings.add('quorum_exceeds_auditors')
	}
	if (missingAuditors.length > 0) {
		warnings.add('validators_missing')
	}

	const quorumMet = participatingAuditors.length >= quorum
	if (!quorumMet) {
		warnings.add('validators_missing')
	}

	return Object.freeze({
		status: quorumMet ? ('quorum_met' as const) : ('quorum_not_met' as const),
		quorum,
		declaredQuorum,
		majorityFloor,
		auditorCount: auditors.length,
		participatingAuditors,
		missingAuditors,
		disregardedAcceptances: Object.freeze(disregarded),
		warnings: Object.freeze(Array.from(warnings)),
		bidAllowed: quorumMet,
	})
}

/**
 * Whether a kind-30440 verdict from `validatorPubkey` should be counted.
 *
 * A verdict counts only from an auditor that confirmed participation on the exact
 * root and commitment the verdict is about. Non-participating auditors are not
 * disqualified from ever publishing — they are simply not counted for this auction.
 */
export const isValidatorVerdictCounted = (validatorPubkey: string, participation: MultipartyParticipation): boolean =>
	participation.participatingAuditors.includes(validatorPubkey)

/**
 * Client-facing reason text for an auction whose configured quorum cannot be
 * reached.
 *
 * This is the **single owner** of that sentence. The four multiparty check points
 * (`multipartyCheckPoints.ts`) delegate to it, so the publish screen, the auction
 * page, the bid button and the validator service cannot describe one state in three
 * different ways.
 *
 * It is gated on the participation *status* rather than on `bidAllowed`: the flag is
 * derived from the status, and an auction whose quorum is unreachable is
 * under-confirmed whatever a caller puts in the flag, so the warning cannot be
 * silenced by an inconsistent input object.
 */
export const describeBidBlock = (participation: MultipartyParticipation): string | null => {
	if (participation.status !== 'quorum_not_met') {
		return null
	}
	const missing = participation.missingAuditors.length
	return (
		`Configured ${participation.auditorCount} validator(s) with quorum ${participation.quorum}, only ` +
		`${participation.participatingAuditors.length} confirmed${missing > 0 ? ` (${missing} not seen)` : ''}. ` +
		'Bids may never become valid.'
	)
}
