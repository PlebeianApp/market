export interface OrderReadEvent {
	tags?: string[][]
}

/** Returns the first `p` tag value, which identifies the order recipient. */
export function getOrderRecipientPubkey(event: OrderReadEvent | null): string | null {
	return event?.tags?.find((tag) => tag[0] === 'p')?.[1] || null
}

export function getOrderReference(event: OrderReadEvent | null): string | null {
	return event?.tags?.find((tag) => tag[0] === 'order')?.[1] || null
}

/** Returns the raw `amount` tag value in sats, unparsed. */
export function getOrderAmountSats(event: OrderReadEvent | null): string | null {
	return event?.tags?.find((tag) => tag[0] === 'amount')?.[1] || null
}

export interface OrderReadItem {
	productRef: string
	quantity: number
}

/** Missing quantity defaults to 1; unparseable quantities surface as NaN for the caller to reject. */
export function getOrderItems(event: OrderReadEvent | null): OrderReadItem[] {
	return (event?.tags ?? [])
		.filter((tag) => tag[0] === 'item')
		.map((tag) => ({ productRef: tag[1], quantity: parseInt(tag[2] || '1', 10) }))
}

export function getOrderShippingReference(event: OrderReadEvent | null): string | null {
	return event?.tags?.find((tag) => tag[0] === 'shipping')?.[1] || null
}
