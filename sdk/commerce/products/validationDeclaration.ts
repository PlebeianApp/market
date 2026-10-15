/**
 * products/validationDeclaration.ts — this module's declaration (`design.md` §4.1).
 *
 * `products` owns kind 30402 (the NIP-99 listing) — its `source` is the repository's own listing parser,
 * `src/lib/schemas/productListing.ts`, which IS the single definition of valid for the kind (`design.md`
 * §4.2b, `auctionAdmission.ts:15-20`). `checks: []` is a declared "demands nothing yet"; the rule
 * inventory that fills it is a sibling increment's deliverable.
 */
import type { CommerceValidationDeclaration } from '../../core/composition/ts/index'

/** The NIP-99 listing kind — the module's own wire shape (`productListingWorkflow.ts:40,89`). */
const PRODUCT_LISTING_KIND = 30402

export const validationDeclaration: CommerceValidationDeclaration = {
	owner: 'commerce.products',
	kinds: [
		{
			kind: PRODUCT_LISTING_KIND,
			source: 'src/lib/schemas/productListing.ts',
			parser: 'src/lib/schemas/productListing.ts#ProductListingSchema',
			checks: [],
		},
	],
	contributions: [],
	accepts: [],
}
