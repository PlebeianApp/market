import { describe, expect, test } from 'bun:test'
import { findNextActionableInvoiceIndex, isCheckoutInvoiceComplete } from './invoiceProgress'

describe('checkout invoice progress', () => {
	test('preserves current completion semantics for each checkout status', () => {
		expect(isCheckoutInvoiceComplete({ status: 'paid' })).toBe(true)
		expect(isCheckoutInvoiceComplete({ status: 'skipped' })).toBe(true)
		expect(isCheckoutInvoiceComplete({ status: 'expired' })).toBe(true)
		expect(isCheckoutInvoiceComplete({ status: 'pending' })).toBe(false)
		expect(isCheckoutInvoiceComplete({ status: 'failed' })).toBe(false)
	})

	test('finds next action and wraps while skipping inactive invoices', () => {
		const invoices = [{ status: 'paid' }, { status: 'failed' }, { status: 'skipped' }, { status: 'pending' }] as const
		expect(findNextActionableInvoiceIndex(invoices, 0)).toBe(1)
		expect(findNextActionableInvoiceIndex(invoices, 3)).toBe(1)
		expect(findNextActionableInvoiceIndex([{ status: 'paid' }] as const, 0)).toBe(-1)
	})
})
