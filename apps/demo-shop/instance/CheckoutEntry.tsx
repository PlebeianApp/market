/**
 * instance/CheckoutEntry.tsx — the checkout entry: where the cart hands off.
 *
 * **It does not pay, and it says so.** The payment is the next increment, and the
 * one thing this surface must not do is look like a checkout that works: there is
 * no invoice, no wallet, no rail and no order. What it *is* is the handoff made
 * concrete — the cart's intent as the SDK builds it, the delivery requirements the
 * SDK resolves from the cart's own lines, the invoice progress the SDK's own rule
 * reports, and the named gap between here and a payment.
 *
 * Like the cart, this surface is browser-owned, so the served bytes carry the
 * skeleton and the browser fills it after hydration.
 */

import * as React from 'react'

import { buildCartView, noShippingReason } from './cartTotals'
import { buildCheckoutView } from './checkoutView'
import { EMPTY_CART } from './cartState'
import type { ProductListView } from './productListView'
import { CART_PATH, PRODUCTS_PATH } from './routes'
import type { CartControl } from './useCart'

function CheckoutRegion({ state, children }: { state: string; children: React.ReactNode }) {
	return (
		<section
			aria-label="The checkout entry"
			data-testid="checkout"
			data-checkout-state={state}
			className="ds-region region region-checkout ds-cart"
		>
			<h1 className="ds-section-title">Checkout</h1>
			{children}
		</section>
	)
}

function CheckoutReading() {
	return (
		<CheckoutRegion state="reading">
			<p className="ds-muted" data-testid="checkout-summary">
				Reading this browser’s cart…
			</p>
			<div className="ds-cart-lines" data-skeleton="1" aria-hidden="true">
				<div className="sk sk-line" style={{ width: '58%' }} />
				<div className="sk sk-line" style={{ width: '36%' }} />
			</div>
		</CheckoutRegion>
	)
}

export function CheckoutEntry({ cart, view }: { cart: CartControl; view: ProductListView }) {
	if (cart.status === 'reading') return <CheckoutReading />

	if (cart.status === 'unavailable') {
		return (
			<CheckoutRegion state="unavailable">
				<p className="ds-note" data-testid="checkout-summary">
					This browser has no reachable cart storage, so there is nothing to check out. A cart lives in this
					browser only: nothing about it is on the instance.
				</p>
				<p className="ds-buy">
					<a className="ds-btn ds-btn-quiet" href={PRODUCTS_PATH}>
						Back to products
					</a>
				</p>
			</CheckoutRegion>
		)
	}

	const cartHeld = cart.cart ?? EMPTY_CART

	if (cartHeld.lines.length === 0) {
		return (
			<CheckoutRegion state="empty">
				<p className="ds-muted" data-testid="checkout-summary">
					There is nothing to check out: this browser’s cart is empty.
				</p>
				<p className="ds-buy">
					<a className="ds-btn ds-btn-quiet" href={PRODUCTS_PATH}>
						Back to products
					</a>
				</p>
			</CheckoutRegion>
		)
	}

	// The same view model the cart renders, so the two surfaces cannot disagree
	// about what the cart holds or what it is worth.
	const cartView = buildCartView(cartHeld, view.items)
	const checkout = buildCheckoutView(cartHeld, { updatedAtMs: Date.now() })
	const requirements = checkout.requirements

	const subtotals = Object.entries(cartView.subtotalByCurrency)
	const deliveryModes = [
		requirements.hasPhysicalDelivery ? 'physical' : '',
		requirements.hasPickupDelivery ? 'pickup' : '',
		requirements.hasDigitalDelivery ? 'digital' : '',
	].filter((mode) => mode.length > 0)

	return (
		<CheckoutRegion state="handoff">
			<p className="ds-muted" data-testid="checkout-summary">
				{checkout.summaryLine}
			</p>

			<ul className="ds-cart-lines" data-testid="checkout-lines">
				{cartView.lines.map((line) => (
					<li className="ds-cart-line" key={line.productRef} data-line-id={line.id}>
						<div className="ds-cart-line-main">
							<span>{line.item?.title ?? `${line.id} — not in this instance’s read`}</span>
							<span className="ds-muted">
								{line.amount} × {line.unitPrice ?? 'no price'}
							</span>
						</div>
						<span className="ds-cart-line-total">{line.lineTotal ?? 'cannot be priced'}</span>
					</li>
				))}
			</ul>

			<div className="ds-totals" data-testid="checkout-intent">
				<div className="ds-total-row">
					<span>Cart intent (sdk/commerce/cart)</span>
					<span className="ds-total-value">v{checkout.intent.version}</span>
				</div>
				<div className="ds-total-row">
					<span>Lines the intent carries</span>
					<span className="ds-total-value">{checkout.intent.items.length}</span>
				</div>
				<div className="ds-total-row">
					<span>Subtotal</span>
					<span className="ds-total-value">
						{subtotals.length > 0 ? subtotals.map(([, amount]) => amount).join(' + ') : 'nothing priceable'}
					</span>
				</div>
			</div>

			<div className="ds-note" data-testid="checkout-delivery" data-resolved={requirements.isResolved ? 'true' : 'false'}>
				{requirements.isResolved ? (
					<p>Delivery resolves: {deliveryModes.join(', ') || 'no mode was reported'}.</p>
				) : (
					<>
						<p>
							Delivery does not resolve. No shipping method has been chosen for these lines, so the checkout’s
							own rule reports {requirements.unresolvedShippingRefs.length} unresolved ref
							{requirements.unresolvedShippingRefs.length === 1 ? '' : 's'}:
						</p>
						<ul className="ds-meta" data-testid="checkout-unresolved">
							{requirements.unresolvedShippingRefs.map((unresolved) => (
								<li key={unresolved}>{unresolved}</li>
							))}
						</ul>
					</>
				)}
			</div>

			<p className="ds-muted" data-testid="checkout-invoice">
				{checkout.nextInvoiceIndex === -1
					? 'No payment invoice is open — none has been raised, because payment is not built.'
					: `Invoice ${checkout.nextInvoiceIndex} is the next to settle.`}
			</p>

			<p className="ds-note" data-testid="checkout-outcome">
				Payment is not built. This entry is where it lands: it would raise an invoice against this cart’s intent,
				settle it through the instance’s rail, and publish a receipt. None of that happens here — nothing on this
				page moves money, and no order id exists to print. {noShippingReason()}
			</p>

			<p className="ds-buy">
				<a className="ds-btn ds-btn-quiet" href={CART_PATH} data-testid="checkout-back-to-cart">
					Back to the cart
				</a>
			</p>
		</CheckoutRegion>
	)
}
