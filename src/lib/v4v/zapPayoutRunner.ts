/**
 * The zap payout run — what the seller's app does at settlement — §6 of the zap-payout packet.
 *
 * ## Why every side effect is a seam
 *
 * This module resolves an address, asks for an invoice, pays it, and looks for a receipt. All four
 * touch the network, and the repository's Test Isolation rule forbids tests from reaching external
 * services. So the runner owns the **order and the judgement** — which is where the money can go wrong
 * — and injects the I/O: `ZapPayoutSeams`. The consequence is that the interesting behaviour (what
 * happens when an address does not answer, when a payment fails, when the receipt never arrives) is
 * testable without a single network call, and the real seams are thin adapters over code that already
 * exists (`zapPurchase.ts`, `LightningPaymentProcessor`, NWC, the zap-receipt query).
 *
 * ## What this module refuses to do
 *
 * - It never claims a payment it did not make and cannot evidence: without a verified receipt the best
 *   it will say is `paid_unconfirmed` (§7.1), and when the run requires receipts it will not pay an
 *   endpoint that cannot produce one.
 * - It never hides an unspent sats. A row that was not paid keeps its amount in the ledger and in
 *   `unspentSats`, because a settled-looking number that quietly omits money is the failure this whole
 *   packet exists to prevent.
 * - It never treats a failure as terminal-and-fine: the status vocabulary distinguishes "not paid"
 *   from "payment failed" from "address unreachable", and the run reports which.
 *
 * ## Dry run
 *
 * `dryRun` stops after resolving endpoints and checking limits, leaving every payable row `planned`.
 * That is the checkpoint a seller should see before money moves: which rows will be paid, which will
 * not, and why — with nothing spent.
 */

import type { NostrEventLike } from '../nostr/eventLike'
import { type ZapPayoutPlan, type ZapPayoutRowPlan } from './payoutPlan'
import { describeZapPayoutRowStatus, zapPayoutRowStatusFrom, type ZapPayoutEvidence, type ZapPayoutRowStatus } from './payoutLedger'
import { parseZapDestination, zapDestinationLnurlpEndpoint, type ZapDestination } from './zapDestination'
import { verifyZapReceipt } from './zapReceipt'

/** The LNURL-pay document, reduced to what a payout decision needs. */
export interface LnurlPayDocument {
	readonly callback: string
	/** The endpoint's own limits, in millisats. */
	readonly minSendableMsat: number
	readonly maxSendableMsat: number
	/** NIP-57 support. Without it there is no receipt, only a payment. */
	readonly allowsNostr: boolean
	/** The recipient's server pubkey, when the document declares one. */
	readonly nostrPubkey?: string
}

export type LnurlResolution =
	| { readonly ok: true; readonly document: LnurlPayDocument }
	| { readonly ok: false; readonly code: 'address_unreachable' | 'not_zap_capable'; readonly detail?: string }

/** A signed kind-9734 request, with the exact description string that was signed. */
export interface SignedZapRequest {
	readonly event: NostrEventLike
	readonly description: string
	/** The recipient the request is addressed to, when known (an `npub` destination resolves here). */
	readonly recipientPubkey?: string
}

export interface ZapPayoutSeams {
	/**
	 * Resolve a destination to its LNURL-pay document.
	 *
	 * Both arguments are passed because an `npub` destination has no endpoint until its profile is
	 * read: the seam is where that read happens, and a seam that cannot do it returns
	 * `address_unreachable` rather than guessing.
	 */
	resolveEndpoint(endpoint: string | null, destination: ZapDestination): Promise<LnurlResolution>
	/** Build and sign the zap request. Signing is the caller's: the runner holds no key. */
	buildZapRequest(input: {
		readonly recipientPubkey?: string
		readonly amountSats: number
		readonly relays: readonly string[]
		readonly auctionAnchor?: { readonly kind: 'a' | 'e'; readonly value: string }
		readonly comment?: string
	}): Promise<SignedZapRequest>
	/** Ask the endpoint for an invoice for this zap request. */
	requestInvoice(input: {
		readonly callback: string
		readonly amountSats: number
		readonly zapRequest: SignedZapRequest
	}): Promise<
		| { readonly ok: true; readonly bolt11: string }
		| { readonly ok: false; readonly code: 'payment_failed' | 'not_zap_capable'; readonly detail?: string }
	>
	/** Pay the invoice from the seller's wallet — the melt or NWC path. */
	payInvoice(input: {
		readonly bolt11: string
	}): Promise<{ readonly ok: true; readonly preimage?: string } | { readonly ok: false; readonly detail?: string }>
	/** Look for the receipt the recipient's server publishes. `null` means "not yet", not "never". */
	fetchReceipt(input: {
		readonly recipientPubkey?: string
		readonly serverPubkey?: string
		readonly auctionAnchor?: { readonly kind: 'a' | 'e'; readonly value: string }
		readonly since: number
	}): Promise<(NostrEventLike & { readonly tags?: readonly (readonly string[])[] }) | null>
}

