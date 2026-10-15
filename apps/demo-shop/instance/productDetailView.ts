/**
 * instance/productDetailView.ts — one listing, by address.
 *
 * The detail is the *same read* as the list: admitted kind-30402 events, resolved
 * through the SDK's discovery accessors. It adds no commerce rule and no second
 * definition of a product — what it adds is the fields a single listing's page
 * needs and a row does not (the description, the specs, the published image).
 *
 * **One read, one answer, no asymmetry.** The list and the detail both resolve
 * against the instance's single boot read, so a listing cannot appear in the list
 * and then refuse to open — the defect a boot snapshot on one route and a live
 * re-read on the other produces, and it always breaks the newest listing, which
 * is the one a person is testing.
 *
 * A listing that does not resolve gets a **named reason**, never an empty page:
 * `not-admitted` is a listing this instance's admission edge refused (or one that
 * was never in the read at all), `not-on-sale` is a listing the read model calls
 * hidden — the same rule the list applies when it drops a row.
 */

import {
	getProductCoordinates,
	getProductDescription,
	getProductImages,
	getProductShippingOptions,
	getProductSpecs,
	getProductVisibility,
	type ProductReadEvent,
} from '@sdk/commerce/discovery'

import { buildProductListView, type ProductListItem } from './productListView'

/** One `spec` tag of a listing, as the SDK's read model hands it over. */
export interface ProductSpecView {
	readonly key: string
	readonly value: string
}

/**
 * One `shipping_option` tag of a listing.
 *
 * The tag is `['shipping_option', <30406 ref>, <amount>]`. The SDK's read model
 * exposes the tag and nothing else about shipping: there is no shipping *record*
 * in the read (the service, the currency and the destination live in the kind-30406
 * event, which this app does not read). So the amount is reported exactly as the
 * listing tagged it and is **not** given a unit it was not tagged with.
 */
export interface ProductShippingView {
	readonly ref: string
	readonly amount: string
}

export interface ProductDetailView {
	readonly item: ProductListItem
	readonly description: string
	readonly imageUrl: string | null
	readonly specs: readonly ProductSpecView[]
	readonly shipping: readonly ProductShippingView[]
}

export type ProductDetailLookup =
	| { readonly found: true; readonly detail: ProductDetailView }
	| { readonly found: false; readonly reason: 'not-admitted' | 'not-on-sale' }

/**
 * The page a product address resolves to when no listing does — a **named
 * state**, not an empty region. `not-admitted` is "this instance's admission
 * edge never let that listing through (or the read never carried it)";
 * `not-on-sale` is "the listing is hidden". A person who follows a stale link
 * gets one of these two sentences rather than a page that looks broken.
 */
export interface ProductMissingView {
	readonly coordinates: string
	readonly reason: 'not-admitted' | 'not-on-sale'
}

function toDetail(event: ProductReadEvent, item: ProductListItem): ProductDetailView {
	const specs: ProductSpecView[] = []
	for (const tag of getProductSpecs(event)) {
		const key = tag[1]
		if (!key) continue
		specs.push({ key, value: tag[2] ?? '' })
	}

	const shipping: ProductShippingView[] = []
	for (const tag of getProductShippingOptions(event)) {
		const ref = tag[1]
		if (!ref) continue
		shipping.push({ ref, amount: tag[2] ?? '' })
	}

	return {
		item,
		description: getProductDescription(event),
		imageUrl: getProductImages(event)[0]?.[1] ?? null,
		specs,
		shipping,
	}
}

/**
 * Resolve one listing by its coordinates.
 *
 * The item is built by the list's own read composition (`buildProductListView`)
 * over the single matching event, so the detail's identity, price, availability
 * and categories come out of exactly the code the row's do and cannot disagree
 * with the list a person just clicked from.
 */
export function findProductDetail(
	events: readonly ProductReadEvent[],
	coordinates: string,
): ProductDetailLookup {
	const event = events.find((candidate) => getProductCoordinates(candidate) === coordinates)
	if (!event) return { found: false, reason: 'not-admitted' }
	if (getProductVisibility(event)?.[1] === 'hidden') return { found: false, reason: 'not-on-sale' }

	// The same read composition the list uses, so the detail cannot grow its own
	// opinion of what a product is. An empty result here would mean the two
	// disagree, which the `not-admitted` branch above has already excluded.
	const item = buildProductListView([event]).items[0]
	if (!item) return { found: false, reason: 'not-admitted' }

	return { found: true, detail: toDetail(event, item) }
}
