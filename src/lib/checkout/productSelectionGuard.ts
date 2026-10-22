import type { CartProduct } from '@/lib/stores/cart'
import { isProductSelectionValidForCartItem, type ProductSelectionEvents } from '@/queries/productFamilies'

export type CheckoutProductSelectionState = 'pending' | 'resolved' | 'invalid'

export interface ProductSelectionQuerySnapshot {
	isPending: boolean
	isFetching: boolean
	isError: boolean
	isSuccess: boolean
	data: ProductSelectionEvents | null | undefined
}

export type ProductSelectionResolver = (productId: string, sellerPubkey: string) => Promise<ProductSelectionEvents | null>

export function deriveCheckoutProductSelectionState(
	products: readonly Pick<CartProduct, 'id' | 'sellerPubkey'>[],
	queries: readonly ProductSelectionQuerySnapshot[],
): CheckoutProductSelectionState {
	if (products.length !== queries.length) return 'pending'
	if (queries.some((query) => query.isPending || query.isFetching)) return 'pending'

	const invalid = queries.some((query, index) => {
		const product = products[index]
		return (
			!product ||
			query.isError ||
			!query.isSuccess ||
			!query.data ||
			!isProductSelectionValidForCartItem(query.data, product.id, product.sellerPubkey)
		)
	})

	return invalid ? 'invalid' : 'resolved'
}

export const canSubmitCheckoutShipping = (state: CheckoutProductSelectionState, hasAllShippingMethods: boolean): boolean =>
	state === 'resolved' && hasAllShippingMethods

export const canContinueCheckoutPayment = (state: CheckoutProductSelectionState, baseRequirementsMet: boolean): boolean =>
	state === 'resolved' && baseRequirementsMet

export async function assertCheckoutProductSelectionsResolved(
	productsBySeller: Record<string, Array<Pick<CartProduct, 'id'>>>,
	resolveProductSelection: ProductSelectionResolver,
): Promise<void> {
	for (const [sellerPubkey, products] of Object.entries(productsBySeller)) {
		for (const product of products) {
			let selection: ProductSelectionEvents | null
			try {
				selection = await resolveProductSelection(product.id, sellerPubkey)
			} catch {
				throw new Error('Product selection could not be verified before order creation')
			}

			if (!selection || !isProductSelectionValidForCartItem(selection, product.id, sellerPubkey)) {
				throw new Error('Product selection could not be verified before order creation')
			}
		}
	}
}
