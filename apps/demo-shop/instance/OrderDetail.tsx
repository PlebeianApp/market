/**
 * instance/OrderDetail.tsx — **the order details page, and the two things it must never
 * say.**
 *
 * It says what the order *is*: the id, the merchant it was addressed to, the amount in
 * sats, the lines, the shipping ref and the resolved service, the event it was built as,
 * and the lifecycle stages the SDK derives. Every one of those values comes from
 * `instance/orderView.ts`, which reads them off the `PlacedBuyerOrder` the placement
 * module returned.
 *
 * It does **not** say the order is paid, and it does not say it is published. A placed
 * order is an **unsigned event template** this instance holds in memory: nothing signed
 * it (the demo has no signer and no keys), nothing published it (this app composes no
 * relay transport), and no invoice exists for it (`not-requested` —
 * `PLACED_ORDER_PAYMENT_LIFECYCLE`, the module's own stage, `paymentLifecycleFromView`).
 * Those are their own labelled lines rather than one "complete" badge, because a badge
 * cannot say three different things and this page has to say three different things.
 *
 * The page is **server-rendered**. It is not the browser's cart — it is the instance's
 * record of an order the instance placed — so its content is in the served bytes: `curl`
 * shows the id and the status, not a skeleton and not something hydration adds.
 */

import * as React from 'react'

import { Badge, cn } from '@ui/index'

import { orderLifecycleLines, orderStatusExplanation, type OrderView } from './orderView'
import { CART_PATH, CHECKOUT_PATH, PRODUCTS_PATH, productPath } from './routes'

/**
 * The one-line statement of what a placed order is not.
 *
 * Rendered verbatim in the page's own bytes and pinned by `instance/orderView.test.ts`,
 * so the sentence a reader quotes is the sentence the page carries.
 */
export const PLACED_ORDER_TRUTH =
	'This order was built and recorded by this instance. It is not signed, not published, and no payment has been requested: the demo holds no key, composes no relay transport, and raises no invoice.'

