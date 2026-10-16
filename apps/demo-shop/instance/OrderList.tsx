/**
 * instance/OrderList.tsx — **every order this instance holds, as a server-rendered list.**
 *
 * The page is the index of `instance/placedOrders.ts`: each order the instance placed and
 * still remembers, listed with its id (linked to the order's own page), its status badge,
 * the merchant, the amount in sats, and when it was created. It is the view that closes
 * the UX gap the redirect-to-order-page introduced: a shopper who placed one order and
 * then a second has no way back to the first — the nav offers nothing under "Orders" and
 * the order detail page's breadcrumbs point at Checkout. This is that way.
 *
 * The list is **server-rendered** from the instance's own memory — it is not the
 * browser's cart, it is the instance's record — so the ids and the status badges are in
 * the served bytes. `curl /orders` shows every one.
 */

import * as React from 'react'

import { Badge, cn } from '@ui/index'

import type { OrderView } from './orderView'
import { CART_PATH, CHECKOUT_PATH, ORDERS_PATH_PREFIX } from './routes'

export function OrderList({ orders, className }: { orders: readonly OrderView[]; className?: string }) {
	return (
		<section
			aria-label="The orders you placed"
			data-testid="orders"
			data-orders-count={orders.length}
			className={cn('ds-region region region-orders ds-cart', className)}
		>
			<h1 className="ds-section-title">Your orders</h1>

			{orders.length === 0 ? (
				<p className="ds-muted" data-testid="orders-empty">
					You have not placed any orders yet. An order is placed from the checkout — it stays in this
					instance's memory until the process restarts.
				</p>
			) : (
				<ul className="ds-cart-lines" data-testid="orders-list">
					{orders.map((order) => (
						<li className="ds-cart-line" key={order.orderId} data-order-id={order.orderId} data-testid="orders-row">
							<div className="ds-cart-line-main">
								<a className="ds-link" href={`${ORDERS_PATH_PREFIX}${encodeURIComponent(order.orderId)}`}>
									{order.orderId}
								</a>
								<span className="ds-muted">{order.sellerLabel} · {order.amountSats} sats</span>
							</div>
							<Badge variant="secondary" data-testid="orders-status">
								{order.status}
							</Badge>
						</li>
					))}
				</ul>
			)}

			<p className="ds-buy">
				<a className="ds-btn ds-btn-quiet" href={CHECKOUT_PATH}>
					← Back to checkout
				</a>
				<a className="ds-btn ds-btn-quiet" href={CART_PATH}>
					Cart
				</a>
			</p>
		</section>
	)
}