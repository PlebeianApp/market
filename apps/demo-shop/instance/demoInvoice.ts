/**
 * demoInvoice.ts — **the demo's payment-invoice data, held beside the placed-order store.**
 *
 * After a checkout places and signs an order, the server requests an invoice from the
 * seller's Lightning address. The invoice string and its metadata live here, separate from
 * the SDK's PlacedBuyerOrder types, so the demo can show the bolt11 without modifying
 * the order-placement schema.
 */
import { PAYMENT_REQUESTED_LIFECYCLE } from '@sdk/commerce/orders/orderPlacement'
import { Bolt11Wrapper } from '@sdk/core/bolt11-wrapper/ts/wrapper'
import { MemoryBolt11LegStore } from '@sdk/core/bolt11-wrapper/ts/memory'
import type { Bolt11LnurlRequester, Bolt11WrapperOptions } from '@sdk/core/bolt11-wrapper/ts/types'
import { lnurlCodec, lnurlRequester } from './demoLnurl'

export interface DemoInvoice {
	readonly orderId: string
	readonly bolt11: string
	readonly paymentHash: string
	readonly createdAtMs: number
	readonly lightningAddress: string
	readonly paymentStage: typeof PAYMENT_REQUESTED_LIFECYCLE
}

const invoices = new Map<string, DemoInvoice>()

export function demoInvoiceStore() {
	return {
		save(invoice: DemoInvoice): void { invoices.set(invoice.orderId, invoice) },
		find(orderId: string): DemoInvoice | undefined { return invoices.get(orderId) },
		ids(): string[] { return [...invoices.keys()] },
	}
}

export type DemoInvoiceStore = ReturnType<typeof demoInvoiceStore>

/** Forget every invoice the instance recorded. Called once at boot by startDemoShop. */
export function forgetDemoInvoices(): void {
	invoices.clear()
}

/**
 * Request a payment-invoice for an order, using the bolt11-wrapper over LNURL-pay.
 *
 * 1. Creates a one-shot bolt11-wrapper (memory store, the demo's own codec and the
 *    real LNURL requester that resolves the seller's lightning address over HTTP).
 * 2. Calls obtain() with the lnurl-request leg kind — the wrapper contacts the LNURL
 *    endpoint, gets an invoice, writes the leg record and returns the quote.
 * 3. Derives the payment hash from the invoice and returns the result.
 *
 * Returns the invoice data on success, or a refusal type if the LNURL step fails
 * (so the caller can decide whether the order-placement still succeeds — a missing
 * invoice is not a missing order).
 */
export async function requestInvoice(
	orderId: string,
	amountSat: number,
	lightningAddress: string,
	requester: Bolt11LnurlRequester = lnurlRequester,
): Promise<{ bolt11: string; paymentHash: string } | { refusal: string }> {
	const parts = lightningAddress.split('@', 2)
	if (parts.length !== 2 || !parts[0] || !parts[1]) {
		return { refusal: `invalid lightning address: ${lightningAddress}` }
	}

	const wrapper = new Bolt11Wrapper({
		wrapperId: `demo-${orderId}`,
		store: new MemoryBolt11LegStore(),
		storeKind: 'memory',
		codec: lnurlCodec,
		lnurlRequester: requester,
		reconcileDeadlineMs: 300_000,
		ceiling: 1_000_000,
		contractVersion: 'demo-0.1',
		now: () => Date.now(),
	} satisfies Bolt11WrapperOptions)

	const [user, host] = parts
	const lnurl = `https://${host}/.well-known/lnurlp/${encodeURIComponent(user)}`

	// Never throw: a network failure or an endpoint refusal is a `{ refusal }`, so the
	// caller can place the order without an invoice and the page reports what happened.
	try {
		const quote = await wrapper.obtain({ kind: 'lnurl-request', amountSat, lnurl })

		// A FundsQuote carries .reference (the bolt11 string). A FundsRefusal carries .reason.
		if (!('reference' in quote)) return { refusal: (quote as { reason?: string }).reason ?? 'lnurl refused' }

		const bolt11 = quote.reference
		const paymentHash = lnurlCodec.paymentHash(bolt11)
		return { bolt11, paymentHash }
	} catch (error) {
		return { refusal: error instanceof Error ? error.message : String(error) }
	}
}