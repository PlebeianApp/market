import type { PaymentProof, WalletPaymentMethod } from './proof'
import { validatePreimage } from '@/lib/utils/payment.utils'

/**
 * Result from a wallet-specific pay call (NWC, WebLN, NIP-60).
 */
export interface WalletPayCallResult {
	preimage?: string
}

/**
 * Options for the shared post-wallet resolution flow.
 */
export interface ResolvePaymentProofOptions {
	bolt11: string
	method: WalletPaymentMethod
	walletResult: WalletPayCallResult
	requireZapReceipt: boolean
	waitForZapReceipt: (bolt11: string, timeoutMs: number) => Promise<{ eventId: string; receiptPreimage?: string } | null>
}

/**
 * Shared post-wallet payment resolution.
 *
 * After a wallet pay call succeeds (NWC, WebLN, or NIP-60), the confirmation
 * cascade is identical:
 *   1. Wait for a zap receipt (NIP-57) with a timeout
 *   2. If receipt contains a valid preimage → use it
 *   3. If receipt exists without valid preimage → use receipt as proof
 *   4. If requireZapReceipt is set → return null (caller should show "waiting" state)
 *   5. If wallet returned a preimage → use it
 *   6. Otherwise → wallet ACK proof
 *
 * Returns `null` when requireZapReceipt is set and no receipt arrived
 * (the caller should treat this as "still waiting").
 */
export async function resolvePaymentProof({
	bolt11,
	method,
	walletResult,
	requireZapReceipt,
	waitForZapReceipt,
}: ResolvePaymentProofOptions): Promise<PaymentProof | null> {
	const receipt = await waitForZapReceipt(bolt11, 20000)
	const receiptPreimage = receipt?.receiptPreimage
	const receiptHasValidPreimage = !!receiptPreimage && validatePreimage(bolt11, receiptPreimage)

	if (receiptHasValidPreimage) {
		return { type: 'preimage', preimage: receiptPreimage! }
	}

	if (receipt) {
		return { type: 'zap_receipt', eventId: receipt.eventId }
	}

	if (requireZapReceipt) {
		return null
	}

	if (walletResult.preimage) {
		return { type: 'preimage', preimage: walletResult.preimage }
	}

	return { type: 'wallet_ack', method, atMs: Date.now() }
}
