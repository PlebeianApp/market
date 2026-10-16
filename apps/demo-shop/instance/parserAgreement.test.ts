/**
 * parserAgreement.test.ts — the instance's catalog against the repository's own
 * definition of a valid kind-30402 listing.
 *
 * Two claims, and they are different claims:
 *
 * 1. **The instance is clean.** Every listing this instance ships is admitted by
 *    the parser its own surfaces apply, so nothing on the page is something the
 *    repository would reject. The mutation that turns this red: add a listing to
 *    `DEMO_LISTINGS` with a 4-letter currency, or drop its `price` tag.
 *
 * 2. **The notation the two sides now agree on is pinned here.** This case used to
 *    be a *known defect*: `productPriceResolution.ts` resolved a sats-denominated
 *    price to `currency: 'SATS'`, `productListingWorkflow.ts` wrote that verbatim
 *    into `['price', amount, currency]`, and `src/lib/schemas/common.ts`'s
 *    `iso4217Currency` is `/^[A-Z]{3}$/` — four letters cannot match, so the SDK's
 *    write side emitted a price tag its own cited parser refused.
 *
 *    `commerce/money-truth` (M3, "one currency notation — emit SAT, accept both")
 *    reconciled it on the SDK side: `products/currencyNotation.ts#normalizeCurrency`
 *    emits the three-letter `SAT` and still accepts `SATS`, `sat` and `sats` on
 *    read, so an already-published four-letter listing keeps resolving. The
 *    disagreement this file used to assert **no longer exists on the merged line**,
 *    which is why the assertions below are the opposite of the ones it carried:
 *    that is the change, and it is asserted rather than deleted.
 *
 *    What still holds, and is the arm worth keeping: the parser's rule itself is
 *    unchanged, so a four-letter spelling that reaches the parser **unnormalised**
 *    is still refused — on the price tag, at `['tags', 2]`.
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

describe('the merged notation — the SDK emits SAT, and the parser admits it', () => {
	test('SATS is a four-letter spelling the parser refuses, and the SDK no longer emits it', () => {
		// The parser's rule, on its own — unchanged by the reconciliation:
		expect(iso4217Currency.safeParse('SATS').success).toBe(false)
		expect(iso4217Currency.safeParse('BTC').success).toBe(true)
		// …and the three-letter spelling the SDK emits, which the rule admits:
		expect(iso4217Currency.safeParse('SAT').success).toBe(true)

		// …and what the SDK now writes into the price tag for a SATS-denominated
		// input: the two sides' notation, reconciled.
		const event = asPublished(satsListing, 'coat')
		expect(event.tags[2]).toEqual(['price', '1200', 'SAT'])
	})

	test('a SATS-authored listing is admitted, because the normaliser makes it a SAT tag', () => {
		const satsEvent = asPublished(satsListing, 'coat')

		// The opposite of what this case asserted before the merge: the SDK's
		// write side no longer emits a tag its own cited parser refuses.
		expect(ProductListingSchema.safeParse(satsEvent).success).toBe(true)
		expect(admitProductListing(satsEvent)).not.toBeNull()
	})

	test('the four-letter spelling is still refused when it reaches the parser unnormalised', () => {
		const event = asPublished(satsListing, 'coat')
		const unnormalised = {
			...event,
			tags: event.tags.map((tag) => (tag[0] === 'price' ? ['price', '1200', 'SATS'] : tag)),
		}
		const result = ProductListingSchema.safeParse(unnormalised)

		expect(result.success).toBe(false)
		if (result.success) return
		// The locus, not just the verdict: tags[2] is the price tag — which is why
		// the normalisation has to happen on the write side, before the tag exists.
		expect(result.error.issues[0]?.path).toEqual(['tags', 2])
		expect(admitProductListing(unnormalised)).toBeNull()
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