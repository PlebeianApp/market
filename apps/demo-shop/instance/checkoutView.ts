/**
 * instance/checkoutView.ts — what the checkout resolves from the cart, and what it
 * **places**.
 *
 * This module is the handoff: it takes the browser's cart and answers, through the
 * SDK's own rules, what a checkout would need and what it does not yet have. It runs
 * no payment and opens no invoice — the payment is a later increment, and this surface
 * says so by name rather than looking like a working checkout.
 *
 * ## The two SDK rules it composes
 *
 * - `resolveCheckoutDeliveryRequirements` — whether the cart's lines resolve to a
 *   delivery mode, and **which refs did not**. The cart's lines carry no shipping
 *   selection (the buy control does not ask for one), so every line reports the SDK's
 *   own `product:<id>:missing-shipping-method` sentinel.
 * - `findNextActionableInvoiceIndex` — the progress rule the checkout uses to pick the
 *   next invoice to settle. It is asked over an **empty** list, because no invoice has
 *   been raised, and it answers `-1`, which the surface renders as "no payment invoice
 *   is open".
 *
 * ## What changed when the shipping read landed (R2), and what did not
 *
 * `servicesByShippingRef` used to be empty **by construction**: a shipping ref's
 * *service* (`standard`, `pickup`, `digital`) lives in the kind-30406 record, and no
 * read model here read one — so a chosen ref could only ever resolve as unresolved.
 * The read exists now (`sdk/commerce/shipping/shippingRead.ts`) and
 * `instance/shippingSource.ts` composes it over the demo's own record, so the map is
 * passed in and is no longer empty. What has **not** changed is the refusal to infer:
 * this module still never reads a service out of the ref's last segment, and it still
 * only reports what the map answers.
 *
 * ## Placement
 *
 * `placeCheckout` assembles the input `sdk/commerce/orders/orderPlacement.ts` takes —
 * the intent, the host-owned order identity and resolved sats amount per seller, and
 * the shipping-service map — and hands the decision to
 * `placeBuyerOrdersFromCartIntent`. The module groups by the seller in each ref,
 * re-checks delivery through the module's own planner, builds each order through
 * `createBuyerOrderTemplate` and derives its status from the built event's own tags.
 * Nothing here builds an order event, and nothing here decides a status.
 *
 * **The order id is the host's, and this is where it is minted.** `orderPlacement.ts`
 * says the identity is host-owned and the SDK mints no ids; this instance has no keys,
 * so the id is a documented **non-cryptographic digest** of what the order is made of.
 * It is an address for a demo, not a security boundary, and `mintOrderId` says so.
 */

import { createCartIntent, isValidCartShippingRef, type PersistedCartContent } from '@sdk/commerce/cart'
import {
	findNextActionableInvoiceIndex,
	resolveCheckoutDeliveryRequirements,
	type CheckoutDeliveryRequirements,
	type CheckoutInvoiceStatus,
} from '@sdk/commerce/checkout'
import {
	parseCartProductRef,
	placeBuyerOrdersFromCartIntent,
	type BuyerOrderSellerTerms,
	type CartOrderPlacementOutcome,
} from '@sdk/commerce/orders/orderPlacement'

import type { Cart, CartLine } from './cartState'
import { satsValueOf, scaleAmount } from './cartTotals'
import type { ProductListItem } from './productListView'

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
	/**
	 * The shipping refs the cart's own lines carry that the instance's kind-30406 read
	 * did **not** resolve. Empty when no ref was chosen, which is a different state: a
	 * ref that is carried and unknown is a record nobody read, and the page says which.
	 */
	readonly shippingRefsWithoutRecord: readonly string[]
}

export interface CheckoutViewOptions {
	/** The clock the intent is stamped with. Injected, so a test reads no wall clock. */
	readonly updatedAtMs?: number
	/**
	 * The shipping-service map, as `instance/shippingSource.ts` read it from kind-30406.
	 * Passed in rather than assumed empty: an unresolved ref must be unresolved because
	 * no record resolved it, not because this module withheld the record it had.
	 */
	readonly servicesByShippingRef?: Readonly<Record<string, string | null | undefined>>
}

