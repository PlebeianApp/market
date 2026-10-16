/**
 * instance/catalog.ts — the demo instance's product data, **authored by the SDK**.
 *
 * A product in this repository is a NIP-99 kind-30402 addressable event. Rather
 * than hand-writing tag arrays here (which would prove nothing about the SDK),
 * this file states seller listing *inputs* and lets the SDK's own commerce
 * module build the event data: `buildSellerProductEventData` from
 * `sdk/commerce/products/productListingWorkflow.ts`.
 *
 * **Why the prices here are denominated in `BTC`.** Every event below is run
 * through the repository's kind-30402 parser (`instance/productAdmission.ts`)
 * before it can become a row, and that parser requires the `price` tag's
 * currency to match `/^[A-Z]{3}$/`. At the time this catalog was authored the
 * SDK's own price resolution emitted the four-letter `SATS`
 * (`products/productPriceResolution.ts`), which that rule rejects — so a
 * `SATS`-denominated listing could not be rendered by this instance at all.
 * `commerce/money-truth` (M3) reconciled the notation on the SDK side
 * (`products/currencyNotation.ts#normalizeCurrency` emits the three-letter
 * `SAT` and still accepts `SATS`, `sat` and `sats` on read), so the two sides now
 * agree; the catalog stays `BTC` because nothing about this instance's data needs
 * to move for a notation fix, and `instance/parserAgreement.test.ts` pins both the
 * agreement and the four-letter spelling the parser still refuses.
 *
 * The two fields the SDK deliberately does not invent are supplied by the host,
 * because issuing them is a host responsibility: the seller `pubkey` and
 * `created_at`. So the data below is real commerce data that round-trips
 * through the SDK's write side and is then read back by the SDK's read side.
 */

// Note: imported from the module by name, not from the `@sdk/commerce` barrel.
// The barrel's index re-exports `./messaging`, whose `nip17Order*` modules import
// `sdk/core/dm/ts/index.ts`, whose `adapter.ts` imports `applesauce-common` — a
// package that is absent from the root `package.json` and from `bun.lock`. The
// barrel therefore cannot be imported at all in a clean checkout. Composing the
// two modules this instance actually uses sidesteps that, and is the narrower
// dependency anyway. (Reported as a named need.)
import { buildSellerProductEventData, type SellerProductListingInput } from '@sdk/commerce/products'
import type { ProductReadEvent } from '@sdk/commerce/discovery'

/** A demo seller identity. Not a key — no secret material exists in this file. */
export const DEMO_SELLER_PUBKEY = '7e7c3b5a1f4d2e6c8a9b0d3e5f7a1c2b4d6e8f0a1b3c5d7e9f1a2b4c6d8e0f12'

/** One listing input, plus the two fields the host issues rather than the SDK. */
export interface DemoListing {
	readonly productId: string
	readonly createdAt: number
	readonly listing: SellerProductListingInput
}

/**
 * The demo seller's shipping option id, and the `30406` **ref** every listing of
 * theirs publishes — one definition, because `instance/shippingSource.ts` states the
 * kind-30406 record that ref has to resolve *under*, and the two spelling it separately
 * is how a listing ends up naming shipping nobody offers.
 */
export const DEMO_SHIPPING_OPTION_ID = 'standard'
export const DEMO_SHIPPING_REF = `30406:${DEMO_SELLER_PUBKEY}:${DEMO_SHIPPING_OPTION_ID}`

/** The amount the listing's own `shipping_option` tag carries, and the record's `price` amount. */
export const DEMO_SHIPPING_AMOUNT = '250'

/** The unit only the kind-30406 record declares for that amount: the SDK's three-letter `SAT`. */
export const DEMO_SHIPPING_CURRENCY = 'SAT'

const shipping = [{ shippingRef: DEMO_SHIPPING_REF, extraCost: DEMO_SHIPPING_AMOUNT }]

/**
 * Six listings across five categories, with deliberately varied stock and
 * visibility so the rendered list exercises the read model's branches: an
 * in-stock item, an out-of-stock item, a pre-order item, and an item whose
 * stock tag is absent entirely.
 */
