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
