    /**
 * Host-supplied wallet capabilities. PaymentOutcome should remain a
 * discriminated lifecycle type; the SDK does not interpret acknowledgement
 * as settlement or a successful receive as a published marketplace receipt.
 */
export interface WalletPort<Account, Asset, Balance, PayRequest, PayOutcome, ReceiveRequest = PayRequest, ReceiveOutcome = PayOutcome> {
	getAccount(): Promise<Account | null>
	getBalance(asset: Asset): Promise<Balance>
	pay(request: PayRequest): Promise<PayOutcome>
	receive(request: ReceiveRequest): Promise<ReceiveOutcome>
}

/** A wallet recovery capability is separate from ordinary payment and receive operations. */
export interface WalletRecoveryPort<Request, Outcome = void> {
	reclaim(request: Request): Promise<Outcome>
}