export function OrderDetail({ order, className }: { order: OrderView; className?: string }) {
	const lines = orderLifecycleLines(order)

	return (
		<section
			aria-label="The order details page"
			data-testid="order-detail"
			data-order-id={order.orderId}
			className={cn('ds-region region region-order ds-detail', className)}
		>
			<p className="ds-eyebrow">
				<a className="ds-back" href={CHECKOUT_PATH}>
					← Checkout
				</a>
				{' · '}
				<a className="ds-back" href={CART_PATH}>
					Cart
				</a>
			</p>

			<div className="ds-detail-head">
				<h1 className="ds-detail-title">
					Order <span data-testid="order-id">{order.orderId}</span>
				</h1>

				<div className="ds-detail-meta">
					<Badge variant="secondary" data-testid="order-status-badge">
						{order.status}
					</Badge>
					<span className="ds-muted" data-testid="order-merchant">
						{order.sellerLabel}
					</span>
					<span className="ds-price" data-testid="order-amount">
						{order.amountSats} sats
					</span>
				</div>

				<p className="ds-note" data-testid="order-truth">
					{PLACED_ORDER_TRUTH}
				</p>
			</div>

			<div className="ds-detail-body">
				<h2 className="ds-section-title">Lifecycle stages</h2>
				<p className="ds-muted">
					Five separate states, each in the SDK’s own words. They are not one badge, and none of them is a
					payment.
				</p>
				<div className="ds-totals" data-testid="order-lifecycle">
					{lines.map((line) => (
						<div
							className="ds-total-row"
							key={line.label}
							data-testid={`order-stage-${line.label.toLowerCase().replace(/ /g, '-')}`}
							data-lifecycle-tone={line.tone}
						>
							<span>{line.label}</span>
							<span className="ds-total-value">{line.value}</span>
						</div>
					))}
				</div>
				<p className="ds-muted" data-testid="order-status-source">
					{orderStatusExplanation(order)}
				</p>
				<p className="ds-muted" data-testid="order-invoice">
					{order.nextInvoiceIndex === -1
						? 'No payment invoice is open — the checkout’s own progress rule found nothing to settle, because none was raised.'
						: `Invoice ${order.nextInvoiceIndex} is the next to settle.`}
				</p>
			</div>

			<div className="ds-detail-body">
				<h2 className="ds-section-title">What was ordered</h2>
				<ul className="ds-cart-lines" data-testid="order-items">
					{order.items.map((item) => (
						<li
							className="ds-cart-line"
							key={item.productRef}
							data-line-id={item.productId}
							data-testid="order-item"
						>
							<div className="ds-cart-line-main">
								{item.title ? (
									<a className="ds-link" href={productPath(item.productRef)}>
										{item.title}
									</a>
								) : (
									<span className="ds-muted">
										{item.productId} — this instance’s read carries no listing at that address
									</span>
								)}
								<span className="ds-muted">{item.productRef}</span>
							</div>
							<span className="ds-cart-line-total">× {item.quantity}</span>
						</li>
					))}
				</ul>
				<p className="ds-meta" data-testid="order-shipping">
					{order.shippingRef
						? `shipping ${order.shippingRef}${order.shippingService ? ` · ${order.shippingService}` : ' · no service was resolved for that ref'}`
						: 'no shipping ref is on this order'}
					{order.requiresPrivateDelivery ? ' · this order requires a private delivery' : ''}
				</p>
			</div>

			<div className="ds-detail-body">
				<h2 className="ds-section-title">The event it was built as</h2>
				<p className="ds-meta" data-testid="order-event-header">
					<span data-testid="order-event-kind">kind {order.eventKind}</span>
					{' · '}
					<span data-testid="order-event-created-at">created_at {order.eventCreatedAt}</span>
					{' · '}
					<span data-testid="order-event-content">{order.eventContent}</span>
				</p>
				<ul className="ds-meta" data-testid="order-event-tags">
					{order.eventTags.map((tag, index) => (
						<li key={`${index}:${tag.join('|')}`} data-testid="order-event-tag">
							{tag.join(' · ')}
						</li>
					))}
				</ul>
				<p className="ds-note" data-testid="order-memory-note">
					This instance holds the order in its own memory under that id, because a demo with no signer cannot
					publish one anywhere: restarting the instance forgets it, and anyone with the id can read it while
					the process runs. Nothing here is a settlement, a receipt or a shipment.
				</p>
			</div>

			<p className="ds-buy">
				<a className="ds-btn ds-btn-quiet" href={PRODUCTS_PATH} data-testid="order-back-to-products">
					Back to products
				</a>
			</p>
		</section>
	)
}

/**
 * An order address this instance holds nothing under.
 *
 * A named state with its own words, not an empty page: the id came from a URL somebody
 * followed, and there are two reasons it resolves to nothing — this instance never placed
 * an order at all, or it placed orders but not this one.
 */
export function OrderMissing({ orderId, className }: { orderId: string; className?: string }) {
	return (
		<section
			aria-label="The order details page"
			data-testid="order-missing"
			data-order-id={orderId}
			className={cn('ds-region region region-order ds-detail', className)}
		>
			<p className="ds-eyebrow">
				<a className="ds-back" href={CHECKOUT_PATH}>
					← Checkout
				</a>
			</p>
			<h1 className="ds-detail-title" data-testid="order-missing-title">
				No order here
			</h1>
			<p className="ds-detail-body" data-testid="order-missing-reason">
				This instance holds no order under <span data-testid="order-missing-id">{orderId}</span>. It holds only
				the orders it placed itself, in its own memory — and it placed none at this address.
			</p>
			<p className="ds-note">
				An order id is not a lookup key into a relay: nothing was published, by this instance or by the cart, so
				there is no other place for one to come from.
			</p>
		</section>
	)
}
