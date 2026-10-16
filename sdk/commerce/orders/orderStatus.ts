export const BUYER_ORDER_STATUSES = ['pending', 'confirmed', 'processing', 'completed', 'cancelled'] as const
export const BUYER_SHIPPING_STATUSES = ['processing', 'shipped', 'delivered', 'exception'] as const

export type BuyerOrderStatus = (typeof BUYER_ORDER_STATUSES)[number]
export type BuyerShippingStatus = (typeof BUYER_SHIPPING_STATUSES)[number]

function getStatusTagValue(tags: string[][] | undefined): string | undefined {
	return tags?.find((tag) => tag[0] === 'status')?.at(1)
}

/** Resolve the status from the caller-provided latest event; default to pending as the app currently does. */
export function resolveBuyerOrderStatus(tags: string[][] | undefined): BuyerOrderStatus {
	const value = getStatusTagValue(tags)
	return BUYER_ORDER_STATUSES.includes(value as BuyerOrderStatus) ? (value as BuyerOrderStatus) : 'pending'
}

/** Shipping state remains separate from order/payment state. */
export function resolveBuyerShippingStatus(tags: string[][] | undefined): BuyerShippingStatus | null {
	const value = getStatusTagValue(tags)
	return BUYER_SHIPPING_STATUSES.includes(value as BuyerShippingStatus) ? (value as BuyerShippingStatus) : null
}
