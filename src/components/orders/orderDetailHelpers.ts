import type { PaymentInvoiceData } from '@/lib/types/invoice'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import {
	getOrderAmountSats,
	getOrderItems as readOrderItems,
	getOrderRecipientPubkey,
	getOrderReference,
	getOrderShippingReference,
} from '@sdk/commerce/orders'

export const getOrderId = (orderEvent: NDKEvent): string => getOrderReference(orderEvent) || orderEvent.id

export const getTotalAmount = (orderEvent: NDKEvent): number => parseInt(getOrderAmountSats(orderEvent) || '0')

export const getOrderItems = (orderEvent: NDKEvent): Array<{ productRef: string; quantity: number }> => readOrderItems(orderEvent)

export const getSellerPubkey = (orderEvent: NDKEvent): string => getOrderRecipientPubkey(orderEvent) || ''

export const getShippingRef = (orderEvent: NDKEvent): string | undefined => getOrderShippingReference(orderEvent) ?? undefined

export const makeInvoiceKey = (invoice: PaymentInvoiceData) => {
	return `${invoice.orderId}:${invoice.recipientPubkey}:${invoice.amount}:${invoice.type}`
}

export { extractPaymentMethods, isPaymentCompleted, parseOrderAddress as parseAddress } from '@sdk/commerce/orders/orderDetail'
export { getInvoiceStatusColor as getStatusColor } from '@ui/components/orders/OrderDetailViews'
