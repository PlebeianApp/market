import { normalizeProductShippingSelections, type ProductShippingSelectionInput } from './productShipping'

export type SellerProductStatus = 'hidden' | 'on-sale' | 'pre-order'
export type SellerProductType = 'single' | 'variable'

export interface SellerProductListingInput {
	name: string
	summary: string
	description: string
	price: string
	quantity: string
	currency: string
	status: SellerProductStatus
	productType: SellerProductType
	mainCategory: string
	selectedCollection: string | null
	categories: Array<{ key: string; name: string; checked: boolean }>
	images: Array<{ imageUrl: string; imageOrder: number }>
	specs: Array<{ key: string; value: string }>
	shippings: ProductShippingSelectionInput[]
	weight: { value: string; unit: string } | null
	dimensions: { value: string; unit: string } | null
	isNSFW: boolean
}

export type SellerProductPublishValidationIssue =
	| 'product-name-required'
	| 'product-description-required'
	| 'product-price-invalid'
	| 'product-quantity-invalid'
	| 'product-image-required'
	| 'product-main-category-required'
	| 'product-shipping-required'

export type SellerProductPublishValidationResult =
	| { ok: true; normalizedShipping: ReturnType<typeof normalizeProductShippingSelections> }
	| { ok: false; issue: SellerProductPublishValidationIssue }

export interface SellerProductEventData {
	kind: 30402
	content: string
	tags: string[][]
}

/** Preserve the current required-field validation order for create and update paths. */
export function validateSellerProductForPublish(input: SellerProductListingInput): SellerProductPublishValidationResult {
	if (!input.name.trim()) return { ok: false, issue: 'product-name-required' }
	if (!input.description.trim()) return { ok: false, issue: 'product-description-required' }
	if (!input.price.trim() || isNaN(Number(input.price))) return { ok: false, issue: 'product-price-invalid' }
	if (!input.quantity.trim() || isNaN(Number(input.quantity))) return { ok: false, issue: 'product-quantity-invalid' }
	if (input.images.length === 0) return { ok: false, issue: 'product-image-required' }
	if (!input.mainCategory) return { ok: false, issue: 'product-main-category-required' }

	const normalizedShipping = normalizeProductShippingSelections(input.shippings).filter((selection) => selection.shippingRef)
	if (normalizedShipping.length === 0) return { ok: false, issue: 'product-shipping-required' }
	return { ok: true, normalizedShipping }
}

/** Build the current kind-30402 listing event data without generating IDs, signing, or publishing. */
export function buildSellerProductEventData(
	input: SellerProductListingInput,
	productId: string,
	options: { clientTag?: string[] } = {},
): SellerProductEventData {
	const tags: string[][] = [
		['d', productId],
		['title', input.name],
		['price', input.price, input.currency],
		['type', input.productType === 'single' ? 'simple' : 'variable', 'physical'],
		['visibility', input.status],
		['stock', input.quantity],
		...(input.summary ? [['summary', input.summary]] : []),
		...input.images.map((image) => ['image', image.imageUrl, '800x600', image.imageOrder.toString()]),
		['t', input.mainCategory],
		...input.categories.filter((category) => category.checked && category.name.trim() !== '').map((category) => ['t', category.name]),
		...input.specs.map((spec) => ['spec', spec.key, spec.value]),
		...normalizeProductShippingSelections(input.shippings)
			.filter((shipping) => shipping.shippingRef)
			.map((shipping) =>
				shipping.extraCost ? ['shipping_option', shipping.shippingRef, shipping.extraCost] : ['shipping_option', shipping.shippingRef],
			),
		...(input.weight ? [['weight', input.weight.value, input.weight.unit]] : []),
		...(input.dimensions ? [['dim', input.dimensions.value, input.dimensions.unit]] : []),
		...(input.selectedCollection ? [['collection', input.selectedCollection]] : []),
		...(options.clientTag ? [options.clientTag] : []),
		...(input.isNSFW ? [['content-warning', 'nsfw']] : []),
	]

	return { kind: 30402, content: input.description, tags }
}
