import type { ProductFormState, ProductFormTab } from '@/lib/stores/product'
import { normalizeProductShippingSelections, type ProductShippingSelectionInput } from '@/lib/utils/productShippingSelections'

type ProductPublishValidationField = 'name' | 'description' | 'price' | 'quantity' | 'images' | 'mainCategory' | 'shipping'

export type ProductPublishValidationInput = {
	name: string
	description: string
	price: string
	quantity: string
	mainCategory: string | null
	images: unknown[]
	shippings: ProductShippingSelectionInput[]
}

export type ProductPublishValidation = {
	isValid: boolean
	issues: string[]
	issuesByField: Partial<Record<ProductPublishValidationField, string[]>>
}

export type ProductDraftValidation = {
	hasValidName: boolean
	hasValidDescription: boolean
	hasValidPrice: boolean
	hasValidQuantity: boolean
	hasValidCategory: boolean
	hasValidImages: boolean
	hasValidShipping: boolean
	publishValidation: ProductPublishValidation
	allRequiredFieldsValid: boolean
	issues: string[]
	issuesByTab: Partial<Record<ProductFormTab, string[]>>
	firstIncompleteTab: ProductFormTab
}

const PRODUCT_FORM_TAB_ORDER: ProductFormTab[] = ['name', 'detail', 'spec', 'category', 'images', 'shipping']

export function validateProductPublishDraft(input: ProductPublishValidationInput): ProductPublishValidation {
	const issuesByField: Partial<Record<ProductPublishValidationField, string[]>> = {}
	const addIssue = (field: ProductPublishValidationField, issue: string) => {
		issuesByField[field] = [...(issuesByField[field] ?? []), issue]
	}

	if (!input.name.trim()) addIssue('name', 'Product name is required')
	if (!input.description.trim()) addIssue('description', 'Product description is required')
	if (!input.price.trim() || isNaN(Number(input.price))) addIssue('price', 'Valid product price is required')
	if (!input.quantity.trim() || isNaN(Number(input.quantity))) addIssue('quantity', 'Valid product quantity is required')
	if (input.images.length === 0) addIssue('images', 'At least one product image is required')
	if (!input.mainCategory) addIssue('mainCategory', 'Main category is required')

	const validShippings = normalizeProductShippingSelections(input.shippings).filter((ship) => ship.shippingRef)
	if (validShippings.length === 0) addIssue('shipping', 'At least one shipping option is required')

	const fieldOrder: ProductPublishValidationField[] = ['name', 'description', 'price', 'quantity', 'images', 'mainCategory', 'shipping']
	const issues = fieldOrder.flatMap((field) => issuesByField[field] ?? [])

	return {
		isValid: issues.length === 0,
		issues,
		issuesByField,
	}
}

export function getProductFormPublishValidationInput(state: ProductFormState): ProductPublishValidationInput {
	const usesFiatPublishPrice = state.currency !== 'SATS' && state.currency !== 'BTC' && state.currencyMode === 'fiat'

	return {
		name: state.name,
		description: state.description,
		price: usesFiatPublishPrice ? state.fiatPrice || state.price : state.price,
		quantity: state.quantity,
		mainCategory: state.mainCategory,
		images: state.images,
		shippings: state.shippings,
	}
}

export function validateProductDraft({
	state,
	resolvedShippingRefs,
	isShippingFetched,
}: {
	state: ProductFormState
	resolvedShippingRefs: Set<string>
	isShippingFetched: boolean
}): ProductDraftValidation {
	const publishValidation = validateProductPublishDraft(getProductFormPublishValidationInput(state))
	const hasValidName = !(publishValidation.issuesByField.name?.length ?? 0)
	const hasValidDescription = !(publishValidation.issuesByField.description?.length ?? 0)
	const hasValidPrice = !(publishValidation.issuesByField.price?.length ?? 0)
	const hasValidQuantity = !(publishValidation.issuesByField.quantity?.length ?? 0)
	const hasValidCategory = !(publishValidation.issuesByField.mainCategory?.length ?? 0)
	const hasValidImages = !(publishValidation.issuesByField.images?.length ?? 0)
	const hasPublishValidShipping = !(publishValidation.issuesByField.shipping?.length ?? 0)
	const hasResolvedShipping = state.shippings.some(
		(ship) => ship.shippingRef && (!isShippingFetched || resolvedShippingRefs.has(ship.shippingRef)),
	)
	const hasValidShipping = hasPublishValidShipping && hasResolvedShipping

	const issuesByTab: Partial<Record<ProductFormTab, string[]>> = {}
	const addIssue = (tab: ProductFormTab, issue: string) => {
		issuesByTab[tab] = [...(issuesByTab[tab] ?? []), issue]
	}

	for (const issue of publishValidation.issuesByField.name ?? []) addIssue('name', issue)
	for (const issue of publishValidation.issuesByField.description ?? []) addIssue('name', issue)
	for (const issue of publishValidation.issuesByField.price ?? []) addIssue('detail', issue)
	for (const issue of publishValidation.issuesByField.quantity ?? []) addIssue('detail', issue)
	for (const issue of publishValidation.issuesByField.mainCategory ?? []) addIssue('category', issue)
	for (const issue of publishValidation.issuesByField.images ?? []) addIssue('images', issue)
	for (const issue of publishValidation.issuesByField.shipping ?? []) addIssue('shipping', issue)
	if (hasPublishValidShipping && !hasResolvedShipping) addIssue('shipping', 'Selected shipping option is no longer available')

	const issues = PRODUCT_FORM_TAB_ORDER.flatMap((tab) => issuesByTab[tab] ?? [])
	const allRequiredFieldsValid = issues.length === 0
	const firstIncompleteTab = PRODUCT_FORM_TAB_ORDER.find((tab) => issuesByTab[tab]?.length) ?? 'shipping'

	return {
		hasValidName,
		hasValidDescription,
		hasValidPrice,
		hasValidQuantity,
		hasValidCategory,
		hasValidImages,
		hasValidShipping,
		publishValidation,
		allRequiredFieldsValid,
		issues,
		issuesByTab,
		firstIncompleteTab,
	}
}