export interface ZapPayoutLedgerEntry {
	readonly id: string
	readonly destination: string
	readonly bps: number
	readonly sats: number
	readonly status: ZapPayoutRowStatus
	/** The §8 sentence for this status, so no surface has to invent wording. */
	readonly sentence: string
	readonly receiptId?: string
	/** A machine-readable explanation when the status alone does not say enough. */
	readonly detail?: string
}

export interface ZapPayoutRunResult {
	readonly rows: readonly ZapPayoutLedgerEntry[]
	/** Sats actually spent. */
	readonly paidSats: number
	/** Sats planned for rows this run did not spend — still the seller's, and disclosed. */
	readonly unspentSats: number
	/** Rows that need a human: not paid, not attempted, or failed. */
	readonly needsAttention: readonly string[]
}

export interface ZapPayoutRunInput {
	readonly plan: ZapPayoutPlan
	readonly seams: ZapPayoutSeams
	readonly relays: readonly string[]
	/** Event time for receipt lookups. The runner reads no clock of its own. */
	readonly now: number
	readonly auctionAnchor?: { readonly kind: 'a' | 'e'; readonly value: string }
	/** Whether a receipt is required for a row to count as paid. Defaults to true. */
	readonly receiptRequired?: boolean
	/** Resolve and check, spend nothing. */
	readonly dryRun?: boolean
}

const entry = (row: ZapPayoutRowPlan, status: ZapPayoutRowStatus, detail?: string, receiptId?: string): ZapPayoutLedgerEntry => ({
	id: row.id,
	destination: row.destination,
	bps: row.bps,
	sats: row.sats,
	status,
	sentence: describeZapPayoutRowStatus(status),
	...(detail ? { detail } : {}),
	...(receiptId ? { receiptId } : {}),
})

const fromEvidence = (row: ZapPayoutRowPlan, evidence: ZapPayoutEvidence, detail?: string, receiptId?: string): ZapPayoutLedgerEntry =>
	entry(row, zapPayoutRowStatusFrom(evidence), detail, receiptId)

