/**
 * Assembling the payout run's seams from the app's own pieces — **and nothing else**.
 *
 * ## The rule this module follows
 *
 * Everything here is translation. The decisions live in their own modules: what a destination is
 * (`zapDestination`), what a document must look like to be payable (`lnurlPayDocument`), what a receipt
 * does and does not prove (`zapReceipt`), what a run does with a row (`zapPayoutRunner`). This module
 * takes four primitives the app already has — a JSON fetch, the zap-request builder, the wallet's
 * payment call, the receipt query — and wires them into `ZapPayoutSeams`.
 *
 * No marketplace import appears here, and no module reached from here imports another's business
 * rules. That is deliberate on two counts: it keeps the pieces independently testable, and it is what
 * would let this feature be lifted out of the repository later without untangling it first. The one
 * thing this module must own is the **mapping from wire-level failure to the ledger's vocabulary**,
 * because that is a translation, and it is written out as an explicit table rather than scattered
 * through the wiring.
 *
 * ## Why the primitives are injectable rather than imported
 *
 * The repository's Test Isolation rule forbids tests from reaching the network, and a payout is
 * nothing but network calls. Passing the primitives in means the wiring itself is testable — including
 * the ugly paths, like a fetch that returns HTML instead of JSON — with no network and no mocking of
 * third-party packages.
 */

import type { NostrEventLike } from '../nostr/eventLike'
import { buildInvoiceRequestUrl, parseLnurlPayDocument, readInvoiceFromResponse } from './lnurlPayDocument'
import { parseZapDestination, zapDestinationLnurlpEndpoint, type ZapDestination } from './zapDestination'
import type { LnurlResolution, SignedZapRequest, ZapPayoutSeams } from './zapPayoutRunner'

/** The four things the app already has, injected so the wiring can be tested without a network. */
export interface ZapPayoutPrimitives {
	/** Fetch JSON with the app's relay/HTTP layer. Throws or rejects on transport failure. */
	getJson(url: string): Promise<unknown>
	/**
	 * The app's zap-request builder (`zapPurchase.ts` + the active signer): a signed kind-9734 event and
	 * the exact description string that was signed.
	 */
	buildZapRequest(input: {
		readonly recipientPubkey?: string
		readonly amountSats: number
		readonly relays: readonly string[]
		readonly auctionAnchor?: { readonly kind: 'a' | 'e'; readonly value: string }
		readonly comment?: string
	}): Promise<SignedZapRequest>
	/** The wallet's payment call — the Cashu melt or the NWC path. */
	payInvoice(input: {
		readonly bolt11: string
	}): Promise<{ readonly ok: true; readonly preimage?: string } | { readonly ok: false; readonly detail?: string }>
	/** The receipt query (`src/queries/zaps.tsx`): the kind-9735 event, or `null` when there is none yet. */
	findReceipt(input: {
		readonly recipientPubkey?: string
		readonly serverPubkey?: string
		readonly auctionAnchor?: { readonly kind: 'a' | 'e'; readonly value: string }
		readonly since: number
	}): Promise<(NostrEventLike & { readonly tags?: readonly (readonly string[])[] }) | null>
	/**
	 * An `npub` destination has no address until its profile is read. Optional: without it, an `npub`
	 * row is reported unreachable with that as the reason rather than being guessed at.
	 */
	readProfileLightningAddress?(pubkey: string): Promise<string | null>
}

/**
 * Wire-level failure → the ledger's vocabulary. One table, in one place, because this is the only
 * judgement this module is allowed to make.
 *
 * The mapping is chosen so a seller reading the ledger learns the right thing to fix:
 *
 * - the endpoint answered, but not with a payable zap endpoint (`lnurl_wrong_tag`,
 *   `lnurl_inconsistent_nostr`, a `min`/`max` that cannot express a zap) → `not_zap_capable`;
 * - the endpoint answered with a document that is unusable as a URL target (`lnurl_missing_callback`,
 *   an insecure callback) → `not_zap_capable` as well: the address exists, it just cannot receive a zap;
 * - the endpoint did not answer usably at all (transport failure, non-JSON, an HTML error page) →
 *   `address_unreachable`, because nothing was learned about the address.
 */
