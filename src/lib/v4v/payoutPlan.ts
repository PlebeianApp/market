/**
 * The pure payout plan for an announced V4V split — spec
 * `docs/protocol/auction-v4v-zap-payout-v1.md` §6 (payout, floor/roll-up, remainder)
 * and §6.1 (the rounding remainder belongs to the seller).
 *
 * Nothing here touches the network, the clock, a wallet or a store: it turns
 * (announced rows, settled sats, minimum zap) into per-row work plus the
 * arithmetic a validator can check against the commitment. The seller's app does
 * the resolving/zapping/paying; this module only decides *what* and *how much*.
 *
 * ## The rules, all fail-closed
 *
 * 1. A row's share is `floor(settledSats * bps / ALLOCATION_TOTAL_BPS)`. Integer
 *    truncation is deliberate: a plan never pays a sat nobody settled for.
 * 2. A row whose share is `0` is **skipped**, never silently absent — an announced
 *    row always has a row in the plan, so the ledger can render its true state (a
 *    zero announcement is legal per §4, and a tiny announcement can truncate to 0).
 *    There is nothing to roll up, so the zero rule is checked *before* the minimum.
 * 3. A share below `minimumZapSats` is **rolled up** (§6.2): sending it as its own
 *    zap would cost more in routing/melt fees than it moves.
 * 4. Everything the rows do not take belongs to the seller (`sellerSats`) — the
 *    remainder of §6.1, including the fractional sats truncation discarded.
 * 5. The plan reconciles **exactly**:
 *    `paidSats + rolledUpSats + skippedSats + sellerSats === settledSats`.
 *    If it cannot, this module refuses instead of returning an uncheckable plan.
 *
 * ## How it refuses
 *
 * A **typed failure**, not a throw: the function returns
 * `ZapPayoutPlanResult`, and a caller must handle `ok: false`. A throw would make
 * "the arithmetic did not add up" an exception a caller can forget, when it is
 * exactly the fact the commitment machinery needs to hear about.
 */
import { ALLOCATION_TOTAL_BPS } from './allocations'

/** One announced row, as §4 puts it on the wire (`name` is optional display only). */
export interface ZapPayoutRowInput {
	readonly id: string
	readonly destination: string
	readonly bps: number
	readonly name?: string
}

/** What the payout should do with a row. */
export type ZapPayoutRowAction = 'pay' | 'roll_up' | 'skip'

/** Skip reason: the announced share truncates to nothing. */
export const ZAP_PAYOUT_REASON_ZERO_SHARE = 'zero_share'
/** Roll-up reason: the share is real but below the minimum zap, so it is not paid (§6.2). */
export const ZAP_PAYOUT_REASON_BELOW_MINIMUM = 'below_minimum'

/** One row's planned outcome. `sats` is what the row's share came to, before roll-up. */
export interface ZapPayoutRowPlan {
	readonly id: string
	readonly destination: string
	readonly bps: number
	readonly sats: number
	readonly action: ZapPayoutRowAction
	readonly reason?: string
}

/** A checked plan. The four totals reconcile against `settledSats` exactly. */
export interface ZapPayoutPlan {
	readonly rows: readonly ZapPayoutRowPlan[]
	/** The seller's remainder (bps not allocated, plus truncation dust). */
	readonly sellerSats: number
	/** Sats to send as this row's own zap. */
	readonly paidSats: number
	/**
	 * Sats on rows below the minimum zap, which this payout therefore did **not**
	 * send (§6.2). They stay unspent with the seller and are reported here so the
	 * ledger discloses them instead of absorbing them. Nothing is "combined": a zap
	 * reaches one recipient, so two rows cannot share a payment.
	 */
	readonly rolledUpSats: number
	/** Sats on announced rows that truncate to nothing (always 0 in exact terms). */
	readonly skippedSats: number
}

/** Every way a plan can be refused. Stable codes, safe to branch on. */
export type ZapPayoutPlanError =
	| 'empty_rows'
	| 'negative_settled_amount'
	| 'non_integer_settled_amount'
	| 'invalid_minimum_zap'
	| 'invalid_bps'
	| 'split_over_allocated'
	| 'duplicate_row_id'
	| 'reconciliation_failed'

/** The refusal variant. `message` is for humans and logs, `error` for control flow. */
export interface ZapPayoutPlanFailure {
	readonly ok: false
	readonly error: ZapPayoutPlanError
	readonly message: string
}

