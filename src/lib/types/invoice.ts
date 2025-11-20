export type PaymentInvoiceStatus = 'pending' | 'paid' | 'expired' | 'skipped'

export type PaymentInvoiceType = 'merchant' | 'v4v'

export interface PaymentInvoiceData {
	id: string
	orderId: string
	bolt11?: string | null
	amount: number
	description: string
	recipientName: string
	status: PaymentInvoiceStatus
	expiresAt?: number
	createdAt: number
	lightningAddress?: string | null
	recipientPubkey: string
	type: PaymentInvoiceType
	isZap?: boolean
	preimage?: string
	persistedAt?: number
	updatedAt?: number
}
