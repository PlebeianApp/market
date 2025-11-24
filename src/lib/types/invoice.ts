export type PaymentInvoiceStatus = 'pending' | 'paid' | 'expired' | 'skipped'

export type PaymentInvoiceType = 'merchant' | 'v4v'

export interface PaymentInvoiceData {
	id: string
	orderId: string
	amount: number
	description: string
	recipientName: string
	status: PaymentInvoiceStatus
	type: PaymentInvoiceType
	recipientPubkey: string
	createdAt: number
	updatedAt?: number

	// Payment method chosen
	paymentMethod?: 'ln' | 'on-chain'

	// Lightning fields (null for on-chain)
	bolt11?: string | null
	lightningAddress?: string | null
	isZap?: boolean
	preimage?: string

	// On-chain fields (null for lightning)
	bitcoinAddress?: string
	paymentUri?: string
	txid?: string
	confirmations?: number
	expiresAt?: number

	// V4V specific (when type = 'v4v')
	v4vRecipientPubkey?: string
	v4vSplitPercent?: number

	persistedAt?: number
}