export function buildCheckoutView(cart: Cart, options: CheckoutViewOptions = {}): CheckoutView {
	const intent = createCartIntent(cart.lines, options.updatedAtMs ?? Date.now())

	const servicesByShippingRef = options.servicesByShippingRef ?? {}
	const requirements = resolveCheckoutDeliveryRequirements({
		products: cart.lines.map((line) => ({ id: line.id, shippingMethodId: line.shippingMethodId })),
		servicesByShippingRef,
	})

	// A ref the cart carries that the read did not resolve. Named, so "no shipping
	// method was chosen" and "the chosen method is not in the read" cannot read alike.
	const shippingRefsWithoutRecord: string[] = []
	for (const line of cart.lines) {
		const ref = line.shippingMethodId
		if (!ref) continue
		if (servicesByShippingRef[ref]) continue
		if (!shippingRefsWithoutRecord.includes(ref)) shippingRefsWithoutRecord.push(ref)
	}

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
		shippingRefsWithoutRecord,
	}
}

/**
 * The order id this instance mints for one seller's order.
 *
 * The SDK mints no ids — `orderPlacement.ts` says the identity is host-owned — and this
 * demo has no keys and must not acquire any, so the id is a **non-cryptographic
 * digest** (FNV-1a, 32 bits) of the things the order is made of: the seller, the
 * resolved sats amount, the intent's own `updatedAt` second, and every line the intent
 * carries. Two consequences, both stated rather than discovered:
 *
 * - it is **derived, not random**, so the same inputs yield the same id and a test can
 *   name it — which is what makes `/orders/<id>` an addressable page at all;
 * - it is an **address, not a proof**: 32 bits, no secret, no signature, and nothing
 *   about the order's authenticity follows from it. `PLACED_ORDER_PAYMENT_LIFECYCLE`
 *   is still `not-requested` and the event is still unsigned.
 */
export function mintOrderId(input: {
	readonly sellerPubkey: string
	readonly amountSats: number
	readonly intent: PersistedCartContent
}): string {
	const canonical = [
		input.sellerPubkey,
		String(input.amountSats),
		String(input.intent.updatedAt),
		...input.intent.items.map((item) => `${item.productRef}#${item.quantity}#${item.shippingRef ?? ''}`),
	].join('|')

	let hash = 0x811c9dc5
	for (let index = 0; index < canonical.length; index += 1) {
		hash ^= canonical.charCodeAt(index)
		hash = Math.imul(hash, 0x01000193) >>> 0
	}
	return `order-${hash.toString(16).padStart(8, '0')}`
}

/** One seller's order, as this checkout would place it. */
export interface SellerOrderTermsView {
	readonly sellerPubkey: string
	/** The lines the intent carries for this seller. */
	readonly lineCount: number
	readonly itemCount: number
	/** The resolved sats amount, or `null` when the read could not price every line. */
	readonly amountSats: number | null
	/** The id minted for this seller's order. Derived from the terms — see `mintOrderId`. */
	readonly orderId: string
	/** The shipping ref this seller's lines carry: the cart's own, or the checkout's choice. */
	readonly shippingRef: string | null
	/** The refs the read could not price. Named, never summed as zero. */
	readonly unpricedProductRefs: readonly string[]
}

/** The terms a placement is made of, before the module decides anything. */
export interface CheckoutTermsView {
	/** The SDK's own builder output, with the checkout's shipping choices applied. */
	readonly intent: PersistedCartContent
	readonly sellers: readonly SellerOrderTermsView[]
	/**
	 * Only the sellers the read priced. A seller left out is refused by the module
	 * itself, by name (`unresolved-sats-price`), rather than placed at a wrong amount.
	 */
	readonly sellerTerms: Readonly<Record<string, BuyerOrderSellerTerms>>
}