export const DEMO_LISTINGS: readonly DemoListing[] = [
	{
		productId: 'wool-coat',
		createdAt: 1_760_000_600,
		listing: {
			name: 'Merino Wool Coat',
			summary: 'Hand-finished, unlined, made to last a decade',
			description: 'A heavy merino coat cut for cold mornings. Made by a single atelier.',
			price: '0.00000099',
			quantity: '3',
			currency: 'BTC',
			status: 'on-sale',
			productType: 'single',
			mainCategory: 'clothing',
			selectedCollection: null,
			categories: [
				{ key: 'outerwear', name: 'outerwear', checked: true },
				{ key: 'unchecked', name: 'ignored', checked: false },
			],
			images: [{ imageUrl: 'https://example.test/merino-coat.png', imageOrder: 0 }],
			specs: [{ key: 'size', value: 'M' }],
			shippings: shipping,
			weight: { value: '1.4', unit: 'kg' },
			dimensions: null,
			isNSFW: false,
		},
	},
	{
		productId: 'cast-iron-pan',
		createdAt: 1_760_000_500,
		listing: {
			name: 'Cast Iron Skillet',
			summary: 'Pre-seasoned, 12 inch',
			description: 'A skillet that will outlive its buyer.',
			price: '0.00000045',
			quantity: '12',
			currency: 'BTC',
			status: 'on-sale',
			productType: 'single',
			mainCategory: 'home',
			selectedCollection: null,
			categories: [{ key: 'kitchen', name: 'kitchen', checked: true }],
			images: [{ imageUrl: 'https://example.test/skillet.png', imageOrder: 0 }],
			specs: [],
			shippings: shipping,
			weight: { value: '2.6', unit: 'kg' },
			dimensions: { value: '30x30x5', unit: 'cm' },
			isNSFW: false,
		},
	},
	{
		productId: 'linen-shirt',
		createdAt: 1_760_000_400,
		listing: {
			name: 'Linen Shirt',
			summary: 'Breathable summer cut',
			description: 'Washed linen, buttons in corozo.',
			price: '0.00000062',
			quantity: '0',
			currency: 'BTC',
			status: 'on-sale',
			productType: 'single',
			mainCategory: 'clothing',
			selectedCollection: null,
			categories: [{ key: 'shirts', name: 'shirts', checked: true }],
			images: [{ imageUrl: 'https://example.test/linen-shirt.png', imageOrder: 0 }],
			specs: [{ key: 'size', value: 'L' }],
			shippings: shipping,
			weight: null,
			dimensions: null,
			isNSFW: false,
		},
	},
	{
		productId: 'ceramic-mug',
		createdAt: 1_760_000_300,
		listing: {
			name: 'Ceramic Mug',
			summary: 'Wheel-thrown, glazed in ash',
			description: 'One mug, 300ml, thrown on a kick wheel.',
			price: '0.00000018',
			quantity: '25',
			currency: 'BTC',
			status: 'pre-order',
			productType: 'single',
			mainCategory: 'home',
			selectedCollection: null,
			categories: [],
			images: [{ imageUrl: 'https://example.test/mug.png', imageOrder: 0 }],
			specs: [],
			shippings: shipping,
			weight: null,
			dimensions: null,
			isNSFW: false,
		},
	},
	{
		productId: 'field-notebook',
		createdAt: 1_760_000_200,
		listing: {
			name: 'Field Notebook',
			summary: 'Dot grid, 96 pages',
			description: 'Thread-bound, lies flat, takes ink.',
			price: '0.00000009',
			quantity: '40',
			currency: 'BTC',
			status: 'on-sale',
			productType: 'single',
			mainCategory: 'stationery',
			selectedCollection: null,
			categories: [{ key: 'paper', name: 'paper', checked: true }],
			images: [{ imageUrl: 'https://example.test/notebook.png', imageOrder: 0 }],
			specs: [],
			shippings: shipping,
			weight: null,
			dimensions: null,
			isNSFW: false,
		},
	},
	{
		productId: 'hidden-draft',
		createdAt: 1_760_000_100,
		listing: {
			name: 'Hidden Draft',
			summary: 'Not for sale yet',
			description: 'A listing that is not on sale.',
			price: '0.00000001',
			quantity: '5',
			currency: 'BTC',
			status: 'hidden',
			productType: 'single',
			mainCategory: 'misc',
			selectedCollection: null,
			categories: [],
			images: [{ imageUrl: 'https://example.test/draft.png', imageOrder: 0 }],
			specs: [],
			shippings: shipping,
			weight: null,
			dimensions: null,
			isNSFW: false,
		},
	},
]

/**
 * Build the instance's catalog as real kind-30402 events.
 *
 * The event data comes from the SDK's listing workflow; the host adds the seller
 * pubkey and the publication time it owns. Nothing here signs or publishes.
 */
export function buildCatalogEvents(
	listings: readonly DemoListing[] = DEMO_LISTINGS,
	sellerPubkey: string = DEMO_SELLER_PUBKEY,
): ProductReadEvent[] {
	return listings.map(({ productId, createdAt, listing }) => ({
		...buildSellerProductEventData(listing, productId),
		pubkey: sellerPubkey,
		created_at: createdAt,
	}))
}