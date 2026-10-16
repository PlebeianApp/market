/**
 * instance/orderView.ts — **what an order's page says, and where every word of it comes
 * from.**
 *
 * The maintainer's instruction: *"…and the order details page which reflects the
 * status."* This module is that requirement turned into a value. It reads **one thing** —
 * the `PlacedBuyerOrder` `sdk/commerce/orders/orderPlacement.ts` returned — and it derives
 * every field of the page from it. It has no opinion about what an order's status is.
 *
 * ## The status is the SDK's, derived from the event's own tags
 *
 * `placeBuyerOrdersFromCartIntent` derives each order's status from the tags of the
 * event it just built (`resolveBuyerOrderStatus(order.tags)`), and that derivation is
 * what this page renders. Nothing here is a label: `buildOrderView` consumes
 * `placed.orderStatus` and `placed.shippingStatus`, and
 * `instance/orderView.test.ts` proves it by placing an order whose template **does**
 * carry a `status` tag and reading the page back — the page follows the event, not a
 * constant.
 *
 * ## What a placed order is NOT, and why this page cannot be read as saying otherwise
 *
 * Three claims sit beside each other on this page and must never be merged:
 *
 * 1. **an order status** — `pending`, because the built event carries no `status` tag;
 * 2. **a shipping status** — `null`, because shipping is a *separate* state and this
 *    event says nothing about it;
 * 3. **a payment lifecycle stage** — `not-requested`
 *    (`PLACED_ORDER_PAYMENT_LIFECYCLE`, imported from the module, never re-typed): a
 *    **stage, not a boolean**. Placement raises no invoice and settles nothing.
 *
 * A placed order is not a paid order, and this page does not have a field that could
 * say it was. There is no `paid`, no `complete`, no badge — only the stage the module
 * names.
 *
 * ## Unsigned, unpublished: derived where it can be, named where it cannot
 *
 * - **Unsigned** is *derived*: the template is inspected for an envelope signature
 *   (`sig`) or a computed id, and reports `unsigned` when neither exists — which is what
 *   `EventTemplate` is, and what a demo with no signer and no keys can produce.
 * - **Unpublished** is *named*: `ORDER_PUBLICATION_STATE` is a constant, because this app
 *   composes **no publish path at all** — no `executeSellerOrderPublishWorkflow`, no
 *   signing call — and `instance/orderView.test.ts` holds that as a source fact over
 *   every file the app owns, so a later increment that added a publishing transport would
 *   fail the arm that says nothing here publishes.
 */

import { findNextActionableInvoiceIndex } from '@sdk/commerce/checkout'
import type { BuyerOrderStatus, BuyerShippingStatus } from '@sdk/commerce/orders/orderStatus'
import {
	PLACED_ORDER_PAYMENT_LIFECYCLE,
	parseCartProductRef,
	type PlacedBuyerOrder,
	type PlacedOrderPaymentLifecycle,
} from '@sdk/commerce/orders/orderPlacement'

import type { ProductListItem } from './productListView'
import { shortPubkey } from './productListView'

/**
 * Whether the order's own event carried a signature.
 *
 * Derived from the template rather than asserted: an `EventTemplate` has no `sig` and no
 * `id`, and this reads for them. The demo therefore reports the only answer it can
 * honestly give, and a signature that appeared would report itself.
 */
export type OrderSignatureState = 'unsigned' | 'signed'

/**
 * Nothing in this app publishes an order.
 *
 * Named rather than inferred: there is no relay transport and no signing call anywhere
 * under `apps/demo-shop`, which the suite holds as a source fact. So the only value this
 * view can report is that the order was **not published** — and it says that as a state a
 * reader can quote rather than as an absence they must infer.
 */
export const ORDER_PUBLICATION_STATE = 'not-published' as const

/** One line of the order, joined to the instance's read where the read can answer. */
export interface OrderItemView {
	readonly productRef: string
	readonly productId: string
	readonly quantity: number
	/** The listing's title, or `null` when this read carries no listing at that address. */
	readonly title: string | null
}

export interface OrderView {
	readonly orderId: string
	readonly sellerPubkey: string
	readonly sellerLabel: string
	readonly amountSats: number
	readonly items: readonly OrderItemView[]

	/** The shipping ref the order carries, or `null` when none was chosen. */
	readonly shippingRef: string | null
	/** The service the kind-30406 read resolved for that ref, or `null`. Never inferred from the ref. */
	readonly shippingService: string | null
	readonly requiresPrivateDelivery: boolean

	/** The order status, as the SDK derived it from the built event's own tags. */
	readonly status: BuyerOrderStatus
	/** Shipping state, kept separate from order and payment state. `null` when unrecorded. */
	readonly shippingStatus: BuyerShippingStatus | null
	/** The payment **lifecycle stage** placement leaves the order in. Never a settlement claim. */
	readonly payment: PlacedOrderPaymentLifecycle
	/** `-1`: the SDK's own progress rule, asked over the invoices that exist — none. */
	readonly nextInvoiceIndex: number

	readonly signature: OrderSignatureState
	readonly publication: typeof ORDER_PUBLICATION_STATE

	/**
	 * Whether the built event carries a `status` tag — which is *why* the derivation
	 * answered. Both resolvers read that one tag name: the order resolver accepts only
	 * the order vocabulary, the shipping resolver only the shipping vocabulary, which is
	 * how one tag can leave the order status `pending` and the shipping status recorded.
	 */
	readonly statusTagPresent: boolean

