/**
 * orderPlacement.ts — **the cart intent → placed order step**, the one the layer was missing.
 *
 * ## Why this file exists
 *
 * `orders/` shipped the order-marker **template** (`createBuyerOrderTemplate`, `orderEvents.ts:35`), the
 * **status vocabulary** (`orderStatus.ts`) and the **planning contract** (`planSellerOrders`,
 * `workflowContracts.ts:38`) — and nothing consumed a `CartIntent`. The demo's checkout entry stopped at
 * *"no payment invoice is open"* because the step between the cart and an order did not exist anywhere in
 * `sdk/` or in the app. This is that step, in the module that already owns the template, the event and
 * the status.
 *
 * ## What it composes (it invents no parallel contract)
 *
 * - `resolveCheckoutDeliveryRequirements` (`checkout/deliveryRequirements.ts`) decides whether the cart's
 *   own shipping refs are **resolved**, and — when they are not — hands back the **refs that failed**,
 *   including the checkout's own `product:<id>:missing-shipping-method` sentinel. A gap is the checkout's
 *   gap, named in the checkout's words.
 * - `planSellerOrders` (`workflowContracts.ts:38`) is the module's own planner: it re-checks
 *   `deliveryRequirements.isResolved` per seller and refuses with `status: 'unresolved_delivery'` before
 *   any side effect. This workflow **calls it** rather than re-implementing the check, so the refusal
 *   vocabulary is the planner's, not a copy.
 * - `createBuyerOrderTemplate` is the only thing that produces the order event. No event is hand-built
 *   here.
 * - `resolveBuyerOrderStatus` / `resolveBuyerShippingStatus` derive the status **from the produced
 *   event's own tags**. Nothing is assumed: the template writes no `status` tag, so the derivation
 *   answers `pending` (and shipping `null`) because that is what the event says, not because this file
 *   chose it.
 *
 * ## A placed order is NOT a paid order
 *
 * The repository's doctrine is *"do not collapse payment lifecycles into booleans"* and *"do not equate
 * wallet acknowledgement, receipt publication, zap presence, or an external payment marker with
 * settlement unless current code and maintainer direction explicitly define that behavior."* Placement
 * raises no invoice and settles nothing, so a placed order carries an explicit **lifecycle stage**
 * (`payment: 'not-requested'`) — a stage, never a boolean, and never `true`. Payment is the next
 * increment; this file does not pretend it happened.
 *
 * ## ASSUMPTIONS
 *
 * Stated **as assumptions**, each with what would falsify it (`ORDER_PLACEMENT_ASSUMPTIONS`, a value a
 * test — and an app's on-screen assumption register — can read). They are not findings; they are the
 * judgements this step makes so that it can answer at all.
 */

import type { EventTemplate } from 'nostr-tools/pure'

import type { PersistedCartContent, PersistedCartItem } from '../cart/cartIntent'
import { resolveCheckoutDeliveryRequirements } from '../checkout/deliveryRequirements'
import { createBuyerOrderTemplate } from './orderEvents'
import { resolveBuyerOrderStatus, resolveBuyerShippingStatus, type BuyerOrderStatus, type BuyerShippingStatus } from './orderStatus'
import { planSellerOrders, type SellerOrderPlanInput } from './workflowContracts'

/**
 * The cart's own product-ref grammar, read backwards. `cartIntent.ts` builds the ref as
 * `30402:<64-hex seller>:<d>` and validates it with `/^30402:[a-f0-9]{64}:[^\s]+$/i`, so the seller is
 * the middle segment and the `d` (a product id) is everything after it — a `d` may legally contain a
 * colon, which is why the id is not split further.
 */
const CART_PRODUCT_REF = /^30402:([0-9a-f]{64}):(.+)$/i

/** A kind-30402 event's part, split out of the cart's own ref. `null` when the ref is not that shape. */
export function parseCartProductRef(productRef: string): { sellerPubkey: string; productId: string } | null {
	const match = CART_PRODUCT_REF.exec(productRef)
	if (!match || match[1] === undefined || match[2] === undefined) return null
	return { sellerPubkey: match[1], productId: match[2] }
}

/**
 * The host-supplied terms for one seller: the order identity (host-owned, the SDK mints no ids) and the
 * **already-resolved** amount in sats. This workflow prices nothing; the host resolves product prices and
 * shipping, exactly as `cartOperations.ts` documents for its totals inputs.
 */
export interface BuyerOrderSellerTerms {
	readonly orderId: string
	readonly amountSats: number
}

export interface CartOrderPlacementInput {
	/** The cart intent — `createCartIntent`'s own answer, or a record `parseCartPersistenceContent` accepted. */
	readonly intent: PersistedCartContent
	/** Per-seller order identity and resolved sats amount, keyed by the seller's 64-hex pubkey. */
	readonly sellerTerms: Readonly<Record<string, BuyerOrderSellerTerms>>
	/**
	 * The shipping service per shipping ref, as read from kind-30406 (`standard`, `pickup`, `digital`, …).
	 * Absent or empty means every chosen ref resolves as unresolved — never inferred from the ref's text.
	 */
	readonly servicesByShippingRef?: Readonly<Record<string, string | null | undefined>>
	/** The clock the order marker is stamped with. Injected, so a test reads no wall clock. */
	readonly createdAt: number
	readonly content?: string
}

