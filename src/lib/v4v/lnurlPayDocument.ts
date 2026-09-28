/**
 * The LNURL-pay document, and the invoice request built from it — the actual adaptation between the
 * payout run's seams and a real recipient's server.
 *
 * ## Everything here is untrusted input
 *
 * The document comes from the recipient's `/.well-known/lnurlp/<name>`, or from a URL a bech32 `lnurl`
 * decoded to, or from whatever a profile says. It is exactly the class of data the repository's rules
 * say to treat as untrusted, and a payout decides **how much money to send where** from it. So the
 * parse is fail-closed and specific:
 *
 * - the tag must say `payRequest` — anything else is a different kind of endpoint;
 * - the callback must be `https` (a payout over plain http is a downgrade nobody asked for);
 * - both limits must be finite non-negative integers in millisats, with a non-zero maximum and
 *   `min <= max` — a document that cannot express a payable range is refused rather than guessed at;
 * - NIP-57 support must be *consistent*: `allowsNostr` true with no valid `nostrPubkey` is refused,
 *   because the receipt is the entire evidence story and a server that claims zaps without a key for
 *   them cannot produce one.
 *
 * ## The invoice request
 *
 * `amount` in millisats, optionally `comment`, and `nostr` = the URL-encoded zap request — appended to
 * whatever query string the callback already carries, since a callback may be
 * `…/callback?k1=…` and blindly adding `?amount=` would corrupt it.
 */

import type { LnurlPayDocument } from './zapPayoutRunner'

export type LnurlPayDocumentRefusal =
	| 'lnurl_not_object'
	| 'lnurl_wrong_tag'
	| 'lnurl_missing_callback'
	| 'lnurl_insecure_callback'
	| 'lnurl_invalid_limits'
	| 'lnurl_inconsistent_nostr'

export type LnurlPayDocumentResult =
	| { readonly ok: true; readonly document: LnurlPayDocument }
	| { readonly ok: false; readonly code: LnurlPayDocumentRefusal; readonly detail: string }

const isHttpsUrl = (value: unknown): value is string => {
	if (typeof value !== 'string' || !value) return false
	try {
		return new URL(value).protocol === 'https:'
	} catch {
		return false
	}
}

const isMsatLimit = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0

/** Parse an untrusted LNURL-pay document into the shape a payout decision needs. */
export const parseLnurlPayDocument = (input: unknown): LnurlPayDocumentResult => {
	if (typeof input !== 'object' || input === null) {
		return { ok: false, code: 'lnurl_not_object', detail: 'the endpoint did not answer with a JSON object' }
	}
	const raw = input as Record<string, unknown>

	// `tag` is the discriminator: an LNURL-withdraw or a channel request must not be paid as a zap.
	if (raw.tag !== 'payRequest') {
		return { ok: false, code: 'lnurl_wrong_tag', detail: `expected tag "payRequest", got ${JSON.stringify(raw.tag)}` }
	}
	if (!isHttpsUrl(raw.callback)) {
		if (raw.callback === undefined || raw.callback === null) {
			return { ok: false, code: 'lnurl_missing_callback', detail: 'the document has no callback' }
		}
		return {
			ok: false,
			code: typeof raw.callback === 'string' && raw.callback.startsWith('http:') ? 'lnurl_insecure_callback' : 'lnurl_missing_callback',
			detail: `the callback is not a usable https URL: ${JSON.stringify(raw.callback)}`,
		}
	}
	const minSendableMsat = raw.minSendable
	const maxSendableMsat = raw.maxSendable
	if (!isMsatLimit(minSendableMsat) || !isMsatLimit(maxSendableMsat) || maxSendableMsat === 0 || minSendableMsat > maxSendableMsat) {
		return {
			ok: false,
			code: 'lnurl_invalid_limits',
			detail: `the endpoint's limits are not payable: min ${JSON.stringify(minSendableMsat)}, max ${JSON.stringify(maxSendableMsat)}`,
		}
	}

	const allowsNostr = raw.allowsNostr === true
	const nostrPubkey = typeof raw.nostrPubkey === 'string' ? raw.nostrPubkey.toLowerCase() : undefined
	if (allowsNostr && !(nostrPubkey && /^[0-9a-f]{64}$/.test(nostrPubkey))) {
		return {
			ok: false,
			code: 'lnurl_inconsistent_nostr',
			detail: 'the endpoint claims zap support but declares no usable nostrPubkey, so no receipt could be verified',
		}
	}

	return {
		ok: true,
		document: {
			callback: raw.callback,
			minSendableMsat,
			maxSendableMsat,
			allowsNostr,
			...(nostrPubkey ? { nostrPubkey } : {}),
		},
	}
}

/**
 * The invoice request URL for a zap of `amountSats`.
 *
 * `nostr` carries the signed kind-9734 request; the recipient's server puts it in the receipt, which is
 * how a zap becomes evidence rather than just a payment.
 */
export const buildInvoiceRequestUrl = (input: {
	readonly callback: string
	readonly amountSats: number
	readonly zapRequestJson?: string
	readonly comment?: string
}): string => {
	const url = new URL(input.callback)
	url.searchParams.set('amount', String(input.amountSats * 1000))
	if (input.zapRequestJson !== undefined) url.searchParams.set('nostr', input.zapRequestJson)
	if (input.comment !== undefined && input.comment !== '') url.searchParams.set('comment', input.comment)
	return url.toString()
}

/** Read the invoice out of an untrusted invoice-request response. */
export const readInvoiceFromResponse = (
	input: unknown,
): { ok: true; bolt11: string } | { ok: false; code: 'payment_failed'; detail: string } => {
	if (typeof input !== 'object' || input === null) {
		return { ok: false, code: 'payment_failed', detail: 'the endpoint did not answer with a JSON object' }
	}
	const raw = input as Record<string, unknown>
	if (typeof raw.pr !== 'string' || !raw.pr) {
		return { ok: false, code: 'payment_failed', detail: `the response has no invoice: ${JSON.stringify(raw.reason ?? raw.status ?? raw)}` }
	}
	return { ok: true, bolt11: raw.pr }
}
