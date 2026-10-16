/**
 * Binding the payout seams to the app — the last translation layer.
 *
 * ## What this module owns, and what it deliberately does not
 *
 * It owns exactly three things, all of them translations rather than decisions:
 *
 * 1. **`buildZapRequest`** — because the base branch has no kind-9734 builder (its zap feature is a
 *    *purchase*: the buyer pays, the seller's server publishes the receipt, and nothing needed a zap
 *    request). So the draft comes from `zapRequestEvent.ts` and the signature from the app's signer.
 * 2. **`payInvoice`** — `walletActions.payInvoiceWithNwc(nwcUri, invoice, signer, options?)`, whose
 *    failure mode is a **throw**, mapped to the seam's `{ ok: false, detail }` so the runner sees a
 *    failed payment rather than an exception it would have to guess about.
 * 3. **`getJson`** — a plain `fetch`, because LNURL is HTTPS and not relay traffic; the relay rules
 *    (`src/lib/nostr/io.ts`) do not apply to it.
 *
 * It does **not** reach into stores for the wallet URI, the receipt query or the profile read. Those
 * belong to the call site, which knows which wallet is active and which query cache is warm; passing
 * them in keeps this module testable and keeps the store boundaries the repository asks for.
 *
 * ## Two gaps this binding does not paper over
 *
 * - **Finding a receipt.** `fetchZapsForUserViaProvider` returns a *mapped* `LightningZap[]`, and the
 *   verifier needs the raw kind-9735 event (tags and signature) to check anything at all. So this takes
 *   a `findReceiptEvents` function rather than calling that query and hoping: either the query grows a
 *   raw-event accessor, or the call site fetches kind 9735 through the relay seam.
 * - **Reading an `npub`'s address.** The profile read is injected for the same reason — `src/queries`
 *   exposes it for a profile, and how a caller gets one is its business, not this module's.
 */

import { walletActions } from '@/lib/stores/wallet'
import type { NostrEventLike } from '../nostr/eventLike'
import { createZapPayoutSeams, type ZapPayoutPrimitives } from './zapPayoutSeams'
import { buildZapRequestDraft } from './zapRequestEvent'
import type { SignedZapRequest } from './zapPayoutRunner'

/** The app's signer, narrowed to what this binding needs. */
export interface ZapPayoutSigner {
	sign(event: unknown): Promise<unknown>
}

export interface ZapPayoutAppSeamsInput {
	readonly signer: ZapPayoutSigner
	/** The connected wallet's NWC URI. The call site knows which wallet is active; this module does not. */
	readonly nwcUri: string
	/** Receipt lookup returning the **raw** kind-9735 event, or `null` when there is none yet. */
	readonly findReceiptEvents: ZapPayoutPrimitives['findReceipt']
	/** Optional: how an `npub` destination's address is read. Without it, `npub` rows are unreachable. */
	readonly readProfileLightningAddress?: ZapPayoutPrimitives['readProfileLightningAddress']
	/** Injectable for tests; defaults to `walletActions.payInvoiceWithNwc`. */
	readonly payInvoiceImpl?: (input: { readonly bolt11: string }) => Promise<{ readonly preimage?: string }>
	/** Injectable for tests; defaults to the platform's `fetch`. */
	readonly fetchImpl?: typeof fetch
	/** Injectable for tests; defaults to `Date.now()`. */
	readonly now?: () => number
}

const asRecord = (value: unknown): Record<string, unknown> =>
	typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}

export const createZapPayoutAppSeams = (input: ZapPayoutAppSeamsInput): ZapPayoutPrimitives => {
	const now = input.now ?? (() => Date.now())
	const fetchImpl = input.fetchImpl ?? fetch

	return {
		async getJson(url) {
			const response = await fetchImpl(url, { headers: { accept: 'application/json' } })
			if (!response.ok) {
				// The status is part of the message on purpose: a 500 and a 404 are different problems for the
				// recipient's operator, and the runner will surface this string in the row's detail.
				throw new Error(`the endpoint answered ${response.status}`)
			}
			return response.json()
		},

		async buildZapRequest(request): Promise<SignedZapRequest> {
			const draft = buildZapRequestDraft({
				amountSats: request.amountSats,
				relays: request.relays,
				createdAt: Math.floor(now() / 1000),
				...(request.recipientPubkey ? { recipientPubkey: request.recipientPubkey } : {}),
				...(request.auctionAnchor ? { auctionAnchor: request.auctionAnchor } : {}),
				...(request.comment ? { comment: request.comment } : {}),
			})
			if (!draft.ok) {
				// An unbuildable request is not a payment failure, but the seam has no third option and the
				// runner treats a throw here as `payment_failed` with this message — which is honest: no zap
				// was sent, and the reason is on the row.
				throw new Error(`${draft.code}: ${draft.detail}`)
			}
			const signed = await input.signer.sign({
				kind: draft.draft.kind,
				created_at: draft.draft.created_at,
				tags: draft.draft.tags.map((tag) => [...tag]),
				content: draft.draft.content,
			})
			// The exact string the signer produced is what the recipient's server hashes into the invoice, so
			// it is serialised once here and carried, never re-serialised later where key order could differ.
			return {
				event: signed as NostrEventLike,
				description: JSON.stringify(signed),
				...(request.recipientPubkey ? { recipientPubkey: request.recipientPubkey } : {}),
			}
		},

		async payInvoice({ bolt11 }) {
			try {
				if (input.payInvoiceImpl) {
					const injected = await input.payInvoiceImpl({ bolt11 })
					return typeof injected.preimage === 'string' ? { ok: true, preimage: injected.preimage } : { ok: true }
				}
				const result = await walletActions.payInvoiceWithNwc(
					input.nwcUri,
					bolt11,
					input.signer as Parameters<typeof walletActions.payInvoiceWithNwc>[2],
				)
				const record = asRecord(result)
				return typeof record.preimage === 'string' ? { ok: true, preimage: record.preimage } : { ok: true }
			} catch (error) {
				// `payInvoiceWithNwc` throws on every failure path; the seam speaks in results, because the
				// runner must be able to record a failed payment rather than crash out of a payout mid-list.
				return { ok: false, detail: error instanceof Error ? error.message : 'the wallet could not pay the invoice' }
			}
		},

		findReceipt: input.findReceiptEvents,

		...(input.readProfileLightningAddress ? { readProfileLightningAddress: input.readProfileLightningAddress } : {}),
	}
}

/**
 * The call site's single entry point: app primitives → the seams `runZapPayout` consumes.
 *
 * Two layers on purpose. `createZapPayoutSeams` owns the URL assembly and the failure-to-vocabulary
 * table; this module owns the app bindings. Composing them here means a caller cannot accidentally pass
 * raw primitives straight to the runner and skip the translation.
 */
export const createAppPayoutSeams = (input: ZapPayoutAppSeamsInput): ReturnType<typeof import('./zapPayoutSeams').createZapPayoutSeams> =>
	createZapPayoutSeams(createZapPayoutAppSeams(input))
