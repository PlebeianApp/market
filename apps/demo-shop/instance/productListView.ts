/**
 * instance/productListView.ts — the read composition.
 *
 * This is the rung the increment is about: the app does not re-implement any
 * product rule. It hands admitted kind-30402 events to the SDK's discovery
 * module and renders what comes back.
 *
 * What the SDK decides (so the app cannot disagree with the rest of the product):
 * - `filterAndSortProductSearchResults` — the search page's exclusion-term and
 *   date-ordering behaviour.
 * - `getProductId` / `getProductCoordinates` — the addressable `d`-tag identity.
 * - `getProductTitle` / `getProductSummary` / `getProductImages` /
 *   `getProductCategories` / `getProductPubkey` — the read model's accessors.
 * - `getProductVisibility` — whether a listing is on sale at all.
 * - `isProductInStock` — the discovery availability rule (and notably `pre-order`
 *   counts as available, while a listing with no `stock` tag does not).
 *
 * What the app decides, because presentation is the app's and not the SDK's:
 * how a price tag and a stock count read to a person, and which rows a shopper's
 * product list shows.
 */

import {
	filterAndSortProductSearchResults,
	getProductCategories,
	getProductCoordinates,
	getProductId,
	getProductImages,
	getProductPubkey,
	getProductPrice,
	getProductStock,
	getProductSummary,
	getProductTitle,
	getProductVisibility,
	isProductInStock,
	type ProductReadEvent,
	type ProductSearchSort,
} from '@sdk/commerce/discovery'

/** A price as the page shows it. */
export interface ProductPriceView {
	/** The amount exactly as the listing tagged it. */
	readonly amount: string
	/** The currency exactly as the listing tagged it. */
	readonly currency: string
	/** The same amount, formatted for display. */
	readonly display: string
}

/** One row of the product list. Every field traces back to an SDK accessor. */
export interface ProductListItem {
	readonly id: string
	readonly coordinates: string
	readonly title: string
	readonly summary: string
	readonly price: ProductPriceView | null
	readonly inStock: boolean
	readonly stock: number | null
	readonly visibility: string
	readonly categories: readonly string[]
	readonly imageUrl: string | null
	readonly sellerPubkey: string
}

export interface ProductListView {
	/** The listings a shopper may see, newest first. */
	readonly items: readonly ProductListItem[]
	/** How many admitted listings the list dropped because they are not on sale. */
	readonly hiddenCount: number
	/** A one-line statement of what the list is, for the page to render as its own text. */
	readonly summaryLine: string
}

export interface ProductListViewOptions {
	/** Exclusion terms, passed straight to the SDK's search filter. */
	exclude?: string
	sort?: ProductSearchSort
}

/** Group the integer part of a decimal string by thousands, deterministically. */
function groupThousands(amount: string): string {
	const [whole, fraction] = amount.split('.')
	const grouped = (whole ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, ',')
	return fraction === undefined ? grouped : `${grouped}.${fraction}`
}

/** Render one price tag for display. Never invents a currency or a rounding. */
export function formatProductPrice(amount: string, currency: string): string {
	if (!Number.isFinite(Number(amount))) return `${amount} ${currency}`
	return `${groupThousands(amount)} ${currency}`
}

/** Read a listing's price tag into a displayable price, or `null` when it has none. */
export function resolveProductPrice(event: ProductReadEvent): ProductPriceView | null {
	const tag = getProductPrice(event)
	const amount = tag?.[1]
	const currency = tag?.[2]
	if (!amount || !currency) return null
	return { amount, currency, display: formatProductPrice(amount, currency) }
}

function toItem(event: ProductReadEvent): ProductListItem {
	const stockTag = getProductStock(event)
	const stock = stockTag ? Number.parseInt(stockTag[1] ?? '', 10) : Number.NaN
	const image = getProductImages(event)[0]

	return {
		id: getProductId(event),
		coordinates: getProductCoordinates(event),
		title: getProductTitle(event),
		summary: getProductSummary(event),
		price: resolveProductPrice(event),
		inStock: isProductInStock(event),
		stock: Number.isNaN(stock) ? null : stock,
		visibility: getProductVisibility(event)?.[1] ?? 'on-sale',
		categories: getProductCategories(event).map((tag) => tag[1] ?? '').filter((name) => name.length > 0),
		imageUrl: image?.[1] ?? null,
		sellerPubkey: getProductPubkey(event),
	}
}

/**
 * Build the product list from admitted listings.
 *
 * Ordering and exclusion are the SDK's; the only rule this function adds is the
 * one AGENTS.md already states for discovery surfaces — a listing that is not on
 * sale is not a row — and it reports the drops rather than hiding them.
 */
export function buildProductListView(
	events: readonly ProductReadEvent[],
	options: ProductListViewOptions = {},
): ProductListView {
	// `ProductReadEvent.content` is optional while the search filter's
	// `ProductSearchEvent.content` is required — the two SDK read-model types
	// disagree about that one field. Admission already guarantees a string (the
	// listing parser requires `content`), so the app supplies the default here
	// rather than editing either SDK type.
	const searchable = [...events].map((event) => ({ ...event, content: event.content ?? '' }))
	const ordered = filterAndSortProductSearchResults(searchable, {
		exclude: options.exclude,
		sort: options.sort ?? 'newest',
	})

	const items: ProductListItem[] = []
	let hiddenCount = 0
	for (const event of ordered) {
		if (getProductVisibility(event)?.[1] === 'hidden') {
			hiddenCount += 1
			continue
		}
		items.push(toItem(event))
	}

	const hidden = hiddenCount > 0 ? ` · ${hiddenCount} not on sale` : ''
	return {
		items,
		hiddenCount,
		summaryLine: `${items.length} listing${items.length === 1 ? '' : 's'}${hidden}`,
	}
}