import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { InvoiceWithSource } from '@sdk/commerce/orders/orderDetail'
import { OrderActionsView } from './OrderActionsView'
import { DeliveryAddressView, InvoiceCardView, OrderCardView, PrivateOrderDetailsView } from './OrderDetailViews'
import { OrderListView } from './OrderListView'

const noop = () => {}

const invoice = (overrides: Partial<InvoiceWithSource> = {}): InvoiceWithSource => ({
	id: 'inv-1',
	orderId: 'o1',
	amount: 2100,
	description: 'Merchant Payment',
	recipientName: 'Seller',
	status: 'pending',
	createdAt: 1,
	recipientPubkey: 'seller',
	type: 'merchant',
	bolt11: 'lnbc1',
	expiresAt: 2_000,
	source: 'request',
	localCopies: [],
	...overrides,
})

describe('InvoiceCardView', () => {
	test('offers payment for an open invoice', () => {
		const markup = renderToStaticMarkup(
			createElement(InvoiceCardView, {
				invoice: invoice(),
				index: 0,
				totalInvoices: 1,
				isBuyer: true,
				isGenerating: false,
				onPay: noop,
				onGenerateNew: noop,
				onCopy: noop,
				now: 1_000,
			}),
		)
		expect(markup).toContain('Pay 2,100 sats')
		expect(markup).toContain('Pending')
	})

	test('asks for a new invoice once expired', () => {
		const markup = renderToStaticMarkup(
			createElement(InvoiceCardView, {
				invoice: invoice(),
				index: 0,
				totalInvoices: 2,
				isBuyer: true,
				isGenerating: false,
				onPay: noop,
				onGenerateNew: noop,
				onCopy: noop,
				now: 3_000,
			}),
		)
		expect(markup).toContain('Generate New Invoice')
		expect(markup).toContain('Expired')
	})
})

describe('order detail views', () => {
	test('delivery address splits structured lines', () => {
		const markup = renderToStaticMarkup(createElement(DeliveryAddressView, { shippingAddress: 'Satoshi\n1 Main St\nBerlin\n10115' }))
		expect(markup).toContain('Satoshi')
		expect(markup).toContain('10115')
	})

	test('private details show an unavailable notice when rows are null', () => {
		expect(renderToStaticMarkup(createElement(PrivateOrderDetailsView, { rows: null }))).toContain(
			'Encrypted delivery details are unavailable',
		)
	})

	test('order card labels purchases and sales', () => {
		const markup = renderToStaticMarkup(
			createElement(OrderCardView, { href: '/dashboard/orders/abc', orderEventId: 'abcdef123', isBuyer: true, status: 'completed' }),
		)
		expect(markup).toContain('Purchase #abcdef12')
		expect(markup).toContain('href="/dashboard/orders/abc"')
	})
})

describe('OrderActionsView', () => {
	const base = {
		status: 'pending',
		isUpdatingStatus: false,
		isUpdatingShipping: false,
		onConfirm: noop,
		onProcess: noop,
		onReceive: noop,
		onCancel: noop,
		onShip: noop,
	}

	test('shows only the allowed actions', () => {
		const markup = renderToStaticMarkup(
			createElement(OrderActionsView, {
				...base,
				actions: { canCancel: true, canConfirm: true, canProcess: false, canShip: false, canReceive: false },
			}),
		)
		expect(markup).toContain('Cancel Order')
		expect(markup).toContain('Confirm Payment Received')
		expect(markup).not.toContain('Mark As Shipped')
	})

	test('shows the terminal state when nothing is actionable', () => {
		const markup = renderToStaticMarkup(
			createElement(OrderActionsView, {
				...base,
				status: 'completed',
				actions: { canCancel: false, canConfirm: false, canProcess: false, canShip: false, canReceive: false },
			}),
		)
		expect(markup).toContain('Order completed')
	})
})

describe('OrderListView', () => {
	test('renders the empty message', () => {
		const markup = renderToStaticMarkup(
			createElement(OrderListView, { isCompact: false, isLoading: false, rows: [], emptyMessage: 'No orders found.' }),
		)
		expect(markup).toContain('No orders found.')
	})
})
