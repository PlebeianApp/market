import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProductDisplayView } from './ProductDisplayView'

const product = {
	pubkey: 'seller',
	content: 'A detailed product description',
	tags: [
		['d', 'blue-mug'],
		['title', 'Blue Mug'],
		['image', 'https://images.example/blue-mug.jpg'],
	],
}

const actions = {
	product,
	productId: 'blue-mug',
	index: 1,
	isLoading: false,
	onRemove: () => {},
	isRemoving: false,
}

describe('ProductDisplayView', () => {
	test('renders product details from SDK read-model fields and editor actions', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductDisplayView, {
				...actions,
				onMoveUp: () => {},
				onMoveDown: () => {},
				renderImage: (url, alt) => createElement('img', { src: url, alt }),
			}),
		)

		expect(markup).toContain('Blue Mug')
		expect(markup).toContain('A detailed product description')
		expect(markup).toContain('ID: blue-mug')
		expect(markup).toContain('https://images.example/blue-mug.jpg')
		expect(markup).toContain('aria-label="Move product 2 up"')
		expect(markup).toContain('aria-label="Remove product 2"')
	})

	test('shows a loading title until the product query resolves', () => {
		const markup = renderToStaticMarkup(createElement(ProductDisplayView, { ...actions, product: null, isLoading: true }))
		expect(markup).toContain('Loading...')
	})
})
