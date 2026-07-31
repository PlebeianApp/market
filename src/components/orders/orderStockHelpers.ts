import { fetchProductSmart, getProductId, getProductType } from '@/queries/products'
import type { NDKEvent } from '@/lib/nostr/ndk-events'
import { getOrderItems } from './orderDetailHelpers'

export type OrderStockItem = {
	productRef: string
	quantity: number
	isDigital: boolean
	productEvent: NDKEvent | null
}

export async function fetchOrderStockItems(orderEvent: NDKEvent): Promise<OrderStockItem[]> {
	const items = getOrderItems(orderEvent)
	const stockItems: OrderStockItem[] = []

	for (const item of items) {
		const [kind, sellerPubkey, identifier] = item.productRef.split(':')
		if (kind !== '30402' || !sellerPubkey || !identifier) continue

		let productEvent: NDKEvent | null = null
		try {
			productEvent = await fetchProductSmart(identifier, sellerPubkey)
		} catch {
			productEvent = null
		}

		const isDigital = !!productEvent && getProductType(productEvent)?.[2] === 'digital'
		const canonicalProductRef = productEvent ? `30402:${sellerPubkey}:${getProductId(productEvent)}` : item.productRef

		stockItems.push({
			productRef: canonicalProductRef,
			quantity: item.quantity,
			isDigital,
			productEvent,
		})
	}

	return stockItems
}