export const lnurlFailureToResolution = (code: string): 'address_unreachable' | 'not_zap_capable' => {
	switch (code) {
		case 'lnurl_wrong_tag':
		case 'lnurl_inconsistent_nostr':
		case 'lnurl_invalid_limits':
		case 'lnurl_missing_callback':
		case 'lnurl_insecure_callback':
			return 'not_zap_capable'
		default:
			// lnurl_not_object and anything unrecognised: the endpoint did not answer with something we
			// can even describe, which is a reachability fact and not a capability one.
			return 'address_unreachable'
	}
}

/** Resolve the endpoint URL for a destination, reading a profile first when the destination is an npub. */
const endpointFor = async (
	endpoint: string | null,
	destination: ZapDestination,
	primitives: ZapPayoutPrimitives,
): Promise<LnurlResolution | string> => {
	if (destination.kind !== 'npub') {
		// The runner already asked this module for the endpoint; recomputing it here would put the same
		// decision in two places, so the value it passed is the value used.
		if (!endpoint) {
			return { ok: false, code: 'address_unreachable', detail: 'the destination produced no endpoint URL' }
		}
		return endpoint
	}

	if (!primitives.readProfileLightningAddress) {
		return {
			ok: false,
			code: 'address_unreachable',
			detail: 'this destination is an npub and no profile reader was provided, so its address is unknown',
		}
	}
	let address: string | null = null
	try {
		address = await primitives.readProfileLightningAddress(destination.normalized)
	} catch {
		address = null
	}
	if (!address) {
		return {
			ok: false,
			code: 'address_unreachable',
			detail: `the profile of ${destination.normalized.slice(0, 16)}… declares no Lightning address`,
		}
	}
	const parsed = parseZapDestination(address)
	if (!parsed.ok || parsed.destination.kind === 'npub') {
		return { ok: false, code: 'not_zap_capable', detail: 'the profile declares a Lightning address that is not usable' }
	}
	const profileEndpoint = zapDestinationLnurlpEndpoint(parsed.destination)
	if (!profileEndpoint) return { ok: false, code: 'not_zap_capable', detail: 'the profile declares no usable endpoint' }
	return profileEndpoint
}

/** Build the payout seams from the app's primitives. Composition only: no business rules. */
export const createZapPayoutSeams = (primitives: ZapPayoutPrimitives): ZapPayoutSeams => ({
	async resolveEndpoint(_endpoint, destination) {
		const resolved = await endpointFor(_endpoint, destination, primitives)
		if (typeof resolved !== 'string') return resolved

		let payload: unknown
		try {
			payload = await primitives.getJson(resolved)
		} catch (error) {
			return { ok: false, code: 'address_unreachable', detail: error instanceof Error ? error.message : 'the endpoint did not answer' }
		}
		const parsed = parseLnurlPayDocument(payload)
		if (!parsed.ok) {
			return { ok: false, code: lnurlFailureToResolution(parsed.code), detail: `${parsed.code}: ${parsed.detail}` }
		}
		return { ok: true, document: parsed.document }
	},

	buildZapRequest(input) {
		return primitives.buildZapRequest(input)
	},

	async requestInvoice(input) {
		const url = buildInvoiceRequestUrl({
			callback: input.callback,
			amountSats: input.amountSats,
			zapRequestJson: input.zapRequest.description,
		})
		let payload: unknown
		try {
			payload = await primitives.getJson(url)
		} catch (error) {
			return { ok: false, code: 'payment_failed', detail: error instanceof Error ? error.message : 'the invoice request did not answer' }
		}
		const invoice = readInvoiceFromResponse(payload)
		if (!invoice.ok) return { ok: false, code: 'payment_failed', detail: invoice.detail }
		return { ok: true, bolt11: invoice.bolt11 }
	},

	payInvoice(input) {
		return primitives.payInvoice(input)
	},

	fetchReceipt(input) {
		return primitives.findReceipt(input)
	},
})