	readonly eventKind: number
	readonly eventCreatedAt: number
	readonly eventContent: string
	/** The event's own tags, as built. A reader can check the derivation against them. */
	readonly eventTags: readonly (readonly string[])[]
}

export interface OrderViewOptions {
	/** The listing read, so an order's lines can be named by title where the read answers. */
	readonly items?: readonly ProductListItem[]
	/** The shipping-service map, as read from kind-30406. Absent means nothing was resolved. */
	readonly servicesByShippingRef?: Readonly<Record<string, string | null | undefined>>
}

/** The event's own value for a tag name, as a reader of the raw tag list would find it. */
function tagValue(tags: readonly (readonly string[])[], name: string): string | null {
	const tag = tags.find((candidate) => candidate[0] === name)
	return tag?.[1] ?? null
}

/** Build the order page's view from the order the SDK placed. Every field traces to it. */
export function buildOrderView(placed: PlacedBuyerOrder, options: OrderViewOptions = {}): OrderView {
	const byCoordinates = new Map<string, ProductListItem>()
	for (const item of options.items ?? []) byCoordinates.set(item.coordinates, item)

	const envelope = placed.order as { readonly sig?: unknown; readonly id?: unknown }
	const signature: OrderSignatureState = envelope.sig !== undefined || envelope.id !== undefined ? 'signed' : 'unsigned'

	const shippingRef = placed.shippingRef ?? null
	const service = shippingRef ? (options.servicesByShippingRef?.[shippingRef] ?? null) : null

	// The invoices that exist for this order: none. Placement raises none, so the SDK's
	// own progress rule answers -1 — the same rule the checkout asks, asked here too.
	const nextInvoiceIndex = findNextActionableInvoiceIndex([], -1)

	return {
		orderId: placed.orderId,
		sellerPubkey: placed.sellerPubkey,
		sellerLabel: shortPubkey(placed.sellerPubkey),
		amountSats: placed.amountSats,
		items: placed.items.map((item) => ({
			productRef: item.productRef,
			// The module's own ref parser, not a second reading of the ref's segments.
			productId: parseCartProductRef(item.productRef)?.productId ?? '',
			quantity: item.quantity,
			title: byCoordinates.get(item.productRef)?.title ?? null,
		})),

		shippingRef,
		shippingService: service,
		requiresPrivateDelivery: placed.requiresPrivateDelivery,

		status: placed.orderStatus,
		shippingStatus: placed.shippingStatus,
		payment: placed.payment,
		nextInvoiceIndex,

		signature,
		publication: ORDER_PUBLICATION_STATE,

		statusTagPresent: tagValue(placed.order.tags, 'status') !== null,

		eventKind: placed.order.kind,
		eventCreatedAt: placed.order.created_at,
		eventContent: placed.order.content,
		eventTags: Object.freeze(placed.order.tags.map((tag) => Object.freeze([...tag]))),
	}
}

/**
 * The lifecycle stages, as the page renders them — **one line each**, in the module's own
 * words, so no surface can collapse them into one badge.
 *
 * `tone` is the house style's soft pair, derived from the value rather than chosen per
 * row: a stage that is unrecorded or un-requested is not a success, and a page that
 * painted them all green would be saying something the values do not say.
 */
export function orderLifecycleLines(
	view: OrderView,
): readonly { readonly label: string; readonly value: string; readonly tone: 'ok' | 'neutral' | 'warn' }[] {
	return [
		{
			label: 'Order status',
			value: view.status,
			tone: view.status === 'pending' ? 'warn' : 'ok',
		},
		{
			label: 'Shipping status',
			value:
				view.shippingStatus === null
					? 'none recorded — shipping is a separate state, and this event says nothing about it'
					: view.shippingStatus,
			tone: view.shippingStatus === null ? 'neutral' : 'ok',
		},
		{
			label: 'Payment lifecycle',
			value: `${view.payment} — no invoice was raised and no payment has been requested`,
			tone: view.payment === 'not-requested' ? 'warn' : 'ok',
		},
		{
			label: 'Signature',
			value:
				view.signature === 'signed'
					? 'signed — the event carries a signature'
					: 'not signed — this is an unsigned event template; the demo holds no key',
			tone: view.signature === 'signed' ? 'ok' : 'warn',
		},
		{
			label: 'Publication',
			value: `${view.publication} — nothing was sent to a relay`,
			tone: view.publication === ORDER_PUBLICATION_STATE ? 'warn' : 'ok',
		},
	]
}

/** Why the order status is what it is, in the event's own terms. */
export function orderStatusExplanation(view: OrderView): string {
	return view.statusTagPresent
		? `The built event carries a \`status\` tag, and the SDK’s resolver read it: ${view.status}.`
		: 'The built event carries no `status` tag, so the SDK’s own resolver (`resolveBuyerOrderStatus`) answers `pending` — the status is derived from the event, not chosen here.'
}

/** The SDK's payment lifecycle stage for a placed order, as the module declares it. */
export const PLACED_ORDER_PAYMENT_STAGE: PlacedOrderPaymentLifecycle = PLACED_ORDER_PAYMENT_LIFECYCLE