/** Run the payout. Rows are processed in plan order; one row's failure never aborts the others. */
export const runZapPayout = async (input: ZapPayoutRunInput): Promise<ZapPayoutRunResult> => {
	const receiptRequired = input.receiptRequired ?? true
	const rows: ZapPayoutLedgerEntry[] = []

	for (const row of input.plan.rows) {
		// A row whose announced share truncates to nothing: disclosed, never silently dropped.
		if (row.action === 'skip') {
			rows.push(entry(row, 'below_minimum', row.reason ?? 'zero_share'))
			continue
		}
		// A row below the minimum zap: this payout does not pay it, and its sats stay unspent (§6.2).
		if (row.action === 'roll_up') {
			rows.push(entry(row, 'rolled_up', row.reason ?? 'below_minimum'))
			continue
		}

		const parsed = parseZapDestination(row.destination)
		if (!parsed.ok) {
			// The announcement should have refused this row; if one ever reaches here, it is reported
			// as unreachable with the real reason rather than guessed at.
			rows.push(entry(row, 'address_unreachable', `${parsed.code}: ${parsed.detail}`))
			continue
		}

		const endpoint = zapDestinationLnurlpEndpoint(parsed.destination)
		let resolution: LnurlResolution
		try {
			resolution = await input.seams.resolveEndpoint(endpoint, parsed.destination)
		} catch (error) {
			resolution = { ok: false, code: 'address_unreachable', detail: error instanceof Error ? error.message : 'resolution threw' }
		}
		if (!resolution.ok) {
			if (resolution.code === 'not_zap_capable' && receiptRequired) {
				rows.push(entry(row, 'not_zap_capable', resolution.detail))
			} else {
				rows.push(entry(row, 'address_unreachable', resolution.detail))
			}
			continue
		}

		const document = resolution.document
		if (!document.allowsNostr && receiptRequired) {
			// A plain Lightning address pays but leaves no receipt. Under the strict rule the run does
			// not pay it: paying without evidence would produce a payment this model cannot verify.
			rows.push(entry(row, 'not_zap_capable', 'the endpoint does not accept zaps and a receipt is required'))
			continue
		}

		const amountMsat = row.sats * 1000
		if (amountMsat < document.minSendableMsat) {
			rows.push(entry(row, 'below_minimum', `${amountMsat} msat is below the endpoint's ${document.minSendableMsat} msat minimum`))
			continue
		}
		if (amountMsat > document.maxSendableMsat) {
			rows.push(entry(row, 'above_endpoint_maximum', `${amountMsat} msat is above the endpoint's ${document.maxSendableMsat} msat maximum`))
			continue
		}

		if (input.dryRun) {
			rows.push(
				fromEvidence(row, {
					receiptVerified: false,
					endpointAnswered: true,
					zapCapable: document.allowsNostr,
					withinLimits: true,
					paymentSucceeded: false,
					receiptExpected: receiptRequired,
					planned: true,
				}),
			)
			continue
		}

		const receiptExpected = receiptRequired || document.allowsNostr
		let zapRequest: SignedZapRequest
		try {
			zapRequest = await input.seams.buildZapRequest({
				recipientPubkey: document.nostrPubkey,
				amountSats: row.sats,
				relays: input.relays,
				...(input.auctionAnchor ? { auctionAnchor: input.auctionAnchor } : {}),
			})
		} catch (error) {
			rows.push(
				entry(row, 'payment_failed', `the zap request could not be signed: ${error instanceof Error ? error.message : 'unknown error'}`),
			)
			continue
		}

		let invoice: { ok: true; bolt11: string } | { ok: false; code: 'payment_failed' | 'not_zap_capable'; detail?: string }
		try {
			invoice = await input.seams.requestInvoice({ callback: document.callback, amountSats: row.sats, zapRequest })
		} catch (error) {
			invoice = { ok: false, code: 'payment_failed', detail: error instanceof Error ? error.message : 'invoice request threw' }
		}
		if (!invoice.ok) {
			rows.push(entry(row, invoice.code === 'not_zap_capable' ? 'not_zap_capable' : 'payment_failed', invoice.detail))
			continue
		}

		let payment: { ok: true; preimage?: string } | { ok: false; detail?: string }
		try {
			payment = await input.seams.payInvoice({ bolt11: invoice.bolt11 })
		} catch (error) {
			payment = { ok: false, detail: error instanceof Error ? error.message : 'payment threw' }
		}
		if (!payment.ok) {
			rows.push(
				fromEvidence(
					row,
					{
						receiptVerified: false,
						endpointAnswered: true,
						zapCapable: document.allowsNostr,
						withinLimits: true,
						paymentSucceeded: false,
						receiptExpected,
						paymentAttempted: true,
					},
					payment.detail,
				),
			)
			continue
		}

		if (!receiptExpected) {
			rows.push(
				fromEvidence(row, {
					receiptVerified: false,
					endpointAnswered: true,
					zapCapable: false,
					withinLimits: true,
					paymentSucceeded: true,
					receiptExpected: false,
				}),
			)
			continue
		}

		let receipt: (NostrEventLike & { readonly tags?: readonly (readonly string[])[] }) | null = null
		try {
			receipt = await input.seams.fetchReceipt({
				recipientPubkey: zapRequest.recipientPubkey ?? document.nostrPubkey,
				serverPubkey: document.nostrPubkey,
				...(input.auctionAnchor ? { auctionAnchor: input.auctionAnchor } : {}),
				since: input.now,
			})
		} catch {
			receipt = null
		}

		const verification = receipt
			? verifyZapReceipt({
					event: receipt,
					expected: {
						...((zapRequest.recipientPubkey ?? document.nostrPubkey)
							? { recipientPubkey: zapRequest.recipientPubkey ?? document.nostrPubkey }
							: {}),
						...(document.nostrPubkey ? { recipientServerPubkey: document.nostrPubkey } : {}),
						...(input.auctionAnchor ? { auctionAnchor: input.auctionAnchor } : {}),
						plannedSats: row.sats,
					},
				})
			: null

		if (verification?.ok) {
			rows.push(
				fromEvidence(
					row,
					{
						receiptVerified: true,
						endpointAnswered: true,
						zapCapable: true,
						withinLimits: true,
						paymentSucceeded: true,
						receiptExpected: true,
					},
					undefined,
					(receipt as { id?: string })?.id,
				),
			)
			continue
		}

		// Paid but unproven: the receipt is absent or does not check out, and neither is allowed to
		// become the word "paid" (§7.1).
		const detail = verification && !verification.ok ? `the receipt did not verify: ${verification.code}` : 'no receipt was found yet'
		rows.push(
			fromEvidence(
				row,
				{
					receiptVerified: false,
					endpointAnswered: true,
					zapCapable: true,
					withinLimits: true,
					paymentSucceeded: true,
					receiptExpected: true,
				},
				detail,
			),
		)
	}

	const paidStatuses: readonly ZapPayoutRowStatus[] = ['paid', 'paid_unconfirmed', 'no_receipt_expected']
	const paidSats = rows.filter((row) => paidStatuses.includes(row.status)).reduce((total, row) => total + row.sats, 0)
	const unspentSats = rows.filter((row) => !paidStatuses.includes(row.status)).reduce((total, row) => total + row.sats, 0)
	const needsAttention = rows
		.filter((row) => !['paid', 'paid_unconfirmed', 'no_receipt_expected', 'rolled_up'].includes(row.status))
		.map((row) => row.id)

	return { rows, paidSats, unspentSats, needsAttention }
}
