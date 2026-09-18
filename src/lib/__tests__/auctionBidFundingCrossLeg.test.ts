/**
 * #1235 Blocking 5 — cross-leg verdict leak.
 *
 * Review contract item 5 (unit test):
 *   starting a second funding session does not render the previous leg's
 *   confirm quorum for the new bid.
 *
 * Invariant chain under test (each link is production code):
 *
 *   1. `nextPublishedBidEventIdOnSessionStart` — `startFundingForBid` resets
 *      the session-scoped published-event-id tracker, so a rebid's progress
 *      dialog receives NO event id until the new leg publishes.
 *   2. `resolveProgressDialogVerdictQuorum` — the dialog binds NO verdicts
 *      while it has no session event id. This matters because
 *      `computeVerdictQuorum`'s `bidEventId === undefined` mode is a legacy
 *      NO-FILTER mode: without the dialog-side gate, the previous leg's
 *      confirm verdicts would still count.
 *   3. Once the new session publishes its own id, only verdicts bound to
 *      exactly that id count (`computeVerdictQuorum` binding).
 *
 * The dialog component itself is portal-rendered (Radix), so its DOM output is
 * not assertable in the SSR-based unit suite; `resolveProgressDialogVerdictQuorum`
 * is the exact function the component calls.
 */

import { describe, expect, test } from 'bun:test'
import { nextPublishedBidEventIdOnSessionStart } from '@/hooks/useAuctionBidFunding'
import { resolveProgressDialogVerdictQuorum } from '@/components/AuctionBidProgressDialog'
import { parseValidatorVerdictEvent } from '@/lib/schemas/auction/validatorEvents'
import { computeVerdictQuorum } from '@/lib/auction/verdictQuorum'
import type { ParsedValidatorVerdictEvent } from '@/lib/auction/events'

// =============================================================================
// Fixtures — a rebid chain: leg A (previous, published + confirmed) and
// leg B (the new session's bid, not yet published).
// =============================================================================

const LEG_A_BID_EVENT_ID = 'a'.repeat(64)
const LEG_B_BID_EVENT_ID = 'b'.repeat(64)
const BIDDER_PUBKEY = '1'.repeat(64)
const AUCTION_ROOT_EVENT_ID = 'e'.repeat(64)
const AUCTION_COORDINATE = '30408:' + '2'.repeat(64) + ':auction-1'
const AUDITOR_1 = '3'.repeat(64)
const AUDITOR_2 = '4'.repeat(64)
const VALIDATOR_PUBKEYS = [AUDITOR_1, AUDITOR_2]

/** Build a raw kind-30440 verdict event (parsed by the real schema parser). */
const rawVerdict = (params: { validatorPubkey: string; bidEventId: string; claim: string; createdAt: number }) => {
	const dTag = `${BIDDER_PUBKEY}:${AUCTION_ROOT_EVENT_ID}:${params.bidEventId}`
	// 64-char hex event id, unique per (validator, timestamp).
	const id = 'f'.repeat(60) + (params.validatorPubkey === AUDITOR_1 ? '01' : '02') + (params.createdAt % 256).toString(16).padStart(2, '0')
	return {
		id,
		pubkey: params.validatorPubkey,
		created_at: params.createdAt,
		kind: 30440,
		tags: [
			['d', dTag],
			['p', BIDDER_PUBKEY],
			['e', AUCTION_ROOT_EVENT_ID],
			['bid', params.bidEventId],
			['a', AUCTION_COORDINATE],
			['claim', params.claim],
			['observed_at', String(params.createdAt)],
		],
		content: '',
	}
}

/** Leg A reached a full confirm quorum (two distinct auditors confirmed it). */
const legAConfirmVerdicts = [
	rawVerdict({ validatorPubkey: AUDITOR_1, bidEventId: LEG_A_BID_EVENT_ID, claim: 'valid_bid_placed', createdAt: 1_000 }),
	rawVerdict({ validatorPubkey: AUDITOR_2, bidEventId: LEG_A_BID_EVENT_ID, claim: 'valid_bid_placed', createdAt: 1_001 }),
]

const parsedLegAConfirmVerdicts: ParsedValidatorVerdictEvent[] = legAConfirmVerdicts
	.map(parseValidatorVerdictEvent)
	.filter((r): r is { ok: true; value: ParsedValidatorVerdictEvent } => r.ok)
	.map((r) => r.value)

