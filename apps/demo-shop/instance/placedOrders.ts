/**
 * instance/placedOrders.ts — **where this instance keeps the orders it placed.**
 *
 * A placed order is an **unsigned event template**. The demo has no signer and no keys
 * and must not acquire any, so nothing signs it; and it composes no relay transport, so
 * nothing publishes it. What exists after a placement is a template this process holds,
 * and this file is that: a `Map` in the instance's memory, keyed by the order id the
 * checkout minted.
 *
 * ## Why it is a map in memory and not a store
 *
 * Every alternative would be a lie about this slice. Writing the order to a relay would
 * be publishing a signed event, and there is no signer; writing it to the browser's
 * storage would make an *instance* record a property of one browser, and an order is the
 * instance's record of what was placed; a database is a component this increment did not
 * add. So the order lives in the process, and the page says exactly that, including what
 * it costs: **restarting the instance forgets every order it placed**, and an id is
 * readable by anyone who has it while the process runs.
 *
 * Nothing here mutates an order. `rememberPlacedOrders` records what the placement
 * module returned; `findPlacedOrder` hands it back as it was, or `null` — never a
 * default order, never a rebuilt one.
 */

import type { PlacedBuyerOrder } from '@sdk/commerce/orders/orderPlacement'

const PLACED = new Map<string, PlacedBuyerOrder>()

/** The instance's own store, for the route handlers that need to read what it holds. */
export interface PlacedOrderStore {
	remember(orders: readonly PlacedBuyerOrder[]): void
	find(orderId: string): PlacedBuyerOrder | null
	ids(): readonly string[]
}

/** Record the orders one placement produced. The module's own answer, kept as it came. */
export function rememberPlacedOrders(orders: readonly PlacedBuyerOrder[]): void {
	for (const order of orders) PLACED.set(order.orderId, order)
}

/** The order this instance holds under that id, or `null`. Never a default. */
export function findPlacedOrder(orderId: string): PlacedBuyerOrder | null {
	return PLACED.get(orderId) ?? null
}

/** Every id this instance currently holds, in insertion order — what a probe can enumerate. */
export function placedOrderIds(): readonly string[] {
	return [...PLACED.keys()]
}

/**
 * The same three operations as a value, so the server can be handed an instance-scoped
 * store rather than reaching this module's global — a test can then drive the routes
 * over its own empty store.
 */
export function instancePlacedOrders(): PlacedOrderStore {
	return {
		remember: rememberPlacedOrders,
		find: findPlacedOrder,
		ids: placedOrderIds,
	}
}

/** Empty the instance's memory of placed orders. Called at boot by `startDemoShop`. */
export function forgetPlacedOrders(): void {
	PLACED.clear()
}
