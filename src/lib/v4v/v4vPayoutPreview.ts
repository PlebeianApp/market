/**
 * What the seller's V4V tab shows, and what the payout screen shows before money moves — as a **view
 * model**, not as UI.
 *
 * ## Why this is a separate module and not logic inside a component
 *
 * The repository's rules put event kinds, tag parsing and payment semantics in data layers, never in UI
 * components, and this feature has a lot of them to get right: shares in basis points, a remainder that
 * belongs to the seller, endpoints that may not accept a zap, rows that will not be paid. A component
 * that computed any of that would be untestable and would eventually disagree with the runner.
 *
 * So this module **decides nothing new**. It composes what already exists — the allocation arithmetic,
 * the plan, the status precedence and the sentences — into rows a surface can render, plus the warnings
 * a seller needs *before* they publish. Every number here comes from `planZapPayout`; every status from
 * `zapPayoutRowStatusFrom`; every sentence from the ledger. If this module ever needed a rule of its own,
 * the rule would belong in one of those instead.
 *
 * ## The two things it will not do
 *
 * - It will not hide the seller's own share. A split that pays out 40% is a split whose remaining 60%
 *   should be visible while the seller is configuring it and again before the payout runs.
 * - It will not report a row as payable when the endpoint's own limits forbid it. Endpoint facts are
 *   optional input, but when they are present they decide, exactly as they do in the run.
 */

import { ALLOCATION_TOTAL_BPS } from './allocations'
import { describeZapPayoutRowStatus, zapPayoutRowStatusFrom, type ZapPayoutRowStatus } from './payoutLedger'
import { isZapPayoutPlanFailure, planZapPayout, ZAP_PAYOUT_REASON_BELOW_MINIMUM, ZAP_PAYOUT_REASON_ZERO_SHARE } from './payoutPlan'
import { announceV4VSplit, type V4VSplitRow } from './splitAnnouncement'

/** What is known about a destination's endpoint, when anything is. */
export interface V4VEndpointFact {
	readonly answered: boolean
	readonly zapCapable: boolean
	/** In millisats, as the endpoint publishes them. */
	readonly minSendableMsat?: number
	readonly maxSendableMsat?: number
}

export interface V4VPayoutPreviewRow {
	readonly id: string
	readonly destination: string
	readonly name?: string
	readonly bps: number
	/** Percent of the seller's net, for display. Derived from bps; never the other way round. */
	readonly percent: number
	readonly sats: number
	readonly status: ZapPayoutRowStatus
	readonly sentence: string
	readonly detail?: string
}

export type V4VPreviewWarning =
	| 'no_rows'
	| 'commitment_missing'
	| 'seller_keeps_everything'
	| 'row_will_not_be_paid'
	| 'endpoint_facts_missing'

export interface V4VPayoutPreview {
	/** `false` when the split itself is invalid; `warnings` then explain why and `rows` is empty. */
	readonly ok: boolean
	readonly rows: readonly V4VPayoutPreviewRow[]
	readonly totalBps: number
	readonly sellerBps: number
	readonly sellerSats: number
	/** What this payout **would** send. Nothing has moved yet, so it is not called "paid". */
	readonly willPaySats: number
	/** What this payout would not send, and why the rows say so. Disclosed, never absorbed. */
	readonly willNotPaySats: number
	readonly warnings: readonly V4VPreviewWarning[]
	/** The commitment to publish with the auction, when the split is valid. */
	readonly commitment?: string
	/** The split-level refusal, when the split is not valid. */
	readonly refusal?: { readonly code: string; readonly detail: string; readonly rowId?: string }
}

export interface V4VPreviewInput {
	readonly rows: readonly V4VSplitRow[]
	/** The amount the auction settled for. Before settlement, pass the current bid so the preview is real. */
	readonly settledSats: number
	readonly minimumZapSats: number
	/** The commitment already published with the auction, when there is one. */
	readonly commitment?: string
	/** Endpoint facts by normalized destination, when a liveness check has been made. */
	readonly endpointFacts?: Readonly<Record<string, V4VEndpointFact>>
	/** Whether a receipt is required for a row to count as paid. Defaults to true, as the run does. */
	readonly receiptRequired?: boolean
}

const normalizeKey = (destination: string): string => destination.trim().toLowerCase()

/**
 * Build the preview.
 *
 * The plan is computed exactly as the payout run computes it, so what the seller sees here and what the
 * payout does cannot drift apart.
 */
