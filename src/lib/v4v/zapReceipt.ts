/**
 * Zap receipt verification — the evidence half of the V4V zap-payout model.
 *
 * The packet's §7.1 says a payout is only *paid* when the recipient's own LNURL server published a
 * kind-9735 receipt that checks out. This module is that check, and nothing else: pure, no relay, no
 * clock, no wallet.
 *
 * ## Why this is the whole enforcement story
 *
 * The escrow model locked each share to the recipient's key, so a dishonest seller *could not* take
 * it. With zap payouts the seller holds the money and pays afterwards, so the defences are the
 * published split commitment and **this**: a receipt signed by the recipient's server, referencing
 * the recipient, this auction, and the amount that was committed. It makes non-payment visible and
 * attributable — not impossible. Saying that plainly is part of the design.
 *
 * ## What is verified, and what deliberately is not
 *
 * Verified: the event is a receipt; its signature verifies; it names the expected recipient; it comes
 * from the recipient's LNURL server when the announcement knew one; it references this auction; the
 * amount in its `bolt11` invoice equals the row's planned sats within the row's rounding allowance;
 * and the `description` it carries is a well-formed zap request for the same recipient and amount.
 *
 * **Not** verified here, and it must not be claimed: the *description hash* binding — the invoice's
 * `h` field versus `sha256(description)`. That is the payment-side check (the payer's invoice request
 * pins it, NIP-57), and re-checking it from a receipt alone needs a full BOLT11 decode. A validator
 * that wants it can add it; this module says so rather than implying a guarantee it does not give.
 * Likewise nothing here proves the *time* of the payment.
 */

import { sha256 } from '@noble/hashes/sha2.js'
import type { NostrEventLike } from '../nostr/eventLike'
import { verifyNostrEventSignature } from '../nostr/event-signature'

/** A kind-9735 zap receipt. */
export const ZAP_RECEIPT_KIND = 9735

/** A kind-9734 zap request, which the receipt carries in its `description` tag. */
export const ZAP_REQUEST_KIND = 9734

export type ZapReceiptRefusal =
	| 'receipt_kind_mismatch'
	| 'receipt_signature_invalid'
	| 'receipt_recipient_missing'
	| 'receipt_recipient_mismatch'
	| 'receipt_server_mismatch'
	| 'receipt_anchor_mismatch'
	| 'receipt_bolt11_missing'
	| 'receipt_amount_unreadable'
	| 'receipt_amount_mismatch'
	| 'receipt_description_missing'
	| 'receipt_description_invalid'

export interface ZapReceiptExpectation {
	/** The row's recipient identity (`p` tag), when the announcement named one. */
	readonly recipientPubkey?: string
	/** The recipient's LNURL server (`nostrPubkey` from the LNURL document), when it declared one. */
	readonly recipientServerPubkey?: string
	/** How the auction is referenced: an `a` coordinate or an `e` event id, and its value. */
	readonly auctionAnchor?: { readonly kind: 'a' | 'e'; readonly value: string }
	/** The sats the plan committed to for this row. */
	readonly plannedSats: number
	/** Rounding allowance, in sats. Defaults to 1 sat (floor rounding on the plan side). */
	readonly roundingToleranceSats?: number
}

export type ZapReceiptVerification =
	| { readonly ok: true; readonly amountSats: number }
	| { readonly ok: false; readonly code: ZapReceiptRefusal; readonly detail: string }

const readTag = (tags: readonly (readonly string[])[], name: string): string | undefined => tags.find((tag) => tag[0] === name)?.[1]

const readTags = (tags: readonly (readonly string[])[], name: string): string[] =>
	tags
		.filter((tag) => tag[0] === name)
		.map((tag) => tag[1])
		.filter((value): value is string => typeof value === 'string')

/**
 * The amount of a BOLT11 invoice in sats, or `null` when it carries no amount or cannot be read.
 *
 * BOLT11's human-readable part is `ln` + currency (`bc`) + the amount + an optional multiplier:
 * `m` = milli (10^-3), `u` = micro (10^-6), `n` = nano (10^-9), `p` = pico (10^-12), all of BTC; no
 * multiplier means whole BTC. Amountless invoices (`lnbc1…`) are legal and return `null` — the plan
 * always requests an amount, so an amountless receipt is a refusal, not a zero.
 *
 * Deliberately a small parser rather than a dependency: the only thing needed here is the amount,
 * and a wrong amount is exactly what this module exists to catch.
 */
export const bolt11AmountSats = (bolt11: string): number | null => {
	if (typeof bolt11 !== 'string') return null
	const invoice = bolt11.trim().toLowerCase()
	if (!invoice.startsWith('lnbc')) return null

	const rest = invoice.slice(4)
	// The separator is the **last** `1`: bech32's data alphabet excludes `1` entirely, while the
	// amount itself may well contain one (`1u`, `10n`, `1000p` are all ordinary amounts). Searching
	// from the front finds that digit and reports a real invoice as amountless.
	const separatorAt = rest.lastIndexOf('1')
	const amountPart = separatorAt <= 0 ? '' : rest.slice(0, separatorAt)
	if (!amountPart) return null

	const match = /^(\d+)([munp])?$/.exec(amountPart)
	if (!match) return null

	const value = Number.parseInt(match[1], 10)
	const multiplier = match[2]
	const btc =
		multiplier === 'm'
			? value / 1_000
			: multiplier === 'u'
				? value / 1_000_000
				: multiplier === 'n'
					? value / 1_000_000_000
					: multiplier === 'p'
						? value / 1_000_000_000_000
						: value
	const sats = Math.round(btc * 100_000_000)
	return Number.isFinite(sats) && sats >= 0 ? sats : null
}

