import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { OrderAmountText, OrderDateText, OrderReferenceBadge } from './OrderListCells'

const order = {
	created_at: 0,
	tags: [
		['order', 'abcdef1234567890'],
		['amount', '21000'],
	],
}

describe('order list cells', () => {
	test('renders truncated order reference through the host link', () => {
		const markup = renderToStaticMarkup(
			createElement(OrderReferenceBadge, {
				order,
				renderLink: (reference, children) => createElement('a', { href: `/orders/${reference}` }, children),
			}),
		)

		expect(markup).toContain('href="/orders/abcdef1234567890"')
		expect(markup).toContain('abcdef12...')
	})

	test('falls back when order reference and amount are missing', () => {
		const empty = { tags: [] }
		const badge = renderToStaticMarkup(
			createElement(OrderReferenceBadge, {
				order: empty,
				renderLink: (reference, children) => createElement('a', { href: reference }, children),
			}),
		)

		expect(badge).toContain('href="unknown"')
		expect(badge).toContain('Unknown')
		expect(renderToStaticMarkup(createElement(OrderAmountText, { order: empty }))).toContain('>-</div>')
		expect(renderToStaticMarkup(createElement(OrderDateText, { order: {} }))).toContain('>-</span>')
	})

	test('formats amount in sats', () => {
		expect(renderToStaticMarkup(createElement(OrderAmountText, { order }))).toContain(`${(21000).toLocaleString()} sats`)
	})
})
