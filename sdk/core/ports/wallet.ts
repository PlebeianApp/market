/**
 * Host-supplied wallet capabilities. PaymentOutcome should remain a
 * discriminated lifecycle type; the SDK does not interpret acknowledgement
 * as settlement or a successful receive as a published marketplace receipt.
 */
export interface WalletPort<Account, Asset, Balance, PaymentRequest, PaymentOutcome> {
	getAccount(): Promise<Account | null>
	getBalance(asset: Asset): Promise<Balance>
	pay(request: PaymentRequest): Promise<PaymentOutcome>
	receive(request: PaymentRequest): Promise<PaymentOutcome>
}