/** `sha256(description)` as hex — exported so a caller *can* re-check an invoice's description hash. */
export const zapDescriptionHash = (description: string): string =>
	Array.from(sha256(new TextEncoder().encode(description)))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')

/**
 * Verify a receipt against an expectation.
 *
 * Fail-closed and ordered so the *worst* fact is reported first: a receipt that is not a receipt, or
 * whose signature does not verify, is refused before any of its content is read — an unverified
 * event is untrusted input, and reading tags out of it first would make the other checks meaningless.
 */
export const verifyZapReceipt = (input: {
	readonly event: NostrEventLike & { readonly tags?: readonly (readonly string[])[] }
	readonly expected: ZapReceiptExpectation
}): ZapReceiptVerification => {
	const { event, expected } = input
	const tags = Array.isArray(event?.tags) ? event.tags : []

	if (event?.kind !== ZAP_RECEIPT_KIND) {
		return { ok: false, code: 'receipt_kind_mismatch', detail: `expected kind ${ZAP_RECEIPT_KIND}, got ${String(event?.kind)}` }
	}
	let signatureOk = false
	try {
		signatureOk = verifyNostrEventSignature(event as Parameters<typeof verifyNostrEventSignature>[0])
	} catch {
		signatureOk = false
	}
	if (!signatureOk) {
		return { ok: false, code: 'receipt_signature_invalid', detail: 'the receipt signature does not verify' }
	}

	const recipient = readTag(tags, 'p')
	if (!recipient) {
		return { ok: false, code: 'receipt_recipient_missing', detail: 'the receipt names no recipient (no p tag)' }
	}
	if (expected.recipientPubkey && recipient.toLowerCase() !== expected.recipientPubkey.toLowerCase()) {
		return {
			ok: false,
			code: 'receipt_recipient_mismatch',
			detail: `receipt is for ${recipient}, the row is for ${expected.recipientPubkey}`,
		}
	}
	if (expected.recipientServerPubkey && (event.pubkey ?? '').toLowerCase() !== expected.recipientServerPubkey.toLowerCase()) {
		return {
			ok: false,
			code: 'receipt_server_mismatch',
			detail: `receipt was published by ${event.pubkey}, not by the announced server ${expected.recipientServerPubkey}`,
		}
	}

	if (expected.auctionAnchor) {
		const values = readTags(tags, expected.auctionAnchor.kind).map((value) => value.toLowerCase())
		if (!values.includes(expected.auctionAnchor.value.toLowerCase())) {
			return {
				ok: false,
				code: 'receipt_anchor_mismatch',
				detail: `the receipt does not reference this auction via ${expected.auctionAnchor.kind}=${expected.auctionAnchor.value}`,
			}
		}
	}

	const bolt11 = readTag(tags, 'bolt11')
	if (!bolt11) return { ok: false, code: 'receipt_bolt11_missing', detail: 'the receipt carries no bolt11 invoice' }

	const amountSats = bolt11AmountSats(bolt11)
	if (amountSats === null) {
		return { ok: false, code: 'receipt_amount_unreadable', detail: 'the invoice amount could not be read' }
	}
	const tolerance = Math.max(0, expected.roundingToleranceSats ?? 1)
	if (Math.abs(amountSats - expected.plannedSats) > tolerance) {
		return {
			ok: false,
			code: 'receipt_amount_mismatch',
			detail: `the invoice is for ${amountSats} sats, the row committed ${expected.plannedSats} (±${tolerance})`,
		}
	}

	const description = readTag(tags, 'description')
	if (!description) {
		return { ok: false, code: 'receipt_description_missing', detail: 'the receipt carries no zap request' }
	}
	try {
		const request = JSON.parse(description) as { kind?: number; pubkey?: string; tags?: string[][] }
		if (request?.kind !== ZAP_REQUEST_KIND) {
			return { ok: false, code: 'receipt_description_invalid', detail: `the description is not a kind-${ZAP_REQUEST_KIND} request` }
		}
		const requestTags = Array.isArray(request.tags) ? request.tags : []
		const requestRecipient = readTag(requestTags, 'p')
		if (expected.recipientPubkey && requestRecipient && requestRecipient.toLowerCase() !== expected.recipientPubkey.toLowerCase()) {
			return {
				ok: false,
				code: 'receipt_description_invalid',
				detail: 'the zap request inside the receipt is addressed to a different recipient',
			}
		}
	} catch {
		return { ok: false, code: 'receipt_description_invalid', detail: 'the description is not valid JSON' }
	}

	return { ok: true, amountSats }
}
