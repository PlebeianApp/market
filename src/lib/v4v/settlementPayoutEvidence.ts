/**
 * Whether a settlement's payout claims are what the seller committed to — the validator's side of the
 * zap-payout model, and the check that turns "the receipts are public" into something a validator can
 * actually assert.
 *
 * ## The one thing this module is for
 *
 * With no escrow, a validator cannot prevent a seller from taking the money. What it can do is refuse
 * to describe it as settled. So the question here is not "did the seller behave" — it is "**may this
 * settlement's payout claims be believed?**", answered from three things anyone can check:
 *
 * 1. the announced rows, against the **commitment** the seller published with the auction;
 * 2. each row's claimed status, against a **receipt that verifies** — and a row claimed `paid` with no
 *    verifying receipt is not a claim, it is an assertion;
 * 3. the arithmetic: what was paid plus what was left unspent plus the seller's remainder is the
 *    settled amount, exactly. A settlement whose numbers do not close is refused outright, because
 *    every other sentence in it would then be describing an amount nobody can account for.
 *
 * ## Fail-closed, and never lenient about the good news
 *
 * The module fails **closed**: a row it cannot check is a finding, not a pass. And it is deliberately
 * asymmetric — the same rule that refuses `paid` without evidence also refuses a row the seller
 * silently omitted, because a split with a hole in it is how a share disappears.
 *
 * It does not attempt to judge the *time* of a payment, and it does not claim the escrow guarantee the
 * packet gives up. It answers exactly one question, and a validator that wants to attest a settlement
 * has to get a clean answer out of it first.
 */

import type { NostrEventLike } from '../nostr/eventLike'
import { verifyZapReceipt } from './zapReceipt'
import { splitMatchesCommitment, type V4VSplitRow } from './splitAnnouncement'

/** A row's claim as the settlement publishes it (§7.2 of the packet). */
export interface SettlementPayoutClaimRow {
	readonly id: string
	readonly destination: string
	readonly bps: number
	readonly sats: number
	/** One of the §8 statuses, as a string: this module refuses unknown ones rather than guessing. */
	readonly status: string
	readonly receiptId?: string
}

export interface SettlementPayoutClaim {
	readonly rows: readonly SettlementPayoutClaimRow[]
	/** The commitment published with the auction. */
	readonly commitment: string
	/** The amount the auction settled for. */
	readonly settledSats: number
}

export type SettlementPayoutFindingCode =
	| 'commitment_mismatch'
	| 'row_missing'
	| 'row_not_announced'
	| 'row_total_mismatch'
	| 'unknown_status'
	| 'paid_without_evidence'
	| 'receipt_not_verifying'
	| 'reconciliation_failed'
	| 'unpaid_row_missing_from_claim'

export interface SettlementPayoutFinding {
	readonly code: SettlementPayoutFindingCode
	readonly detail: string
	readonly rowId?: string
}

export type SettlementPayoutVerdict =
	| { readonly ok: true; readonly paidSats: number; readonly unspentSats: number }
	| { readonly ok: false; readonly findings: readonly SettlementPayoutFinding[] }

/** The statuses that mean "money moved", and so require a receipt that verifies. */
const PAID_STATUSES = ['paid', 'paid_unconfirmed', 'no_receipt_expected'] as const
/** The statuses that mean "no money moved", and so must be disclosed as unspent rather than omitted. */
const UNPAID_STATUSES = [
	'rolled_up',
	'address_unreachable',
	'not_zap_capable',
	'below_minimum',
	'above_endpoint_maximum',
	'payment_failed',
	'not_paid',
	'planned',
] as const

export interface SettlementPayoutCheckInput {
	readonly claim: SettlementPayoutClaim
	/** The rows the seller announced on the auction root. */
	readonly announcedRows: readonly V4VSplitRow[]
	/**
	 * The receipt for a row, or `null` when none can be found. Injected: the caller owns relay I/O.
	 */
	readonly lookupReceipt: (
		row: SettlementPayoutClaimRow,
	) => Promise<(NostrEventLike & { readonly tags?: readonly (readonly string[])[] }) | null>
	/** The seller's remainder as claimed, when the claim states one. */
	readonly claimedSellerSats?: number
	/** The auction anchor the receipt must reference, when the caller knows it. */
	readonly auctionAnchor?: { readonly kind: 'a' | 'e'; readonly value: string }
}

/**
 * Check a settlement's payout claims. Every finding is collected rather than stopping at the first, so
 * a seller gets the whole list to fix instead of one item at a time.
 */
