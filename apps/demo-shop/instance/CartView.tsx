/**
 * instance/CartView.tsx — the cart surface.
 *
 * The cart is the **browser's**, so this surface has three named states and the
 * server renders the first of them: reading (the skeleton, `data-skeleton="1"`),
 * unavailable (this browser has no reachable storage), and read. The read state is
 * the only one with lines in it, and it is reached after hydration — which is why a
 * screenshot of this page has to be taken after the read lands, not at first paint.
 *
 * Every number on it comes from `cartTotals.ts`, which is where the SDK's
 * aggregation lives. This file formats and lays out, and states the one thing the
 * totals cannot: that **no shipping cost is added**, because the read model carries
 * no shipping record. A cart that showed a total without saying that would be
 * quietly under-reporting what a shopper owes.
 *
 * A line whose listing the read cannot answer for is kept and named. Dropping it
 * would be a cart that forgives a delisted item silently, and pricing it at zero
 * would be a number nobody computed.
 */

import * as React from 'react'

import { buildCartView, noShippingReason, type CartLineView } from './cartTotals'
import { EMPTY_CART } from './cartState'
import { formatProductPrice, shortPubkey, type ProductListView } from './productListView'
import { CHECKOUT_PATH, PRODUCTS_PATH, productPath } from './routes'
import type { CartControl } from './useCart'

function CartRegion({ state, children }: { state: string; children: React.ReactNode }) {
	return (
		<section
			aria-label="The cart"
			data-testid="cart"
			data-cart-view={state}
			className="ds-region region region-cart ds-cart"
		>
			<h1 className="ds-section-title">Your cart</h1>
			{children}
		</section>
	)
}

/** The counting-free state the served bytes carry, and the client's first render. */
function CartReading() {
	return (
		<CartRegion state="reading">
			<p className="ds-muted" data-testid="cart-summary">
				Reading this browser’s cart…
			</p>
			<div className="ds-cart-lines" data-skeleton="1" aria-hidden="true">
				<div className="sk sk-line" style={{ width: '62%' }} />
				<div className="sk sk-line" style={{ width: '44%' }} />
			</div>
		</CartRegion>
	)
}

function CartUnavailable() {
	return (
		<CartRegion state="unavailable">
			<p className="ds-note" data-testid="cart-summary">
				This browser has no reachable cart storage, so there is no cart to show here. A cart lives in this
				browser only: nothing about it is on the instance.
			</p>
			<p className="ds-buy">
				<a className="ds-btn ds-btn-quiet" href={PRODUCTS_PATH}>
					Back to products
				</a>
			</p>
		</CartRegion>
	)
}

function CartLineRow({ line }: { line: CartLineView }) {
	return (
		<li className="ds-cart-line" data-testid="cart-line" data-line-id={line.id} data-priced={line.lineTotal ? 'true' : 'false'}>
			<div className="ds-cart-line-main">
				{line.item ? (
					<a className="ds-link" href={productPath(line.item.coordinates)}>
						{line.item.title}
					</a>
				) : (
					<span className="ds-muted" data-testid="cart-line-unreadable">
						{line.id} — this instance’s read carries no listing at that address
					</span>
				)}
				<span className="ds-muted">
					{line.amount} × {line.unitPrice ?? 'no price'} · {shortPubkey(line.item?.sellerPubkey ?? '')}
				</span>
			</div>
			<span className="ds-cart-line-total">{line.lineTotal ?? 'cannot be priced'}</span>
		</li>
	)
}

export function CartView({ cart, view }: { cart: CartControl; view: ProductListView }) {
	if (cart.status === 'reading') return <CartReading />
	if (cart.status === 'unavailable') return <CartUnavailable />

	const cartView = buildCartView(cart.cart ?? EMPTY_CART, view.items)

	if (cartView.lines.length === 0) {
		return (
			<CartRegion state="empty">
				<p className="ds-muted" data-testid="cart-summary">
					Your cart is empty. Nothing has been added in this browser.
				</p>
				<p className="ds-buy">
					<a className="ds-btn ds-btn-quiet" href={PRODUCTS_PATH}>
						Back to products
					</a>
				</p>
			</CartRegion>
		)
	}

	const subtotals = Object.entries(cartView.subtotalByCurrency)
	const totalLine = subtotals.length > 0 ? subtotals.map(([, amount]) => amount).join(' + ') : 'nothing priceable'

	return (
		<CartRegion state="read">
			<p className="ds-muted" data-testid="cart-summary">
				{cartView.summaryLine}
			</p>

			<ul className="ds-cart-lines" data-testid="cart-lines">
				{cartView.lines.map((line) => (
					<CartLineRow key={line.productRef} line={line} />
				))}
			</ul>

			<div className="ds-totals" data-testid="cart-totals">
				{subtotals.map(([currency, amount]) => (
					<div className="ds-total-row" key={currency} data-testid="cart-subtotal">
						<span>Subtotal</span>
						<span className="ds-total-value">{amount}</span>
					</div>
				))}
				<div className="ds-total-row" data-testid="cart-shipping">
					<span>Shipping</span>
					<span className="ds-total-value">not added</span>
				</div>
				<div className="ds-total-row" data-emphasis="true" data-testid="cart-total">
					<span>Total</span>
					<span className="ds-total-value">{totalLine}</span>
				</div>
				{cartView.totalInSats > 0 ? (
					<p className="ds-muted" data-testid="cart-sats">
						= {formatProductPrice(String(cartView.totalInSats), 'SATS')}, through the SDK’s own BTC→sats
						conversion.
					</p>
				) : null}
				<p className="ds-muted" data-testid="cart-shipping-note">
					{noShippingReason()}
				</p>
			</div>

			<p className="ds-buy">
				<a className="ds-btn" href={CHECKOUT_PATH} data-testid="cart-checkout-link">
					Go to checkout
				</a>
			</p>
		</CartRegion>
	)
}
