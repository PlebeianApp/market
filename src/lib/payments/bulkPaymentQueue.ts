import type { PaymentInvoiceData } from '@/lib/types/invoice'

/**
 * Get the list of invoice IDs that are eligible for bulk payment.
 * Only pending and failed invoices can be paid.
 */
export function getPayableInvoiceIds(invoices: PaymentInvoiceData[]): string[] {
	return invoices.filter((inv) => inv.status === 'pending' || inv.status === 'failed').map((inv) => inv.id)
}

/**
 * Find the index of an invoice by its ID.
 * Returns -1 if not found.
 */
export function findInvoiceIndex(invoices: PaymentInvoiceData[], invoiceId: string): number {
	return invoices.findIndex((inv) => inv.id === invoiceId)
}

/**
 * Remove a completed invoice ID from the queue and return the updated queue.
 */
export function removeFromQueue(queue: string[], invoiceId: string): string[] {
	return queue.filter((id) => id !== invoiceId)
}

/**
 * Count completed invoices based on mode.
 * - 'checkout' mode: paid, skipped, and expired all count as completed
 * - 'order' mode: only paid counts as completed
 */
export function countCompletedInvoices(invoices: PaymentInvoiceData[], mode: 'checkout' | 'order'): number {
	if (mode === 'order') {
		return invoices.filter((inv) => inv.status === 'paid').length
	}
	return invoices.filter((inv) => inv.status === 'paid' || inv.status === 'skipped' || inv.status === 'expired').length
}

/**
 * Check if an invoice is considered completed for progress tracking.
 */
export function isInvoiceCompleted(invoice: PaymentInvoiceData, mode: 'checkout' | 'order'): boolean {
	if (mode === 'order') {
		return invoice.status === 'paid'
	}
	return invoice.status === 'paid' || invoice.status === 'skipped' || invoice.status === 'expired'
}
