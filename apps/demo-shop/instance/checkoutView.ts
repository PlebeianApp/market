/**
 * instance/checkoutView.ts — what the checkout entry resolves from the cart.
 *
 * This module is the **handoff**: it takes the browser's cart and answers, through
 * the SDK's own rules, what a checkout would need and what it does not yet have.
 * It runs no payment, opens no invoice and reaches nothing — the payment is the
 * next increment, and the whole point of this surface is to say so by name rather
 * than to look like a working checkout.
 *
 * The two SDK rules it composes:
 *
 * - `resolveCheckoutDeliveryRequirements` — whether the cart's lines resolve to a
 *   delivery mode, and **which refs did not**. The cart's lines carry no shipping
 *   selection yet (the buy control does not ask for one), so every line reports the
 *   SDK's own `product:<id>:missing-shipping-method` sentinel. That is the truth of
 *   this increment, not a placeholder: `isResolved: false` is what makes the next
 *   step's work obvious.
 * - `findNextActionableInvoiceIndex` — the progress rule the checkout uses to pick
 *   the next invoice to settle. It is asked over an **empty** list, because no
 *   invoice has been raised, and it answers `-1`, which the surface renders as
 *   "no payment invoice is open".
 *
 * One more input is deliberately empty rather than guessed:
 * `servicesByShippingRef`. A shipping ref's *service* (`standard`, `pickup`,
 * `digital`) lives in the kind-30406 shipping record, which no read model here
 * reads — so the map is empty and a shopping ref would resolve as unresolved
 * instead of being inferred from the ref's last segment.
 */

import { createCartIntent, type PersistedCartContent } from '@sdk/commerce/cart'
import {
	findNextActionableInvoiceIndex,
	resolveCheckoutDeliveryRequirements,
	type CheckoutDeliveryRequirements,
	type CheckoutInvoiceStatus,
} from '@sdk/commerce/checkout'

import type { Cart } from './cartState'

export interface CheckoutView {
	/** The SDK's own cart→order preparation: the record this cart would submit. */
	readonly intent: PersistedCartContent
	readonly requirements: CheckoutDeliveryRequirements
	/** `-1` when no invoice is open. There is none: payment is not built. */
	readonly nextInvoiceIndex: number
	readonly lineCount: number
	readonly itemCount: number
	readonly summaryLine: string
	/** Named, so no surface can imply otherwise while it is true. */
	readonly payment: 'not-built'
}

export interface CheckoutViewOptions {
	/** The clock the intent is stamped with. Injected, so a test reads no wall clock. */
	readonly updatedAtMs?: number
}

export function buildCheckoutView(cart: Cart, options: CheckoutViewOptions = {}): CheckoutView {
	const intent = createCartIntent(cart.lines, options.updatedAtMs ?? Date.now())

	const requirements = resolveCheckoutDeliveryRequirements({
		products: cart.lines.map((line) => ({ id: line.id, shippingMethodId: line.shippingMethodId })),
		// Empty on purpose — see the module header: the service name lives in a
		// record this app does not read, so nothing is inferred.
		servicesByShippingRef: {},
	})

	// No invoice exists, so the SDK's own rule is asked over nothing and says so.
	const invoices: { status: CheckoutInvoiceStatus }[] = []
	const nextInvoiceIndex = findNextActionableInvoiceIndex(invoices, -1)

	const lineCount = cart.lines.length
	const itemCount = cart.lines.reduce((total, line) => total + line.amount, 0)
	const delivery = requirements.isResolved
		? 'delivery resolved'
		: `${requirements.unresolvedShippingRefs.length} unresolved delivery ref${requirements.unresolvedShippingRefs.length === 1 ? '' : 's'}`

	return {
		intent,
		requirements,
		nextInvoiceIndex,
		lineCount,
		itemCount,
		summaryLine: `${lineCount} line${lineCount === 1 ? '' : 's'} · ${itemCount} item${itemCount === 1 ? '' : 's'} · ${delivery}`,
		payment: 'not-built',
	}
}