// =============================================================================
// Tests
// =============================================================================

describe('cross-leg verdict leak (#1235 Blocking 5)', () => {
	test('fixture sanity: leg A had a full confirm quorum bound to its own event id', () => {
		// The previous leg genuinely reached "Bid successfully placed!" — this
		// is exactly the quorum that must NOT leak into the next leg.
		const quorum = computeVerdictQuorum(parsedLegAConfirmVerdicts, LEG_A_BID_EVENT_ID, VALIDATOR_PUBKEYS, 1)
		expect(quorum.hasPositiveVerdict).toBe(true)
		expect(quorum.confirmCount).toBe(2)
	})

	test('starting a second funding session drops the previous leg’s published event id', () => {
		expect(nextPublishedBidEventIdOnSessionStart(LEG_A_BID_EVENT_ID)).toBeNull()
		expect(nextPublishedBidEventIdOnSessionStart(null)).toBeNull()
	})

	test('a second session’s dialog binds NO verdicts while the new leg is unpublished — the previous leg’s confirm quorum does not leak', () => {
		// startFundingForBid reset the tracker; AuctionBidder passes
		// `publishedBidEventId ?? undefined` to the progress dialog, so the
		// rebid's dialog opens (ecash_minted / bid_publish_attempted) with NO
		// session event id.
		const dialogBidEventId = nextPublishedBidEventIdOnSessionStart(LEG_A_BID_EVENT_ID) ?? undefined
		expect(dialogBidEventId).toBeUndefined()

		const quorum = resolveProgressDialogVerdictQuorum(parsedLegAConfirmVerdicts, dialogBidEventId, VALIDATOR_PUBKEYS, 1)
		expect(quorum.hasPositiveVerdict).toBe(false)
		expect(quorum.hasNegativeVerdict).toBe(false)
		expect(quorum.hasNeutralVerdict).toBe(false)
		expect(quorum.representativeVerdict).toBeNull()
		// Concretely: the dialog cannot render "Bid successfully placed!" for
		// the not-yet-published rebid.
		expect(quorum.hasPositiveVerdict).not.toBe(true)
	})

	test('teeth: with the previous leg’s id (pre-fix behavior), the same verdicts WOULD have confirmed — hence the dialog-side gate', () => {
		// computeVerdictQuorum without an id is a legacy NO-FILTER mode, so the
		// gate in resolveProgressDialogVerdictQuorum is load-bearing: had the
		// stale id been passed (or no id at all), leg A's quorum would count.
		const quorumViaStaleId = resolveProgressDialogVerdictQuorum(parsedLegAConfirmVerdicts, LEG_A_BID_EVENT_ID, VALIDATOR_PUBKEYS, 1)
		expect(quorumViaStaleId.hasPositiveVerdict).toBe(true)

		const quorumViaLegacyNoFilter = computeVerdictQuorum(parsedLegAConfirmVerdicts, undefined, VALIDATOR_PUBKEYS, 1)
		expect(quorumViaLegacyNoFilter.hasPositiveVerdict).toBe(true)
	})

	test('once the new session publishes its own event id, only verdicts bound to THAT id count', () => {
		const quorum = resolveProgressDialogVerdictQuorum(parsedLegAConfirmVerdicts, LEG_B_BID_EVENT_ID, VALIDATOR_PUBKEYS, 1)
		expect(quorum.hasPositiveVerdict).toBe(false)
		expect(quorum.confirmCount).toBe(0)
		expect(quorum.representativeVerdict).toBeNull()
	})

	test('a confirm quorum for the NEW leg does render once the new session published its id', () => {
		const legBVerdicts = [
			rawVerdict({ validatorPubkey: AUDITOR_1, bidEventId: LEG_B_BID_EVENT_ID, claim: 'valid_bid_placed', createdAt: 2_000 }),
		]
		const parsed = legBVerdicts
			.map(parseValidatorVerdictEvent)
			.filter((r): r is { ok: true; value: ParsedValidatorVerdictEvent } => r.ok)
			.map((r) => r.value)

		const quorum = resolveProgressDialogVerdictQuorum(parsed, LEG_B_BID_EVENT_ID, VALIDATOR_PUBKEYS, 1)
		expect(quorum.hasPositiveVerdict).toBe(true)
	})
})
