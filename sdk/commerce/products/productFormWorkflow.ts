import { resolvePublishPrice, type ProductPriceFormState } from './productPriceResolution'
import type { SellerProductFormTab } from './productWorkflow'
import type { ProductShippingSelection } from './productShipping'

export type SellerProductFormValidationState = ProductPriceFormState & {
	name: string
	description: string
	quantity: string
	mainCategory: string
	images: unknown[]
	shippings: ProductShippingSelection[]
}

export const SELLER_PRODUCT_FORM_TAB_ORDER: readonly SellerProductFormTab[] = ['name', 'detail', 'spec', 'category', 'images', 'shipping']

function isValidNumberString(value: string): boolean {
	return value.trim().length > 0 && !isNaN(Number(value))
}

/** Preserve current seller product form validation rules and messages. */
export function getSellerProductTabValidationIssues(state: SellerProductFormValidationState, tab: SellerProductFormTab): string[] {
	switch (tab) {
		case 'name': {
			const issues: string[] = []
			if (state.name.trim().length === 0) issues.push('Product name is required')
			if (state.description.trim().length === 0) issues.push('Description is required')
			return issues
		}
		case 'detail': {
			const issues: string[] = []
			if (resolvePublishPrice(state).status !== 'ok') issues.push('Valid product price is required')
			if (!isValidNumberString(state.quantity)) issues.push('Valid product quantity is required')
			return issues
		}
		case 'category':
			return state.mainCategory ? [] : ['Main category is required']
		case 'images':
			return state.images.length > 0 ? [] : ['At least one image is required']
		case 'shipping':
			return state.shippings.some((shipping) => !!shipping.shippingRef) ? [] : ['At least one shipping option is required']
		case 'spec':
			return []
	}
}

export function getSellerProductFormValidationIssues(state: SellerProductFormValidationState): string[] {
	return SELLER_PRODUCT_FORM_TAB_ORDER.flatMap((tab) => getSellerProductTabValidationIssues(state, tab))
}

export function getFirstBlockingSellerProductTab(
	state: SellerProductFormValidationState,
	targetTab: SellerProductFormTab,
): SellerProductFormTab | null {
	const targetIndex = SELLER_PRODUCT_FORM_TAB_ORDER.indexOf(targetTab)
	if (targetIndex <= 0) return null

	for (const tab of SELLER_PRODUCT_FORM_TAB_ORDER.slice(0, targetIndex)) {
		if (getSellerProductTabValidationIssues(state, tab).length > 0) return tab
	}
	return null
}

export function getAdjacentSellerProductTab(currentTab: SellerProductFormTab, direction: 'next' | 'previous'): SellerProductFormTab | null {
	const currentIndex = SELLER_PRODUCT_FORM_TAB_ORDER.indexOf(currentTab)
	const offset = direction === 'next' ? 1 : -1
	return SELLER_PRODUCT_FORM_TAB_ORDER[currentIndex + offset] ?? null
}
