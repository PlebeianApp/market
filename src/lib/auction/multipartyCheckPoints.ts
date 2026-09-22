/**
 * The four multiparty check points, as pure gates.
 *
 * The projections that answer each question already exist and are tested
 * separately: publish readiness (recipient liveness), participation (validator
 * confirmations and quorum), the leg floor (minimum bid), and release
 * verification (settlement). What was missing is a single place that turns them
 * into the four decisions the client actually asks for, with one shared wording so
 * the publish screen, the auction page, the bid button and the validator service
 * cannot drift apart.
 *
 *   publish    -> may this auction be published at all?
 *   read       -> what may a reader be told about this auction?
 *   bid        -> may this bid be placed, and what must the bidder be warned about?
 *   settlement -> does this release settle the schedule that was announced?
 *
 * Every gate is a pure function of already-parsed inputs. No gate reads relays, no
 * gate moves funds, and every result is frozen and deterministic.
 */

import type { ParsedMultipartySellerActivation } from './multipartyAuthorization'
import { computeMultipartyLegFloor, isLegLockedAmountAboveFloor, type MultipartyLegFloor } from './multipartyLegFloor'
import type { AuctionMultipartyCanonicalManifestRow } from './multipartyManifestWire'
import type { MultipartyParticipation } from './multipartyParticipation'
import { describeBidBlock } from './multipartyParticipation'
import type { MultipartyPublishReadiness } from './multipartyPublishReadiness'
import { describePublishBlock } from './multipartyPublishReadiness'
import { requireCommittedPath, verifyMultipartyRelease } from './multipartyReleaseWire'

export type MultipartyCheckPointName = 'publish' | 'read' | 'bid' | 'settlement'

/** `allowed` proceeds, `warned` proceeds with a mandatory message, `blocked` stops. */
export type MultipartyVerdict = 'allowed' | 'warned' | 'blocked'

export interface MultipartyCheckPointResult {
	readonly checkpoint: MultipartyCheckPointName
	readonly verdict: MultipartyVerdict
	/** Machine-readable reasons; empty when nothing is wrong. */
	readonly reasons: readonly string[]
	/** Human sentences, one per concern, in a stable order. */
	readonly messages: readonly string[]
	/** The single shared validator-shortfall sentence, when one applies. */
	readonly shortfall: string | null
}

const freezeResult = (result: MultipartyCheckPointResult): MultipartyCheckPointResult =>
	Object.freeze({
		...result,
		reasons: Object.freeze([...result.reasons]),
		messages: Object.freeze([...result.messages]),
	})

/**
 * One shared wording for the most common blocking condition, used by all four
 * check points.
 *
 * It is gated on the participation *status*, not on the bid flag: an auction whose
 * configured quorum is unreachable is under-confirmed whatever a caller puts in
 * `bidAllowed`, so the sentence cannot be silenced by an inconsistent input object.
 */