/** The success variant — still a `ZapPayoutPlan`, with the discriminant added. */
export interface ZapPayoutPlanSuccess extends ZapPayoutPlan {
	readonly ok: true
}

export type ZapPayoutPlanResult = ZapPayoutPlanSuccess | ZapPayoutPlanFailure

/** Narrow a result to its refusal. */
export const isZapPayoutPlanFailure = (result: ZapPayoutPlanResult): result is ZapPayoutPlanFailure => result.ok === false

const fail = (error: ZapPayoutPlanError, message: string): ZapPayoutPlanFailure => ({ ok: false, error, message })

const isNonNegativeInteger = (value: number): boolean => Number.isInteger(value) && value >= 0

export interface ZapPayoutPlanInput {
	readonly rows: readonly ZapPayoutRowInput[]
	/** The seller's net proceeds for this settlement, in whole sats. */
	readonly settledSats: number
	/** The smallest amount worth sending as its own zap, in whole sats. */
	readonly minimumZapSats: number
}

/**
 * Plan the payout of `settledSats` across the announced `rows`.
 *
 * Rows keep the announced order (the plan is not a canonicalised commitment — the
 * split's canonical encoding handles that in §9). Returns a typed failure, never
 * throws, for anything the arithmetic cannot vouch for.
 */
export function planZapPayout(input: ZapPayoutPlanInput): ZapPayoutPlanResult {
	const { rows, settledSats, minimumZapSats } = input

	if (rows.length === 0) {
		return fail('empty_rows', 'A payout plan needs at least one announced row.')
	}
	if (!isNonNegativeInteger(settledSats)) {
		return Number.isInteger(settledSats)
			? fail('negative_settled_amount', `A settled amount cannot be negative (got ${settledSats}).`)
			: fail('non_integer_settled_amount', `A settled amount must be whole sats (got ${settledSats}).`)
	}
	if (!isNonNegativeInteger(minimumZapSats)) {
		return fail('invalid_minimum_zap', `The minimum zap must be a whole, non-negative number of sats (got ${minimumZapSats}).`)
	}

	const seenIds = new Set<string>()
	let totalBps = 0
	for (const row of rows) {
		if (!isNonNegativeInteger(row.bps) || row.bps > ALLOCATION_TOTAL_BPS) {
			return fail('invalid_bps', `Row "${row.id}" has an unusable allocation: ${row.bps}.`)
		}
		if (seenIds.has(row.id)) {
			return fail('duplicate_row_id', `Row id "${row.id}" is announced more than once.`)
		}
		seenIds.add(row.id)
		totalBps += row.bps
	}
	// §4: sum(bps) <= 10000. Over-allocation is an announcement bug, not a payout.
	if (totalBps > ALLOCATION_TOTAL_BPS) {
		return fail('split_over_allocated', `The announced split allocates ${totalBps} bps of ${ALLOCATION_TOTAL_BPS}.`)
	}

	const plannedRows: ZapPayoutRowPlan[] = []
	let paidSats = 0
	let rolledUpSats = 0
	let skippedSats = 0

	for (const row of rows) {
		// Integer truncation: the dust stays with the seller (§6.1).
		const sats = Math.floor((settledSats * row.bps) / ALLOCATION_TOTAL_BPS)

		if (sats === 0) {
			plannedRows.push({
				id: row.id,
				destination: row.destination,
				bps: row.bps,
				sats,
				action: 'skip',
				reason: ZAP_PAYOUT_REASON_ZERO_SHARE,
			})
			skippedSats += sats
			continue
		}
		if (sats < minimumZapSats) {
			plannedRows.push({
				id: row.id,
				destination: row.destination,
				bps: row.bps,
				sats,
				action: 'roll_up',
				reason: ZAP_PAYOUT_REASON_BELOW_MINIMUM,
			})
			rolledUpSats += sats
			continue
		}
		plannedRows.push({ id: row.id, destination: row.destination, bps: row.bps, sats, action: 'pay' })
		paidSats += sats
	}

	const sellerSats = settledSats - (paidSats + rolledUpSats + skippedSats)

	// The identity is the contract: if it does not hold, no plan is returned.
	if (sellerSats < 0 || paidSats + rolledUpSats + skippedSats + sellerSats !== settledSats) {
		return fail(
			'reconciliation_failed',
			`Planned ${paidSats} paid + ${rolledUpSats} rolled up + ${skippedSats} skipped does not reconcile with ${settledSats} settled.`,
		)
	}

	return { ok: true, rows: plannedRows, sellerSats, paidSats, rolledUpSats, skippedSats }
}
