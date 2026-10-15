/**
 * parserAgreement.test.ts — the instance's catalog against the repository's own
 * definition of a valid kind-30402 listing.
 *
 * Two claims, and they are different claims:
 *
 * 1. **The instance is clean.** Every listing this instance ships is admitted by
 *    the parser its own surfaces apply, so nothing on the page is something the
 *    repository would reject. The mutation that turns this red: add a listing to
 *    `DEMO_LISTINGS` with a `SATS` price, or with a 4-letter currency, or drop
 *    its `price` tag.
 *
 * 2. **The SDK is not clean, and this case pins where.** This is a *known-defect*
 *    case, not an aspiration: it asserts the disagreement that exists today, with
 *    its locus. If someone reconciles the two definitions, this case fails and
 *    that failure is the signal to delete it — which is exactly why the assertion
 *    is written against the *locus* (`['tags', 2]`) and not just against `false`.
 *
 * The disagreement, verified: `sdk/commerce/products/productPriceResolution.ts`
 * resolves a sats-denominated price to `currency: 'SATS'`, and
 * `productListingWorkflow.ts` writes that verbatim into `['price', amount,
 * currency]`. `src/lib/schemas/common.ts`'s `iso4217Currency` is
 * `/^[A-Z]{3}$/` — four letters cannot match. So the SDK's write side emits a
 * price tag that the parser its own `validationDeclaration` names as the kind's
 * single definition of valid cannot read.
 */

import { describe, expect, test } from 'bun:test'

import { buildSellerProductEventData, type SellerProductListingInput } from '@sdk/commerce/products'
import { iso4217Currency } from '@/lib/schemas/common'
import { ProductListingSchema } from '@/lib/schemas/productListing'

import { buildCatalogEvents, DEMO_SELLER_PUBKEY } from './catalog'
import { admitProductListing } from './productAdmission'

const satsListing: SellerProductListingInput = {
	name: 'Coat',
	summary: 'Warm',
	description: 'A warm coat',
	price: '1200',
	quantity: '4',
	currency: 'SATS',
	status: 'on-sale',
	productType: 'single',
	mainCategory: 'clothing',
	selectedCollection: null,
	categories: [],
	images: [],
	specs: [],
	shippings: [],
	weight: null,
	dimensions: null,
	isNSFW: false,
}

function asPublished(input: SellerProductListingInput, productId: string) {
	return { ...buildSellerProductEventData(input, productId), pubkey: DEMO_SELLER_PUBKEY, created_at: 1_760_000_000 }
}

describe('the instance catalog is admitted by the repository kind-30402 parser', () => {
	test('every shipped listing survives admission, and the count is not zero', () => {
		const events = buildCatalogEvents()

		expect(events.length).toBeGreaterThan(0)
		const admitted = events.map(admitProductListing).filter((item) => item !== null)
		expect(admitted).toHaveLength(events.length)
	})

	test('admission returns the SDK read model shape, not the raw event', () => {
		const item = admitProductListing(buildCatalogEvents()[0])

		expect(item).not.toBeNull()
		expect(typeof item?.pubkey).toBe('string')
		expect(item?.tags.some((tag) => tag[0] === 'price')).toBe(true)
	})
})

describe('KNOWN DEFECT — the SDK emits a price currency the parser rejects', () => {
	test('SATS is the SDK’s own price currency and is not an admitted one', () => {
		// The parser's rule, on its own:
		expect(iso4217Currency.safeParse('SATS').success).toBe(false)
		expect(iso4217Currency.safeParse('BTC').success).toBe(true)

		// …and what the SDK writes into the price tag:
		const event = asPublished(satsListing, 'coat')
		expect(event.tags[2]).toEqual(['price', '1200', 'SATS'])
	})

	test('the rejection lands on the price tag, and an admitted currency clears it', () => {
		const satsEvent = asPublished(satsListing, 'coat')
		const satsResult = ProductListingSchema.safeParse(satsEvent)
		expect(satsResult.success).toBe(false)
		if (satsResult.success) return
		// The locus, not just the verdict: tags[2] is the price tag.
		expect(satsResult.error.issues[0]?.path).toEqual(['tags', 2])

		// The same listing, same everything, with a three-letter currency:
		const btcEvent = asPublished({ ...satsListing, price: '0.000012', currency: 'BTC' }, 'coat')
		expect(ProductListingSchema.safeParse(btcEvent).success).toBe(true)
		expect(admitProductListing(btcEvent)).not.toBeNull()
	})

	test('admission rejects a listing with no price tag rather than inventing one', () => {
		const event = asPublished(satsListing, 'coat')
		const withoutPrice = { ...event, tags: event.tags.filter((tag) => tag[0] !== 'price') }

		expect(admitProductListing(withoutPrice)).toBeNull()
	})

	test('admission rejects a non-listing event and a listing with no title', () => {
		const event = asPublished(satsListing, 'coat')

		expect(admitProductListing({ kind: 1, content: 'a note', tags: [], created_at: 1 })).toBeNull()
		expect(admitProductListing({ ...event, tags: event.tags.filter((tag) => tag[0] !== 'title') })).toBeNull()
		expect(admitProductListing(null)).toBeNull()
	})
})