export const describeValidatorShortfall = (participation: MultipartyParticipation): string | null => {
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

const verdictOf = (reasons: readonly string[], messages: readonly string[]): MultipartyVerdict =>
	reasons.length > 0 ? 'blocked' : messages.length > 0 ? 'warned' : 'allowed'

export interface MultipartyPublishGateInput {
	readonly readiness: MultipartyPublishReadiness
	readonly participation: MultipartyParticipation
}

/**
 * Publish gate: the liveness obligation blocks, an under-confirmed validator set
 * only warns. Publishing is the seller's decision, but an auction whose quorum is
 * already unreachable will never produce valid bids.
 */
export const checkMultipartyPublishGate = (input: MultipartyPublishGateInput): MultipartyCheckPointResult => {
	const reasons: string[] = []
	const messages: string[] = []

	if (input.readiness.blockedByObligation) {
		reasons.push('publish_blocked_by_recipient_liveness')
	}
	const publishBlock = describePublishBlock(input.readiness)
	if (publishBlock !== null && input.readiness.blockedByObligation) {
		messages.push(publishBlock)
	}

	const shortfall = describeValidatorShortfall(input.participation)
	if (shortfall !== null) {
		reasons.push('publish_participation_shortfall')
		messages.push(shortfall)
	}

	return freezeResult({
		checkpoint: 'publish',
		verdict: verdictOf(reasons, messages),
		reasons,
		messages,
		shortfall,
	})
}

export interface MultipartyReadStatusInput {
	readonly participation: MultipartyParticipation
	/** The seller's activation event for this auction, once published. */
	readonly activation?: ParsedMultipartySellerActivation
}

/**
 * Read status: what a reader may be told. An auction whose quorum is unreachable
 * is blocked for reading purposes too, because a client must not present bids that
 * can never become valid as if they could.
 */
export const checkMultipartyReadStatus = (input: MultipartyReadStatusInput): MultipartyCheckPointResult => {
	const reasons: string[] = []
	const messages: string[] = []
	const shortfall = describeValidatorShortfall(input.participation)

	if (input.participation.status === 'quorum_not_met') {
		reasons.push('read_quorum_not_met')
		if (shortfall !== null) {
			messages.push(shortfall)
		}
	}

	if (input.participation.status === 'quorum_met' && input.activation === undefined) {
		messages.push(
			`Quorum reached (${input.participation.participatingAuditors.length} of ` +
				`${input.participation.auditorCount}) but the seller has not published an activation for this ` +
				'auction yet; settlement is not yet authorised.',
		)
	}

	if (input.participation.status === 'quorum_met' && input.activation !== undefined) {
		messages.push(`Quorum reached and the seller activation is published; settlement is authorised at the committed ` + 'schedule.')
	}

	return freezeResult({
		checkpoint: 'read',
		verdict: verdictOf(reasons, messages),
		reasons,
		messages,
		shortfall,
	})
}

export interface MultipartyBidGateInput {
	readonly participation: MultipartyParticipation
	readonly legFloor: MultipartyLegFloor
	readonly bidAmountSats: number
	/** Whether an activation must exist before a bid is accepted. Default false. */
	readonly activationRequired?: boolean
	readonly activation?: ParsedMultipartySellerActivation
}

/**
 * Bid gate: the check the bid button needs before it may be pressed. A blocked gate
 * never allows the bid; a warned gate allows it while telling the bidder exactly
 * what may go wrong — that wording is the shared shortfall sentence.
 */
export const checkMultipartyBidGate = (input: MultipartyBidGateInput): MultipartyCheckPointResult => {
	const reasons: string[] = []
	const messages: string[] = []
	const shortfall = describeValidatorShortfall(input.participation)

	if (!input.participation.bidAllowed) {
		reasons.push('bid_not_allowed_by_participation')
		const wording = shortfall ?? describeBidBlock(input.participation)
		if (wording !== null) {
			messages.push(wording)
		}
	}

	if (input.activationRequired === true && input.activation === undefined) {
		reasons.push('bid_activation_missing')
		messages.push('This auction has no seller activation yet, so settlement is not authorised.')
	}

	if (!isLegLockedAmountAboveFloor(input.bidAmountSats, input.legFloor)) {
		reasons.push('bid_below_leg_floor')
		messages.push(
			`A bid must lock at least ${input.legFloor.minimumBidSats} sat across ` +
				`${input.legFloor.payoutLegCount} payout leg(s); ${input.bidAmountSats} sat is below that floor.`,
		)
	}

	return freezeResult({
		checkpoint: 'bid',
		verdict: verdictOf(reasons, messages),
		reasons,
		messages,
		shortfall,
	})
}

export interface MultipartySettlementGateInput {
	readonly rows: readonly AuctionMultipartyCanonicalManifestRow[]
	readonly payoutXpubForRow: (row: AuctionMultipartyCanonicalManifestRow) => string
	readonly deriveChildPubkey: (payoutXpub: string, derivationPath: string) => string
	readonly release: {
		readonly derivationPath: string
		readonly scheduleCommitment: string
		readonly manifestCommitment: string
		readonly pathCommitment?: string
	}
	readonly expectedScheduleCommitment: string
	readonly expectedManifestCommitment: string
	readonly committedPath?: string
	/** Whether an activation must exist before a release may settle. Default true. */
	readonly activationRequired?: boolean
	readonly activation?: ParsedMultipartySellerActivation
}

/**
 * Settlement gate: an activation must exist (unless the caller says otherwise) and
 * the release must reproduce every locked child key. One unrespected recipient is
 * grief, so the result names the affected manifest indexes.
 */
export const checkMultipartySettlementGate = (input: MultipartySettlementGateInput): MultipartyCheckPointResult => {
	const reasons: string[] = []
	const messages: string[] = []

	if ((input.activationRequired ?? true) && input.activation === undefined) {
		reasons.push('settlement_activation_missing')
		messages.push('No seller activation exists for this auction, so no release can settle it.')
	}

	const verification = verifyMultipartyRelease({
		rows: input.rows,
		payoutXpubForRow: input.payoutXpubForRow,
		deriveChildPubkey: input.deriveChildPubkey,
		release: input.release,
		expectedScheduleCommitment: input.expectedScheduleCommitment,
		expectedManifestCommitment: input.expectedManifestCommitment,
	})

	const pathFailure = requireCommittedPath(input.release, input.committedPath)
	const failures = [...verification.failures, ...(pathFailure === null ? [] : [pathFailure])]

	if (!verification.ok || pathFailure !== null) {
		reasons.push('settlement_release_invalid', ...failures)
		for (const failure of failures) {
			messages.push(describeSettlementFailure(failure, verification.mismatchedIndexes))
		}
	}

	return freezeResult({
		checkpoint: 'settlement',
		verdict: verdictOf(reasons, messages),
		reasons,
		messages,
		shortfall: null,
	})
}

const describeSettlementFailure = (failure: string, mismatchedIndexes: readonly number[]): string => {
	switch (failure) {
		case 'release_derivation_mismatch':
			return (
				`${mismatchedIndexes.length} payout leg(s) do not derive from the announced xpub at the released ` +
				`path (manifest index(es) ${mismatchedIndexes.join(', ')}). This is grief.`
			)
		case 'release_schedule_commitment_mismatch':
			return 'The release does not bind the payout schedule that was announced on the auction.'
		case 'release_manifest_commitment_mismatch':
			return 'The release does not bind the payout manifest that this bid committed to.'
		case 'release_path_commitment_missing':
			return 'This bid committed to a derivation path up front, but the release omits it.'
		case 'release_path_commitment_mismatch':
			return 'The released path does not match the path this bid committed to up front.'
		case 'release_rows_empty':
			return 'The payout manifest is empty, so there is nothing to settle.'
		default:
			return `The release failed verification (${failure}).`
	}
}