export interface CheckoutTermsOptions {
	/**
	 * The shipping ref the checkout chose for a seller, keyed by the seller's 64-hex
	 * pubkey. The cart's **own** persisted selection wins where it has one; this is what
	 * the checkout adds where the cart carries none.
	 */
	readonly shippingBySeller?: Readonly<Record<string, string | null | undefined>>
	/** The listing read, for pricing each line in sats. */
	readonly items: readonly ProductListItem[]
	readonly createdAtMs: number
}

/**
 * Build the terms: the intent the checkout would submit, and one seller's order per
 * seller the intent carries.
 *
 * The grouping key is the module's **own** ref parser (`parseCartProductRef`), not a
 * second reading of the ref, so this module's groups are the groups
 * `placeBuyerOrdersFromCartIntent` will make. A line the read cannot price makes its
 * seller's amount `null`, which is why that seller is left out of `sellerTerms`.
 */
export function buildCheckoutTerms(cart: Cart, options: CheckoutTermsOptions): CheckoutTermsView {
	const shippingBySeller = options.shippingBySeller ?? {}

	const lines: CartLine[] = cart.lines.map((line) => ({
		...line,
		shippingMethodId: line.shippingMethodId ?? shippingBySeller[line.sellerPubkey] ?? null,
	}))

	const intent = createCartIntent(lines, options.createdAtMs)

	const priceByCoordinates = new Map<string, ProductListItem>()
	for (const item of options.items) priceByCoordinates.set(item.coordinates, item)

	interface Accumulator {
		readonly productRefs: string[]
		lineCount: number
		itemCount: number
		sum: number
		readonly unpriced: string[]
		shippingRef: string | null
	}

	const bySeller = new Map<string, Accumulator>()
	for (const item of intent.items) {
		const parsed = parseCartProductRef(item.productRef)
		if (!parsed) continue

		const accumulator: Accumulator = bySeller.get(parsed.sellerPubkey) ?? {
			productRefs: [],
			lineCount: 0,
			itemCount: 0,
			sum: 0,
			unpriced: [],
			shippingRef: null,
		}

		const listing = priceByCoordinates.get(item.productRef)
		const lineSats = listing?.price
			? satsValueOf(scaleAmount(listing.price.amount, item.quantity) ?? '0', listing.price.currency)
			: null
		if (lineSats === null) accumulator.unpriced.push(item.productRef)
		else accumulator.sum += lineSats

		accumulator.productRefs.push(item.productRef)
		accumulator.lineCount += 1
		accumulator.itemCount += item.quantity
		accumulator.shippingRef = accumulator.shippingRef ?? item.shippingRef ?? null
		bySeller.set(parsed.sellerPubkey, accumulator)
	}

	const sellers: SellerOrderTermsView[] = []
	const sellerTerms: Record<string, BuyerOrderSellerTerms> = {}

	for (const [sellerPubkey, accumulator] of bySeller) {
		const amountSats = accumulator.unpriced.length === 0 ? accumulator.sum : null
		const orderId = mintOrderId({ sellerPubkey, amountSats: amountSats ?? 0, intent })

		sellers.push({
			sellerPubkey,
			lineCount: accumulator.lineCount,
			itemCount: accumulator.itemCount,
			amountSats,
			orderId,
			shippingRef: accumulator.shippingRef,
			unpricedProductRefs: Object.freeze([...accumulator.unpriced]),
		})

		// A seller the read did not price is **left out**, not placed at zero: the
		// module then refuses by name.
		if (amountSats !== null) sellerTerms[sellerPubkey] = { orderId, amountSats }
	}

	// A stable order, so a page and a test read the same sequence twice.
	sellers.sort((left, right) => (left.sellerPubkey < right.sellerPubkey ? -1 : 1))

	return { intent, sellers, sellerTerms: Object.freeze(sellerTerms) }
}

export interface CheckoutPlacementOptions extends CheckoutTermsOptions {
	readonly servicesByShippingRef?: Readonly<Record<string, string | null | undefined>>
}

