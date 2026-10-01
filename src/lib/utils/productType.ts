export type ProductFormType = 'single' | 'variable'
export type ProductFormat = 'digital' | 'physical'

/**
 * Type-related tags the form does not edit but must not lose on republish.
 *
 * - `preservedTypeTag: null` — the original listing had no `type` tag; keep it absent instead of
 *   inventing `simple`/`physical`.
 * - `preservedTypeTag: [...]` — the original was a `variation` child; keep its `type` tag verbatim.
 * - `preservedParentTag` — a `variation` child's `a` tag pointing at its parent listing.
 *
 * A `variation` child without a valid parent reference gets no `preservedParentTag`;
 * `assertVariationHasParent` then blocks republishing it rather than orphaning it.
 *
 * Anything else leaves both unset and the tag is rebuilt from the form's type and format.
 */
// `30402:<parent pubkey>:<parent d tag>`
const VARIATION_PARENT_REF = /^30402:[0-9a-f]{64}:.+$/

export interface PreservedTypeTags {
	preservedTypeTag?: string[] | null
	preservedParentTag?: string[]
}

/**
 * Maps a listing's tags to the product form's type and format, plus the type tags that
 * must be republished unchanged.
 *
 * Fails toward `single`: only an explicit `variable` tag loads as variable. Listings
 * from other NIP-99 clients often have no `type` tag, and the Gamma spec treats a
 * missing type as `simple`. Mapping them to `variable` republished them as childless
 * variable parents, which spec-strict clients hide.
 *
 * The format defaults to `physical`, matching what the form has always published.
 */
export function productFormTypeFromTags(tags: readonly (readonly string[])[]): {
	productType: ProductFormType
	format: ProductFormat
} & PreservedTypeTags {
	const typeTag = tags.find((tag) => tag[0] === 'type')
	const form = {
		productType: typeTag?.[1] === 'variable' ? ('variable' as const) : ('single' as const),
		format: typeTag?.[2] === 'digital' ? ('digital' as const) : ('physical' as const),
	}

	if (!typeTag) return { ...form, preservedTypeTag: null }
	if (typeTag[1] !== 'variation') return form

	const parentTag = tags.find((tag) => tag[0] === 'a' && VARIATION_PARENT_REF.test(tag[1] ?? ''))
	return { ...form, preservedTypeTag: [...typeTag], ...(parentTag ? { preservedParentTag: [...parentTag] } : {}) }
}

/**
 * Builds the `type` tag to publish. Only an exact `variable` value publishes as
 * variable, so an empty or unexpected form value can never create a variable parent.
 */
export function productTypeTag(
	productType: string | undefined,
	format: string | undefined,
): ['type', 'simple' | 'variable', ProductFormat] {
	return ['type', productType === 'variable' ? 'variable' : 'simple', format === 'digital' ? 'digital' : 'physical']
}

/** Throws when a preserved `variation` child has no valid parent reference to re-emit. */
export function assertVariationHasParent(preserved: PreservedTypeTags): void {
	if (preserved.preservedTypeTag?.[1] === 'variation' && !preserved.preservedParentTag) {
		throw new Error('This variation listing has no valid parent product reference and cannot be republished')
	}
}
