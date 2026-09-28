/**
 * The kind-9734 zap request — the event whose signature makes a payment checkable evidence.
 *
 * ## Why this is being written rather than reused
 *
 * The repository's existing zap feature is a **zap purchase**: a buyer pays an invoice to a seller, and
 * the seller's LNURL server publishes the receipt. Nothing in the base branch builds a NIP-57 zap
 * request, because nothing needed one — the *payer* was always the person spending, and the receipt's
 * existence was the product, not the proof.
 *
 * Here the payer is the seller, paying a recipient they may never interact with again, so the receipt
 * has to be **evidence**: it must name the recipient, the amount and this auction, and the recipient's
 * server can only put those in the receipt if the request carried them. That is what this event is for.
 *
 * ## Where the boundary is
 *
 * This module builds the **unsigned** event — the tags and the content, which are the parts with rules:
 *
 * - `amount` in millisats, because that is the unit the LNURL endpoint and the receipt both speak;
 * - one `relays` tag per relay, since the recipient's server needs somewhere to publish the receipt;
 * - `p` for the recipient, and the auction reference under `a` (addressable coordinate) or `e` (event id);
 * - the optional comment as `content`, which the endpoint may or may not accept
 *   (`commentAllowed`) and which is why a rejected invoice is not treated as a failed zap.
 *
 * Signing is **not** here: the signer is the app's, injected at the binding. A module that signed would
 * have to hold a key, and the whole two-key discipline of this feature is that the *signing* key and the
 * *money* key are different things.
 */

/** The unsigned event, ready for whichever signer the caller uses. */
export interface ZapRequestDraft {
	readonly kind: 9734
	readonly created_at: number
	readonly content: string
	readonly tags: readonly (readonly string[])[]
}

export type ZapRequestRefusal = 'amount_must_be_positive' | 'relays_missing' | 'relay_not_a_url' | 'anchor_empty'

export type ZapRequestResult =
	| { readonly ok: true; readonly draft: ZapRequestDraft }
	| { readonly ok: false; readonly code: ZapRequestRefusal; readonly detail: string }

const isWebsocketUrl = (value: string): boolean => {
	try {
		const parsed = new URL(value)
		return parsed.protocol === 'wss:' || parsed.protocol === 'ws:'
	} catch {
		return false
	}
}

export const ZAP_REQUEST_KIND = 9734

/**
 * Build the zap request.
 *
 * `created_at` is passed in rather than read from a clock, so the same inputs build the same event in a
 * test as in production — and so a caller replaying a payout describes when *it* decided, not when this
 * function happened to run.
 */
export const buildZapRequestDraft = (input: {
	readonly amountSats: number
	readonly recipientPubkey?: string
	readonly relays: readonly string[]
	readonly auctionAnchor?: { readonly kind: 'a' | 'e'; readonly value: string }
	readonly comment?: string
	readonly createdAt: number
}): ZapRequestResult => {
	if (!Number.isInteger(input.amountSats) || input.amountSats <= 0) {
		return {
			ok: false,
			code: 'amount_must_be_positive',
			detail: `a zap is for a positive whole number of sats, got ${String(input.amountSats)}`,
		}
	}
	if (input.relays.length === 0) {
		// Without a relay the recipient's server has nowhere to publish the receipt, so the payment would
		// produce nothing this model can verify — which makes it worth refusing rather than sending.
		return { ok: false, code: 'relays_missing', detail: 'a zap request must name at least one relay for the receipt' }
	}
	const badRelay = input.relays.find((relay) => !isWebsocketUrl(relay))
	if (badRelay) {
		return { ok: false, code: 'relay_not_a_url', detail: `"${badRelay}" is not a websocket relay URL` }
	}
	if (input.auctionAnchor && !input.auctionAnchor.value) {
		return { ok: false, code: 'anchor_empty', detail: 'the auction reference is empty' }
	}

	// NIP-57 carries the relays in ONE `relays` tag. An earlier draft of this also emitted a `relay` tag
	// per relay, which nothing specifies and the recipient's server would simply ignore.
	const tags: string[][] = [
		['relays', ...input.relays],
		['amount', String(input.amountSats * 1000)],
	]
	if (input.recipientPubkey) tags.push(['p', input.recipientPubkey])
	if (input.auctionAnchor) tags.push([input.auctionAnchor.kind, input.auctionAnchor.value])

	return {
		ok: true,
		draft: {
			kind: ZAP_REQUEST_KIND,
			created_at: input.createdAt,
			content: input.comment ?? '',
			tags,
		},
	}
}