/** The refusal vocabulary: the planner's own `unresolved_delivery`, and the cart's empty/price gaps. */
export type CartOrderPlacementRefusalReason = 'empty_cart' | 'unresolved_delivery' | 'unresolved-sats-price'

/**
 * A refusal that **names the gap**. `unresolved_delivery` carries the checkout's own unresolved refs
 * verbatim; `unresolved-sats-price` reuses the products module's reason of the same spelling
 * (`productPriceResolution.ts:58`) for a seller the host did not price.
 */
export type CartOrderPlacementRefusal =
	| { readonly status: 'refused'; readonly reason: 'empty_cart' }
	| { readonly status: 'refused'; readonly reason: 'unresolved_delivery'; readonly unresolvedShippingRefs: readonly string[] }
	| { readonly status: 'refused'; readonly reason: 'unresolved-sats-price'; readonly sellerPubkeys: readonly string[] }

/**
 * **A lifecycle stage, not a boolean.** Placement starts no payment, so the only stage it can honestly
 * write is `not-requested`. The union is closed; a later increment extends it by naming a real next
 * stage, never by flipping a flag.
 */
export const PLACED_ORDER_PAYMENT_LIFECYCLE = 'not-requested' as const
export type PlacedOrderPaymentLifecycle = typeof PLACED_ORDER_PAYMENT_LIFECYCLE

/** One placed buyer order: the event the module built, and the facts derived from that event. */
export interface PlacedBuyerOrder {
	readonly sellerPubkey: string
	readonly orderId: string
	readonly amountSats: number
	readonly items: readonly { readonly productRef: string; readonly quantity: number }[]
	readonly shippingRef?: string
	readonly requiresPrivateDelivery: boolean
	/** The order marker, from this module's own `createBuyerOrderTemplate`. */
	readonly order: EventTemplate
	/** Derived from `order.tags` by this module's resolver — never assumed. */
	readonly orderStatus: BuyerOrderStatus
	readonly shippingStatus: BuyerShippingStatus | null
	/** The payment lifecycle stage placement leaves the order in. Never a settlement claim. */
	readonly payment: PlacedOrderPaymentLifecycle
}

export type CartOrderPlacementOutcome =
	| { readonly status: 'placed'; readonly orders: readonly PlacedBuyerOrder[] }
	| CartOrderPlacementRefusal

export interface OrderPlacementAssumption {
	readonly assumption: string
	readonly falsifiedBy: string
}

/**
 * **The assumptions this step makes**, each with the observation that would falsify it. A value a test
 * reads and an app's on-screen assumption register can render.
 */
export const ORDER_PLACEMENT_ASSUMPTIONS: readonly OrderPlacementAssumption[] = Object.freeze([
	{
		assumption: 'one cart seller becomes exactly one buyer order — the order marker is per seller, so the intent is grouped by the seller encoded in each product ref.',
		falsifiedBy: "a cart where one seller's lines must become several orders (e.g. one per shipping option), or a maintainer direction that orders are per line.",
	},
	{
		assumption: "the intent's items carry the refs `createCartIntent` builds (`30402:<seller>:<d>`), so the seller is the ref's middle 64-hex segment; a record the app did not write is not trusted to have them.",
		falsifiedBy: 'a persisted cart record whose refs are valid to `PersistedCartContentSchema` yet whose middle segment is not the seller the order must be addressed to.',
	},
	{
		assumption: "a placed order is `pending` and no payment lifecycle has begun — the order marker writes no `status` and no `payment` tag, so the derivation answers `pending` and the lifecycle stage stays `not-requested`.",
		falsifiedBy: "current code or maintainer direction defining a placed (unpaid) order as something other than `pending`, or an order event that legitimately carries a settlement marker at placement.",
	},
	{
		assumption: 'the amount in sats per seller is supplied already-resolved by the host; this workflow prices nothing and reads no product or shipping record.',
		falsifiedBy: 'a checkout requirement that prices inside the SDK, or a cart that cannot be placed without the SDK acquiring exchange rates or product prices itself.',
	},
	{
		assumption: "a delivery gap is exactly the checkout module's `unresolvedShippingRefs` for the cart's own refs; a cart is refused only when that list is non-empty.",
		falsifiedBy: "a delivery mode outside the checkout's `physical | pickup | digital` set that is nonetheless resolvable, or an unresolved requirement the checkout cannot express as a ref.",
	},
	{
		assumption: "one shipping ref per seller holds (the cart's own `normalizeShippingForRestore` rule), so a seller's lines share one `shippingRef`; the order marker carries it once.",
		falsifiedBy: "a legitimate cart in which one seller's lines use different shipping refs at placement time.",
	},
])

