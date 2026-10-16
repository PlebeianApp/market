export interface ProductAvailabilityEvent {
	tags: string[][]
}

/**
 * Mirrors the existing discovery stock rule. This is a client-side display
 * rule, not a reservation or guarantee that inventory remains available.
 */
export function isProductInStock(event: ProductAvailabilityEvent): boolean {
	const visibility = event.tags.find((tag) => tag[0] === 'visibility')?.[1] || 'on-sale'
	if (visibility === 'pre-order') return true

	const stockTag = event.tags.find((tag) => tag[0] === 'stock')
	if (!stockTag) return false

	const stockValue = Number.parseInt(stockTag[1], 10)
	return !Number.isNaN(stockValue) && stockValue > 0
}
