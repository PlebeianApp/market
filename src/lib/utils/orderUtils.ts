// Invoice-related types for order utility functions
export interface InvoiceData {
	id: string
	orderId: string
	sellerPubkey: string
	amountSats: number
	status: 'pending' | 'paid' | 'expired' | 'failed'
	bolt11?: string
	createdAt: number
	expiresAt?: number
	type: 'merchant' | 'v4v'
}

export interface OrderInvoiceSet {
	orderId: string
	invoices: InvoiceData[]
	totalAmount: number
	merchantAmount: number
	v4vAmount: number
	status: 'pending' | 'partial' | 'complete' | 'failed'
}

/**
 * Create invoice data object
 */
export function createInvoiceData(
	orderId: string,
	sellerPubkey: string,
	amountSats: number,
	type: 'merchant' | 'v4v' = 'merchant',
	bolt11?: string,
): InvoiceData {
	const now = Math.floor(Date.now() / 1000)

	return {
		id: `${orderId}-${type}-${sellerPubkey}`,
		orderId,
		sellerPubkey,
		amountSats,
		status: 'pending',
		bolt11,
		createdAt: now,
		expiresAt: bolt11 ? now + 3600 : undefined, // 1 hour expiry for invoices
		type,
	}
}

/**
 * Create an order invoice set with merchant and V4V invoices
 */
export function createOrderInvoiceSet(
	orderId: string,
	merchantPubkey: string,
	merchantAmount: number,
	v4vRecipients: Array<{ pubkey: string; amount: number }> = [],
): OrderInvoiceSet {
	const invoices: InvoiceData[] = []

	// Add merchant invoice
	if (merchantAmount > 0) {
		invoices.push(createInvoiceData(orderId, merchantPubkey, merchantAmount, 'merchant'))
	}

	// Add V4V invoices
	v4vRecipients.forEach((recipient) => {
		if (recipient.amount > 0) {
			invoices.push(createInvoiceData(orderId, recipient.pubkey, recipient.amount, 'v4v'))
		}
	})

	const totalAmount = merchantAmount + v4vRecipients.reduce((sum, r) => sum + r.amount, 0)
	const v4vAmount = v4vRecipients.reduce((sum, r) => sum + r.amount, 0)

	return {
		orderId,
		invoices,
		totalAmount,
		merchantAmount,
		v4vAmount,
		status: 'pending',
	}
}

/**
 * Update the status of a specific invoice in an invoice set
 */
export function updateInvoiceStatus(invoiceSet: OrderInvoiceSet, invoiceId: string, status: InvoiceData['status']): OrderInvoiceSet {
	const updatedInvoices = invoiceSet.invoices.map((invoice) => (invoice.id === invoiceId ? { ...invoice, status } : invoice))

	// Determine overall status
	const paidInvoices = updatedInvoices.filter((inv) => inv.status === 'paid')
	const failedInvoices = updatedInvoices.filter((inv) => inv.status === 'failed')

	let overallStatus: OrderInvoiceSet['status'] = 'pending'

	if (paidInvoices.length === updatedInvoices.length) {
		overallStatus = 'complete'
	} else if (failedInvoices.length === updatedInvoices.length) {
		overallStatus = 'failed'
	} else if (paidInvoices.length > 0) {
		overallStatus = 'partial'
	}

	return {
		...invoiceSet,
		invoices: updatedInvoices,
		status: overallStatus,
	}
}

import { ORDER_STATUS } from '../schemas/order'
import type { OrderWithRelatedEvents } from '@/queries/orders'
import { getOrderStatus } from '@/queries/orders'

export const getStatusStyles = (order: OrderWithRelatedEvents) => {
	const status = getOrderStatus(order)
	const hasBeenShipped = order.shippingUpdates.some((update) => update.tags.find((tag) => tag[0] === 'status')?.[1] === 'shipped')

	if (status === ORDER_STATUS.PROCESSING && hasBeenShipped) {
		return {
			bgColor: 'bg-orange-100',
			borderColor: 'border-orange-100',
			headerBgColor: 'bg-orange-100/30',
			textColor: 'text-orange-800',
			iconName: 'truck',
			label: 'Shipped',
		}
	}

	switch (status) {
		case ORDER_STATUS.CONFIRMED:
			return {
				bgColor: 'bg-blue-100',
				borderColor: 'border-blue-100',
				headerBgColor: 'bg-blue-100/30',
				textColor: 'text-blue-800',
				iconName: 'tick',
				label: 'Confirmed',
			}
		case ORDER_STATUS.PROCESSING:
			return {
				bgColor: 'bg-yellow-100',
				borderColor: 'border-yellow-100',
				headerBgColor: 'bg-yellow-100/30',
				textColor: 'text-yellow-800',
				iconName: 'clock',
				label: 'Processing',
			}
		case ORDER_STATUS.COMPLETED:
			return {
				bgColor: 'bg-green-100',
				borderColor: 'border-green-100',
				headerBgColor: 'bg-green-100/30',
				textColor: 'text-green-800',
				iconName: 'tick',
				label: 'Completed',
			}
		case ORDER_STATUS.CANCELLED:
			return {
				bgColor: 'bg-red-100',
				borderColor: 'border-red-100',
				headerBgColor: 'bg-red-100/30',
				textColor: 'text-red-800',
				iconName: 'cross',
				label: 'Cancelled',
			}
		case ORDER_STATUS.PENDING:
		default:
			return {
				bgColor: 'bg-gray-100',
				borderColor: 'border-gray-100',
				headerBgColor: 'bg-gray-100/30',
				textColor: 'text-gray-800',
				iconName: 'clock',
				label: 'Pending',
			}
	}
}
