/**
 * instance/CheckoutEntry.tsx — **the checkout entry, which now places.**
 *
 * It still does not pay, and it still says so. What changed when
 * `sdk/commerce/orders/orderPlacement.ts` landed is that the handoff is no longer the end
 * of the road: this surface now **submits this browser's cart to the instance**, and the
 * instance places the order through the module that owns placement
 * (`instance/checkoutView.ts` → `placeBuyerOrdersFromCartIntent`).
 *
 * ## Why the placement is a form, and why the instance does it
 *
 * The cart is the **browser's** and there is no session (`instance/cartState.ts`), so a
 * server render cannot know what the shopper holds. The order, however, is the
 * **instance's** record — and the order details page must carry the order's own status in
 * the **served bytes**, not after hydration. Both facts point the same way: the browser
 * submits the record it already stores (`CartControl.persisted()` — the SDK's own
 * `createCartIntent` output, the same bytes `writeCart` writes) and the instance does the
 * placement and answers with the order's page.
 *
 * That is why the place control is **disabled until the cart has been read**: a
 * submission made before the read is a submission of nothing, and it says which state it
 * is in rather than looking like a dead button.
 *
 * ## The shipping choice, and what is deliberately still unresolved
 *
 * A cart can only be placed once `resolveCheckoutDeliveryRequirements` resolves — and the
 * cart does not carry a shipping selection (the buy control does not ask for one). So the
 * checkout asks: one choice per seller, drawn from **that seller's own published refs**,
 * resolved through the kind-30406 read (`instance/shippingSource.ts`). Nothing is
 * inferred from a ref's text, and nothing is defaulted: the choice is the shopper's, and
 * leaving it unchosen is a state the page reports in the checkout's own words rather than
 * a gap it papered over.
 *
 * ## What the page promises when the button is pressed
 *
 * Nothing about money, and nothing about publication. Placing builds an **unsigned event
 * template**: no key is held to sign it with, no transport is composed to publish it, and
 * no invoice is raised for it. The place region says all three in its own words, and the
 * refusal region — when the module refuses, naming the gap (`unresolved_delivery`,
 * `unresolved-sats-price`, `empty_cart`) — says the module's words back.
 */

import * as React from 'react'

import { Badge } from '@ui/index'

import { buildCartView, noShippingReason } from './cartTotals'
import {
	CART_FIELD_NAME,
	SHIPPING_CHOICE_FIELD_PREFIX,
	shippingChoicesForCart,
	type CheckoutSubmission,
} from './checkoutView'
import { buildCheckoutView } from './checkoutView'
import { EMPTY_CART } from './cartState'
import type { ShippingReadView } from './shippingSource'
import { shortPubkey, type ProductListView } from './productListView'
import { CART_PATH, CHECKOUT_PATH, PRODUCTS_PATH } from './routes'
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
		<>
			<p className="ds-muted" data-testid="checkout-summary">
				Reading this browser’s cart…
			</p>
			<div className="ds-cart-lines" data-skeleton="1" aria-hidden="true">
				<div className="sk sk-line" style={{ width: '58%' }} />
				<div className="sk sk-line" style={{ width: '36%' }} />
			</div>
		</>
	)
}

/**
 * The instance's side of a placement: the shipping choices, the place control, and the
 * three promises the button makes.
 *
 * It is rendered in **every** state — including the skeleton one — because everything it
 * needs is server-known: which shipping refs a seller publishes and what the kind-30406
 * read resolved them to. Only the two things the browser owns (the cart's own record, and
 * whether the read has landed) are rendered conditionally.
 */