export const buildV4VPayoutPreview = (input: V4VPreviewInput): V4VPayoutPreview => {
	if (input.rows.length === 0) {
		// A split that announces nothing is reported as exactly that. Letting it fall through to the plan
		// would surface the planner's own `empty_rows` refusal, which is true but says nothing to a seller
		// who has simply not added a recipient yet.
		return {
			ok: false,
			rows: [],
			totalBps: 0,
			sellerBps: ALLOCATION_TOTAL_BPS,
			sellerSats: input.settledSats,
			willPaySats: 0,
			willNotPaySats: 0,
			warnings: ['no_rows'],
			refusal: { code: 'no_rows', detail: 'the split announces no recipients yet' },
		}
	}

	const announcement = announceV4VSplit(input.rows)
	if (!announcement.ok) {
		// An invalid split is reported as such, with the row that needs fixing — the seller is configuring,
		// and this is the moment they can still act on it.
		return {
			ok: false,
			rows: [],
			totalBps: 0,
			sellerBps: ALLOCATION_TOTAL_BPS,
			sellerSats: input.settledSats,
			willPaySats: 0,
			willNotPaySats: 0,
			warnings: [],
			refusal: {
				code: announcement.code,
				detail: announcement.detail,
				...(announcement.rowId ? { rowId: announcement.rowId } : {}),
			},
		}
	}

	const planned = planZapPayout({
		rows: input.rows.map((row) => ({ id: row.id, destination: row.destination, bps: row.bps, ...(row.name ? { name: row.name } : {}) })),
		settledSats: input.settledSats,
		minimumZapSats: input.minimumZapSats,
	})
	if (isZapPayoutPlanFailure(planned)) {
		// A plan that refuses must not become an empty, healthy-looking preview: "nothing to pay" and "the
		// arithmetic could not be checked" are different messages to a seller, and only one of them is safe.
		return {
			ok: false,
			rows: [],
			totalBps: announcement.announcement.totalBps,
			sellerBps: announcement.announcement.sellerBps,
			sellerSats: input.settledSats,
			willPaySats: 0,
			willNotPaySats: 0,
			warnings: [],
			commitment: input.commitment ?? announcement.announcement.commitment,
			refusal: { code: planned.error, detail: planned.message },
		}
	}
	const { rows: rowsPlan, sellerSats, paidSats: willPaySats, rolledUpSats, skippedSats } = planned
	// A preview has spent nothing: "will not pay" is the rolled-up and zero rows, disclosed as such.
	const willNotPaySats = rolledUpSats + skippedSats

	const receiptRequired = input.receiptRequired ?? true
	const endpointFacts = input.endpointFacts
	const warnings = new Set<V4VPreviewWarning>()

	if (input.rows.length === 0) warnings.add('no_rows')
	if (input.rows.length > 0 && input.rows.every((row) => row.bps === 0)) warnings.add('seller_keeps_everything')
	if (input.rows.length > 0 && !input.endpointFacts) warnings.add('endpoint_facts_missing')
	if (input.rows.length > 0 && !input.commitment) warnings.add('commitment_missing')

	const rows: V4VPayoutPreviewRow[] = rowsPlan.map((row) => {
		const fact = endpointFacts?.[normalizeKey(row.destination)]
		const amountMsat = row.sats * 1000
		const withinLimits = fact
			? (fact.minSendableMsat === undefined || amountMsat >= fact.minSendableMsat) &&
				(fact.maxSendableMsat === undefined || amountMsat <= fact.maxSendableMsat)
			: true
		const aboveMaximum = Boolean(fact?.maxSendableMsat !== undefined && amountMsat > fact.maxSendableMsat)
		// The ledger's `planned` means "nothing has happened yet, so nothing else is known". A row whose
		// endpoint already answered badly is a row where something *is* known, so it must not be labelled
		// planned — that would hide a failure the seller can still fix.
		const factFails = Boolean(fact && (!fact.answered || !withinLimits || (!fact.zapCapable && receiptRequired)))
		const planned = row.action === 'pay' && !factFails
		const status = zapPayoutRowStatusFrom({
			// Nothing has been paid yet: this preview describes intent, and it says so rather than showing a
			// healthy-looking "paid" for a payout that has not run.
			receiptVerified: false,
			endpointAnswered: fact ? fact.answered : true,
			zapCapable: fact ? fact.zapCapable : true,
			withinLimits,
			paymentSucceeded: false,
			receiptExpected: receiptRequired,
			planned,
			rolledUp: row.action === 'roll_up',
			paymentAttempted: false,
			...(aboveMaximum ? { aboveMaximum: true } : {}),
		})
		const detail =
			row.action === 'roll_up'
				? row.reason === ZAP_PAYOUT_REASON_BELOW_MINIMUM
					? `below the ${input.minimumZapSats} sat minimum zap`
					: row.reason
				: row.action === 'skip'
					? row.reason === ZAP_PAYOUT_REASON_ZERO_SHARE
						? 'the announced share is zero'
						: row.reason
					: !withinLimits
						? `the endpoint does not accept ${amountMsat} msat`
						: undefined
		if (!planned || !withinLimits || (fact && !fact.answered) || (fact && !fact.zapCapable && receiptRequired)) {
			warnings.add('row_will_not_be_paid')
		}
		return {
			id: row.id,
			destination: row.destination,
			...(input.rows.find((candidate) => candidate.id === row.id)?.name
				? { name: input.rows.find((candidate) => candidate.id === row.id)?.name }
				: {}),
			bps: row.bps,
			percent: Math.round((row.bps / ALLOCATION_TOTAL_BPS) * 10000) / 100,
			sats: row.sats,
			status,
			sentence: describeZapPayoutRowStatus(status),
			...(detail ? { detail } : {}),
		}
	})

	return {
		ok: true,
		rows,
		totalBps: announcement.announcement.totalBps,
		sellerBps: announcement.announcement.sellerBps,
		sellerSats,
		willPaySats,
		willNotPaySats,
		warnings: [...warnings],
		commitment: input.commitment ?? announcement.announcement.commitment,
	}
}
