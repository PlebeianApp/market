export type CheckoutInvoiceStatus = 'pending' | 'paid' | 'expired' | 'skipped' | 'failed'

export interface CheckoutInvoiceProgressItem {
	status: CheckoutInvoiceStatus
}

/** Preserve current checkout behavior: expired invoices do not block finalization. */
export function isCheckoutInvoiceComplete(invoice: CheckoutInvoiceProgressItem): boolean {
	return invoice.status === 'paid' || invoice.status === 'skipped' || invoice.status === 'expired'
}

/** Find the next pending/failed invoice, wrapping once, exactly as checkout does today. */
export function findNextActionableInvoiceIndex<T extends CheckoutInvoiceProgressItem>(list: readonly T[], fromIndex: number): number {
	for (let index = fromIndex + 1; index < list.length; index++) {
		if (list[index]?.status === 'pending' || list[index]?.status === 'failed') return index
	}

	for (let index = 0; index <= fromIndex && index < list.length; index++) {
		if (list[index]?.status === 'pending' || list[index]?.status === 'failed') return index
	}

	return -1
}