function PlaceRegion({
	cart,
	shipping,
	submission,
	sellersInCart,
}: {
	cart: CartControl
	shipping: ShippingReadView
	submission: CheckoutSubmission | null
	sellersInCart: readonly string[] | null
}) {
	const [choiceBySeller, setChoiceBySeller] = React.useState<Record<string, string>>({})

	const reading = cart.status === 'reading'
	const unavailable = cart.status === 'unavailable'
	const persisted = reading || unavailable ? null : cart.persisted()
	const submittedCart = (cart.cart ?? EMPTY_CART).lines.length > 0
	const canPlace = persisted !== null && submittedCart

	// Once the cart is known the choices narrow to the sellers it actually holds; before
	// that the region states every seller the read published options for, which is what
	// the server render carries.
	const sellerIds = sellersInCart ?? Object.keys(shipping.optionsBySeller).sort()
	const choices = sellerIds.map((sellerPubkey) => ({
		sellerPubkey,
		options: shipping.optionsBySeller[sellerPubkey] ?? [],
	}))

	const placeState = submission !== null ? 'refused' : unavailable ? 'unavailable' : !canPlace ? 'off' : 'ready'
	const placeStatus =
		submission !== null
			? 'The instance refused this attempt. The gap is named below; nothing was placed.'
			: unavailable
				? 'this browser has no reachable cart storage, so there is nothing to submit'
				: reading
					? 'reading this browser’s cart…'
					: !submittedCart
						? 'this browser’s cart is empty, so there is nothing to place'
						: `${persisted === null ? 'no cart record' : `${(cart.cart ?? EMPTY_CART).lines.length} line${(cart.cart ?? EMPTY_CART).lines.length === 1 ? '' : 's'} will be submitted`} — the instance places the order`

	return (
		<section aria-labelledby="checkout-place-heading" data-testid="checkout-place-region" className="ds-note">
			<h2 className="ds-section-title" id="checkout-place-heading">
				Place the order
			</h2>

			<p className="ds-note" data-testid="checkout-place-truth">
				Placing builds the order and nothing else. The order is an <strong>unsigned event template</strong>: this
				demo holds no key, so nothing signs it; it composes no relay transport, so nothing publishes it; and no
				invoice is raised, so no payment has been requested. A placed order is not a paid order.
			</p>

			<p className="ds-muted" data-testid="checkout-shipping-read">
				Shipping refs the listings publish, resolved through the kind-30406 read: {shipping.summaryLine}
				{shipping.edge === 'not-read-on-this-edge'
					? ' — this edge read no shipping record, so a chosen ref stays unresolved.'
					: '.'}
			</p>

			{submission !== null ? <RefusalRegion submission={submission} /> : null}

			<form method="post" action={CHECKOUT_PATH} data-testid="checkout-place-form">
				<input type="hidden" name={CART_FIELD_NAME} value={persisted ?? ''} />

				{choices.map((choice) => (
					<fieldset
						className="ds-note"
						key={choice.sellerPubkey}
						data-testid="checkout-shipping-choice"
						data-seller={choice.sellerPubkey}
					>
						<legend>Shipping for {shortPubkey(choice.sellerPubkey)}</legend>
						{choice.options.length === 0 ? (
							<p className="ds-muted" data-testid="checkout-shipping-none">
								This instance’s shipping read resolved no option for that seller, so its delivery cannot be
								resolved — a chosen ref would resolve as unresolved rather than being guessed.
							</p>
						) : (
							<select
								className="ds-qty"
								name={`${SHIPPING_CHOICE_FIELD_PREFIX}${choice.sellerPubkey}`}
								data-testid="checkout-shipping-select"
								value={choiceBySeller[choice.sellerPubkey] ?? ''}
								disabled={reading}
								onChange={(event) =>
									setChoiceBySeller((held) => ({ ...held, [choice.sellerPubkey]: event.target.value }))
								}
							>
								<option value="">no shipping method chosen</option>
								{choice.options.map((option) => (
									<option value={option.ref} key={option.ref} data-testid="checkout-shipping-option">
										{option.known
											? `${option.title ?? option.optionId} · ${option.service ?? 'service unknown'}${option.price ? ` · ${option.price.amount} ${option.price.unit}` : ''}`
											: `${option.ref} — no kind-30406 record resolved it${option.refusal ? ` (${option.refusal})` : ''}`}
									</option>
								))}
							</select>
						)}
					</fieldset>
				))}

				<button
					type="submit"
					className="ds-btn"
					data-testid="checkout-place"
					data-place-state={placeState}
					disabled={!canPlace}
				>
					Place the order
				</button>

				<p className="ds-status" data-testid="checkout-place-status" data-tone={canPlace ? 'ok' : 'off'}>
					{placeStatus}
				</p>
			</form>
		</section>
	)
}

/**
 * The module's own refusal, in the module's own vocabulary.
 *
 * Every branch names the thing that stopped the placement: `empty_cart`, the checkout's
 * unresolved delivery refs (`unresolved_delivery`, carried verbatim), or the sellers no
 * sats amount was resolved for (`unresolved-sats-price`). None of them is a generic
 * failure sentence, and none of them hides which seller or which ref was the gap.
 */
