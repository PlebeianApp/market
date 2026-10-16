import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProductCardView } from './ProductCardView'

const product = {
	id: 'product-event',
	pubkey: 'seller-pubkey',
	content: 'A handmade mug',
	tags: [
		['d', 'mug'],
		['title', 'Handmade Mug'],
		['image', 'https://images.example/mug.jpg'],
		['price', '1200', 'SATS'],
		['stock', '4'],
	],
}

const commonProps = {
	product,
	isOwnProduct: false,
	isInCart: false,
	cartQuantity: 0,
	isAddingToCart: false,
	showConfirmation: false,
	onAddToCart: () => {},
}

describe('ProductCardView', () => {
	test('renders SDK product fields and host-provided presentation slots', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductCardView, {
				...commonProps,
				renderPrice: (tag) => createElement('span', null, `${tag[1]} ${tag[2]}`),
				renderNotice: createElement('span', null, 'Test listing'),
				renderSecondaryAction: createElement('button', null, 'Zap'),
			}),
		)

		expect(markup).toContain('Handmade Mug')
		expect(markup).toContain('https://images.example/mug.jpg')
		expect(markup).toContain('1200 SATS')
		expect(markup).toContain('4 in stock')
		expect(markup).toContain('Test listing')
		expect(markup).toContain('Zap')
		expect(markup).toContain('Add to Cart')
	})

	test('uses SDK availability and visibility fields to disable out-of-stock products', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductCardView, {
				...commonProps,
				product: { ...product, tags: [...product.tags.filter((tag) => tag[0] !== 'stock'), ['stock', '0']] },
			}),
		)

		expect(markup).toContain('Out of stock')
		expect(markup).toContain('disabled=""')
	})
})
