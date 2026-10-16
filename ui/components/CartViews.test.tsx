import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CartFooter, CartLineShipping, CartSellerCard, CartShippingReminder, CartTotalsDetails } from './CartViews'
import { CheckoutPaymentSummary } from './CheckoutPaymentSummary'

describe('cart views', () => {
	test('shipping reminder pluralizes and hides at zero', () => {
		expect(renderToStaticMarkup(<CartShippingReminder count={0} />)).toBe('')
		expect(renderToStaticMarkup(<CartShippingReminder count={1} />)).toContain('1 item.')
		expect(renderToStaticMarkup(<CartShippingReminder count={2} />)).toContain('2 items.')
		expect(renderToStaticMarkup(<CartShippingReminder count={1} context="checkout" />)).toContain(
			'Please select shipping for 1 item before checkout.',
		)
	})

	test('totals details start collapsed unless requested', () => {
		const props = { totalSats: 3000, shippingSats: 1000, totalByCurrency: { USD: 2 }, shippingByCurrency: {} }
		expect(renderToStaticMarkup(<CartTotalsDetails {...props} />)).not.toContain('Grand Total')
		expect(renderToStaticMarkup(<CartTotalsDetails {...props} defaultExpanded />)).toContain('Grand Total')
	})

	test('checkout payment summary keeps paid, skipped, and remaining amounts distinct', () => {
		const invoices = [
			{ id: 'a', amount: 1000, recipientName: 'Shop', status: 'paid', type: 'merchant' },
			{ id: 'b', amount: 200, recipientName: 'Dev fund', status: 'skipped', type: 'v4v' },
			{ id: 'c', amount: 300, recipientName: 'Relay', status: 'pending', type: 'v4v' },
		]
		const markup = renderToStaticMarkup(<CheckoutPaymentSummary invoices={invoices} currentIndex={2} onSelectInvoice={() => {}} />)
		expect(markup).toContain('1/3')
		expect(markup).toContain(`${(1000).toLocaleString()} sats`)
		expect(markup).toContain('Skipped Amount')
		expect(markup).toContain('All Payments (3)')
	})

	test('line shipping shows the selection or a prompt', () => {
		const selected = { shippingMethodId: 'm', shippingMethodName: 'Post', shippingCost: 5, shippingCostCurrency: 'USD' }
		expect(renderToStaticMarkup(<CartLineShipping {...selected} />)).toContain('Shipping: Post - 5 USD')
		expect(renderToStaticMarkup(<CartLineShipping {...selected} shippingMethodId={null} />)).toContain('Select shipping at checkout')
	})

	test('seller card shows totals and only shows community share when non-zero', () => {
		const totals = {
			satsTotal: 1500.4,
			shippingSats: 500,
			currencyTotals: { USD: 1.5 },
			shares: { sellerAmount: 1500, communityAmount: 0, sellerPercentage: 100 },
		}
		const markup = renderToStaticMarkup(<CartSellerCard seller={<b>seller</b>} items={[{ key: 'a', content: 'item-a' }]} totals={totals} />)
		expect(markup).toContain('<b>seller</b>')
		expect(markup).toContain('item-a')
		expect(markup).toContain('1.50 USD')
		expect(markup).toContain(`${(1500).toLocaleString()} sat`)
		expect(markup).not.toContain('Community Share')
	})

	test('footer derives subtotal and disables actions for an empty cart', () => {
		const markup = renderToStaticMarkup(
			<CartFooter totalSats={3000} shippingSats={1000} canCheckout={false} onClear={() => {}} onCheckout={() => {}} />,
		)
		expect(markup).toContain(`${(2000).toLocaleString()} sat`)
		expect(markup.match(/disabled=""/g)).toHaveLength(2)
	})
})