function RefusalRegion({ submission }: { submission: CheckoutSubmission }) {
	if (submission.kind === 'unreadable-cart') {
		return (
			<div className="ds-note" data-testid="checkout-refusal" data-refusal-reason="unreadable-cart">
				<p>
					The instance refused: the bytes it was sent are not a cart record the SDK’s own parser accepts
					(`parseCartPersistenceContent`), so nothing was placed and no placement was even attempted.
				</p>
				<p className="ds-muted" data-testid="checkout-refusal-nothing">
					Nothing was placed, nothing was signed, nothing was published, and no payment was requested.
				</p>
			</div>
		)
	}

	const outcome = submission.outcome
	if (outcome.status !== 'refused') return null

	const reason = outcome.reason
	const sentence =
		reason === 'empty_cart'
			? 'The instance refused: the record this browser submitted carries no line, so there was no cart to place.'
			: reason === 'unresolved_delivery'
				? 'The instance refused: delivery is unresolved. These are the checkout’s own unresolved refs, as the module named them.'
				: 'The instance refused: no satoshi amount was resolved for these sellers, so no order was placed at an amount nobody computed.'

	return (
		<div className="ds-note" data-testid="checkout-refusal" data-refusal-reason={reason}>
			<p>{sentence}</p>
			{reason === 'unresolved_delivery' ? (
				<ul className="ds-meta" data-testid="checkout-refusal-refs">
					{outcome.unresolvedShippingRefs.map((ref) => (
						<li key={ref}>{ref}</li>
					))}
				</ul>
			) : null}
			{reason === 'unresolved-sats-price' ? (
				<ul className="ds-meta" data-testid="checkout-refusal-sellers">
					{outcome.sellerPubkeys.map((seller) => (
						<li key={seller}>{seller}</li>
					))}
				</ul>
			) : null}
			<p className="ds-muted" data-testid="checkout-refusal-nothing">
				Nothing was placed, nothing was signed, nothing was published, and no payment was requested.
			</p>
		</div>
	)
}

export function CheckoutEntry({
	cart,
	view,
	shipping,
	submission = null,
}: {
	cart: CartControl
	view: ProductListView
	shipping: ShippingReadView
	submission?: CheckoutSubmission | null
}) {
	const cartHeld = cart.cart ?? EMPTY_CART
	const sellersInCart = cart.cart === null ? null : [...new Set(cartHeld.lines.map((line) => line.sellerPubkey))]

	const place = <PlaceRegion cart={cart} shipping={shipping} submission={submission} sellersInCart={sellersInCart} />

	if (cart.status === 'reading') {
		return (
			<CheckoutRegion state="reading">
				<CheckoutReading />
				{place}
			</CheckoutRegion>
		)
	}

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
				{place}
			</CheckoutRegion>
		)
	}

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
				{place}
			</CheckoutRegion>
		)
	}

	// The same view model the cart renders, so the two surfaces cannot disagree
	// about what the cart holds or what it is worth.
	const cartView = buildCartView(cartHeld, view.items)
	const checkout = buildCheckoutView(cartHeld, {
		updatedAtMs: Date.now(),
		servicesByShippingRef: shipping.servicesByShippingRef,
	})
	const requirements = checkout.requirements

	const subtotals = Object.entries(cartView.subtotalByCurrency)
	const deliveryModes = [
		requirements.hasPhysicalDelivery ? 'physical' : '',
		requirements.hasPickupDelivery ? 'pickup' : '',
		requirements.hasDigitalDelivery ? 'digital' : '',
	].filter((mode) => mode.length > 0)

	return (
		<CheckoutRegion state={submission !== null ? 'refused' : 'handoff'}>
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
				{checkout.shippingRefsWithoutRecord.length > 0 ? (
					<p className="ds-muted" data-testid="checkout-shipping-without-record">
						These refs the cart carries were not resolved by the kind-30406 read:{' '}
						{checkout.shippingRefsWithoutRecord.join(', ')}.
					</p>
				) : null}
			</div>

			<p className="ds-muted" data-testid="checkout-invoice">
				{checkout.nextInvoiceIndex === -1
					? 'No payment invoice is open — none has been raised, because payment is not built.'
					: `Invoice ${checkout.nextInvoiceIndex} is the next to settle.`}
			</p>

			<div className="ds-detail-meta">
				<Badge variant={requirements.isResolved ? 'secondary' : 'outline'} data-testid="checkout-delivery-badge">
					{requirements.isResolved ? 'delivery resolved' : 'delivery unresolved'}
				</Badge>
			</div>

			<p className="ds-note" data-testid="checkout-outcome">
				Payment is not built, and placing does not pretend otherwise: this checkout places the <em>order</em> —
				an unsigned event template the instance records under an id of its own — and raises no invoice, settles
				nothing and publishes nothing. {noShippingReason()}
			</p>

			<p className="ds-buy">
				<a className="ds-btn ds-btn-quiet" href={CART_PATH} data-testid="checkout-back-to-cart">
					Back to the cart
				</a>
			</p>

			{place}
		</CheckoutRegion>
	)
}