export const verifySettlementPayoutClaims = async (input: SettlementPayoutCheckInput): Promise<SettlementPayoutVerdict> => {
	const findings: SettlementPayoutFinding[] = []
	const { claim, announcedRows } = input

	// The commitment is checked first: if the rows a validator was given are not the rows the seller
	// committed to, every per-row check below would be comparing against the wrong split.
	if (!splitMatchesCommitment(announcedRows, claim.commitment)) {
		findings.push({
			code: 'commitment_mismatch',
			detail: `the announced rows do not hash to the commitment ${claim.commitment} the settlement cites`,
		})
	}

	// The announcement is copied on the settlement for exactly this check, so a mismatch is decidable
	// without trusting the settlement's own account of what was announced.
	const announcedById = new Map(announcedRows.map((row) => [row.id, row]))
	for (const row of claim.rows) {
		const announced = announcedById.get(row.id)
		if (!announced) {
			findings.push({ code: 'row_not_announced', detail: `row ${row.id} is not part of the announced split`, rowId: row.id })
			continue
		}
		// The share and the destination are committed fields: a claim that edits them is a different split.
		if (announced.bps !== row.bps) {
			findings.push({
				code: 'row_total_mismatch',
				detail: `row ${row.id} claims ${row.bps} bps, the announcement says ${announced.bps}`,
				rowId: row.id,
			})
		}
		const announcedDestination = announced.destination.trim().toLowerCase()
		if (announcedDestination !== row.destination.trim().toLowerCase()) {
			findings.push({
				code: 'row_total_mismatch',
				detail: `row ${row.id} names ${row.destination}, the announcement says ${announced.destination}`,
				rowId: row.id,
			})
		}
	}

	for (const announced of announcedRows) {
		if (!claim.rows.some((row) => row.id === announced.id)) {
			// A missing row is how a share disappears: the settlement simply does not mention it.
			findings.push({
				code: 'unpaid_row_missing_from_claim',
				detail: `row ${announced.id} was announced and the settlement does not account for it`,
				rowId: announced.id,
			})
		}
	}

	let paidSats = 0
	let unspentSats = 0
	for (const row of claim.rows) {
		const isPaid = (PAID_STATUSES as readonly string[]).includes(row.status)
		const isUnpaid = (UNPAID_STATUSES as readonly string[]).includes(row.status)
		if (!isPaid && !isUnpaid) {
			findings.push({ code: 'unknown_status', detail: `row ${row.id} claims the unknown status "${row.status}"`, rowId: row.id })
			continue
		}

		if (isUnpaid) {
			unspentSats += row.sats
			if (row.receiptId) {
				findings.push({ code: 'receipt_not_verifying', detail: `row ${row.id} is ${row.status} but cites a receipt`, rowId: row.id })
			}
			continue
		}

		paidSats += row.sats
		if (row.status === 'no_receipt_expected') {
			// The documented weaker tier: no receipt exists to check, and the module says so rather than
			// inventing confidence it does not have.
			continue
		}

		let receipt: (NostrEventLike & { readonly tags?: readonly (readonly string[])[] }) | null = null
		try {
			receipt = await input.lookupReceipt(row)
		} catch {
			receipt = null
		}
		if (!receipt) {
			findings.push({
				code: 'paid_without_evidence',
				detail: `row ${row.id} is claimed ${row.status} but no receipt could be found`,
				rowId: row.id,
			})
			continue
		}
		const verification = verifyZapReceipt({
			event: receipt,
			expected: {
				...(input.auctionAnchor ? { auctionAnchor: input.auctionAnchor } : {}),
				plannedSats: row.sats,
			},
		})
		if (!verification.ok) {
			findings.push({
				code: 'receipt_not_verifying',
				detail: `row ${row.id}: ${verification.code} — ${verification.detail}`,
				rowId: row.id,
			})
		}
	}

	const rowTotal = claim.rows.reduce((total, row) => total + row.sats, 0)
	if (input.claimedSellerSats === undefined) {
		// Without the seller's remainder the arithmetic cannot be closed, and an unchecked sum is exactly
		// the kind of "looks settled" number this packet exists to prevent.
		findings.push({
			code: 'reconciliation_failed',
			detail: 'the claim does not state the seller remainder, so the arithmetic cannot be closed',
		})
	} else if (paidSats + unspentSats + input.claimedSellerSats !== claim.settledSats) {
		findings.push({
			code: 'reconciliation_failed',
			detail: `paid ${paidSats} + unspent ${unspentSats} + seller ${input.claimedSellerSats} does not equal the settled ${claim.settledSats}`,
		})
	}
	if (rowTotal > claim.settledSats) {
		findings.push({ code: 'row_total_mismatch', detail: `the rows ask for ${rowTotal} of ${claim.settledSats} sats` })
	}

	return findings.length > 0 ? { ok: false, findings } : { ok: true, paidSats, unspentSats }
}