interface SellerCartGroup {
	readonly items: readonly PersistedCartItem[]
	readonly itemsInput: readonly { readonly productRef: string; readonly quantity: number }[]
	readonly plannerProducts: readonly { readonly productId: string; readonly quantity: number }[]
	readonly checkoutProducts: readonly { readonly id: string; readonly shippingMethodId: string | null }[]
	readonly shippingRef?: string
}

/** Group the intent's items by the seller in each ref; drop a ref the cart's grammar does not accept. */
function groupItemsBySeller(items: readonly PersistedCartItem[]): Map<string, SellerCartGroup> {
	const groups = new Map<string, SellerCartGroup>()
	for (const item of items) {
		const parsed = parseCartProductRef(item.productRef)
		if (!parsed) continue
		const existing = groups.get(parsed.sellerPubkey)
		const itemView = { productRef: item.productRef, quantity: item.quantity }
		const plannerProduct = { productId: parsed.productId, quantity: item.quantity }
		const checkoutProduct = { id: parsed.productId, shippingMethodId: item.shippingRef ?? null }
		if (existing) {
			const shippingRef = existing.shippingRef ?? item.shippingRef ?? undefined
			groups.set(parsed.sellerPubkey, {
				items: [...existing.items, item],
				itemsInput: [...existing.itemsInput, itemView],
				plannerProducts: [...existing.plannerProducts, plannerProduct],
				checkoutProducts: [...existing.checkoutProducts, checkoutProduct],
				...(shippingRef ? { shippingRef } : {}),
			})
			continue
		}
		groups.set(parsed.sellerPubkey, {
			items: [item],
			itemsInput: [itemView],
			plannerProducts: [plannerProduct],
			checkoutProducts: [checkoutProduct],
			...(item.shippingRef ? { shippingRef: item.shippingRef } : {}),
		})
	}
	return groups
}

/**
 * **Turn a cart intent into placed orders, or refuse naming the gap.**
 *
 * Order of decision: an empty intent is refused; a seller the host did not price is refused; then the
 * module's own planner decides delivery and — if every seller's delivery is resolved — the workflow
 * builds one order per seller through `createBuyerOrderTemplate` and derives its status. Pure: no relay
 * read, no signing, no publishing, no network. The caller owns signing and transport.
 */
export function placeBuyerOrdersFromCartIntent(input: CartOrderPlacementInput): CartOrderPlacementOutcome {
	if (input.intent.items.length === 0) return { status: 'refused', reason: 'empty_cart' }

	const groups = groupItemsBySeller(input.intent.items)

	const unpriced: string[] = []
	for (const sellerPubkey of groups.keys()) {
		const terms = input.sellerTerms[sellerPubkey]
		if (!terms || !Number.isFinite(terms.amountSats)) unpriced.push(sellerPubkey)
	}
	if (unpriced.length > 0) return { status: 'refused', reason: 'unresolved-sats-price', sellerPubkeys: unpriced }

	const servicesByShippingRef = input.servicesByShippingRef ?? {}
	const planInputs: SellerOrderPlanInput[] = []
	for (const [sellerPubkey, group] of groups) {
		const terms = input.sellerTerms[sellerPubkey] as BuyerOrderSellerTerms
		planInputs.push({
			sellerPubkey,
			orderId: terms.orderId,
			amountSats: terms.amountSats,
			products: [...group.plannerProducts],
			...(group.shippingRef ? { shippingRef: group.shippingRef } : {}),
			deliveryRequirements: resolveCheckoutDeliveryRequirements({
				products: [...group.checkoutProducts],
				servicesByShippingRef,
			}),
		})
	}

	// The module's own planner makes the delivery decision, in the planner's vocabulary.
	const planning = planSellerOrders(planInputs)
	if (planning.status !== 'planned') {
		return { status: 'refused', reason: 'unresolved_delivery', unresolvedShippingRefs: planning.unresolvedShippingRefs }
	}

	const orders: PlacedBuyerOrder[] = planning.plans.map((plan) => {
		const order = createBuyerOrderTemplate({
			merchantPubkey: plan.sellerPubkey,
			orderId: plan.orderId,
			amountSats: plan.amountSats,
			items: plan.items.map((item) => ({ productRef: item.productRef, quantity: item.quantity })),
			...(plan.shippingRef ? { shippingRef: plan.shippingRef } : {}),
			createdAt: input.createdAt,
			...(input.content !== undefined ? { content: input.content } : {}),
		})
		return {
			sellerPubkey: plan.sellerPubkey,
			orderId: plan.orderId,
			amountSats: plan.amountSats,
			items: plan.items.map((item) => ({ productRef: item.productRef, quantity: item.quantity })),
			...(plan.shippingRef ? { shippingRef: plan.shippingRef } : {}),
			requiresPrivateDelivery: plan.requiresPrivateDelivery,
			order,
			// Derived from the built event's own tags — a placed order says `pending`, not `paid`.
			orderStatus: resolveBuyerOrderStatus(order.tags),
			shippingStatus: resolveBuyerShippingStatus(order.tags),
			payment: PLACED_ORDER_PAYMENT_LIFECYCLE,
		}
	})

	return { status: 'placed', orders }
}
