import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProductSearchResults } from './ProductSearchResults'

const product = {
	id: 'event-1',
	pubkey: 'seller-pubkey',
	created_at: 100,
	content: 'A bright red mug',
	tags: [
		['d', 'red-mug'],
		['title', 'Red Mug'],
		['image', 'https://images.example/mug.jpg'],
	],
}

describe('ProductSearchResults', () => {
	test('renders SDK-projected product data and delegates selection affordances', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductSearchResults, {
				products: [product],
				isLoading: false,
				onSelect: () => {},
				onShowAll: () => {},
				renderSeller: (pubkey) => createElement('span', null, `seller:${pubkey}`),
			}),
		)

		expect(markup).toContain('<ul')
		expect(markup).toContain('<li>')
		expect(markup).toContain('aria-label="Open Red Mug"')
		expect(markup).toContain('https://images.example/mug.jpg')
		expect(markup).toContain('seller:seller-pubkey')
		expect(markup).toContain('Show search results in page')
	})

	test('renders distinct loading and empty states', () => {
		const loading = renderToStaticMarkup(
			createElement(ProductSearchResults, { products: [], isLoading: true, onSelect: () => {}, onShowAll: () => {} }),
		)
		const empty = renderToStaticMarkup(
			createElement(ProductSearchResults, { products: [], isLoading: false, onSelect: () => {}, onShowAll: () => {} }),
		)

		expect(loading).toContain('Searching...')
		expect(empty).toContain('No products found')
	})

	test('merges host classes and forwards standard container props', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductSearchResults, {
				products: [],
				isLoading: false,
				onSelect: () => {},
				onShowAll: () => {},
				className: 'w-[480px]',
				'aria-label': 'Product search dropdown',
			}),
		)

		expect(markup).toContain('w-[480px]')
		expect(markup).toContain('aria-label="Product search dropdown"')
	})
})
