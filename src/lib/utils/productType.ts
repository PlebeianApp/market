export type ProductFormType = 'single' | 'variable'
export type ProductFormat = 'digital' | 'physical'

/**
 * Maps a listing's `type` tag to the product form's type and format.
 *
 * Fails toward `single`: only an explicit `variable` tag loads as variable. Listings
 * from other NIP-99 clients often have no `type` tag, and the Gamma spec treats a
 * missing type as `simple`. Mapping them to `variable` republished them as childless
 * variable parents, which spec-strict clients hide.
 *
 * The format defaults to `physical`, matching what the form has always published.
 */
export function productFormTypeFromTag(typeTag: readonly string[] | undefined): { productType: ProductFormType; format: ProductFormat } {
	return {
		productType: typeTag?.[1] === 'variable' ? 'variable' : 'single',
		format: typeTag?.[2] === 'digital' ? 'digital' : 'physical',
	}
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
