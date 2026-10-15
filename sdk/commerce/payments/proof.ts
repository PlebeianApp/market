export type WalletPaymentMethod = 'nwc' | 'webln' | 'nip60'

export type PaymentProof =
	| { type: 'preimage'; preimage: string }
	| { type: 'zap_receipt'; eventId: string; preimage?: string }
	| { type: 'wallet_ack'; method: WalletPaymentMethod; atMs: number }

/**
 * Encode a PaymentProof into the single string field we store today (`invoice.preimage`)
 * and publish in the `payment` tag of the receipt.
 */
export function paymentProofToReceiptPreimage(proof: PaymentProof): string {
	switch (proof.type) {
		case 'preimage':
			return proof.preimage
		case 'zap_receipt':
			// If the receipt includes a valid payment preimage, use it; otherwise store the receipt event id (no prefix).
			return proof.preimage || proof.eventId
		case 'wallet_ack':
			// Avoid type prefixes; an empty string is treated as "external-payment" by receipt consumers.
			return ''
	}
}