/** One placement attempt: the terms it was made of, and the module's own answer. */
export interface CheckoutPlacementAttempt {
	readonly terms: CheckoutTermsView
	readonly outcome: CartOrderPlacementOutcome
}

/**
 * **Place this cart's orders**, through the module that owns placement.
 *
 * Nothing is invented here: the input is the SDK's own builder output, the seller
 * terms this instance resolved, and the shipping-service map this instance read. The
 * answer — `placed` with the orders, or `refused` naming the gap — is the module's.
 */
export function placeCheckout(cart: Cart, options: CheckoutPlacementOptions): CheckoutPlacementAttempt {
	const terms = buildCheckoutTerms(cart, options)

	const outcome = placeBuyerOrdersFromCartIntent({
		intent: terms.intent,
		sellerTerms: terms.sellerTerms,
		servicesByShippingRef: options.servicesByShippingRef ?? {},
		createdAt: terms.intent.updatedAt,
	})

	return { terms, outcome }
}

/** One seller's shipping choices, as the checkout offers them. */
export interface SellerShippingChoice {
	readonly sellerPubkey: string
	/** The seller's own published refs, joined to the kind-30406 read. */
	readonly options: readonly {
		readonly ref: string
		readonly optionId: string
		readonly known: boolean
		readonly service: string | null
		readonly title: string | null
		readonly price: { readonly amount: string; readonly unit: string } | null
		readonly taggedAmount: string | null
		readonly refusal: string | null
	}[]
	/** The cart's own persisted selection, when it carries one. */
	readonly chosen: string | null
}

/**
 * The shipping choices the checkout must offer: one per seller the cart holds, drawn
 * from **that seller's own published refs** and resolved through the read.
 *
 * This is not an inference and not a default: it is the set of refs a seller published,
 * and the shopper picks one. Where the read resolved no option, `options` is empty and
 * the surface says the delivery cannot be resolved — rather than offering the ref's
 * text as if it were the record.
 */
export function shippingChoicesForCart(
	cart: Cart,
	shipping: { readonly optionsBySeller: Readonly<Record<string, readonly SellerShippingChoice['options'][number][]>> },
): readonly SellerShippingChoice[] {
	const chosen = new Map<string, string>()
	for (const line of cart.lines) chosen.set(line.sellerPubkey, line.shippingMethodId ?? '')

	const seen = new Set<string>()
	const choices: SellerShippingChoice[] = []
	for (const line of cart.lines) {
		if (seen.has(line.sellerPubkey)) continue
		seen.add(line.sellerPubkey)
		choices.push({
			sellerPubkey: line.sellerPubkey,
			options: shipping.optionsBySeller[line.sellerPubkey] ?? [],
			chosen: chosen.get(line.sellerPubkey) || null,
		})
	}
	choices.sort((left, right) => (left.sellerPubkey < right.sellerPubkey ? -1 : 1))
	return choices
}

/** Form field names and the submission shape the checkout and the server share. */

/** The form field a shipping choice travels in: `shipping:<seller pubkey>`. */
export const SHIPPING_CHOICE_FIELD_PREFIX = 'shipping:'

/** The form field the browser's cart record travels in. */
export const CART_FIELD_NAME = 'cart'

/** Whether a posted shipping value is a shipping ref the cart's own grammar accepts. */
export function isChosenShippingRef(value: string | null | undefined): boolean {
	return typeof value === 'string' && isValidCartShippingRef(value)
}

/**
 * The answer the instance gives a placement attempt, as the checkout page renders it.
 *
 * Two kinds, because they are two different facts and the page must not blur them: the
 * **module refused** the attempt (`placement`, carrying the module's own outcome), or the
 * **instance could not read** the record it was sent (`unreadable-cart` — the SDK's parser
 * refused the bytes, and no placement was attempted at all).
 */
export type CheckoutSubmission =
	| { readonly kind: 'placement'; readonly outcome: CartOrderPlacementOutcome; readonly terms: CheckoutTermsView }
	| { readonly kind: 'unreadable-cart' }
