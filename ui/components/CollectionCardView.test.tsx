import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CollectionCardView } from './CollectionCardView'

const collection = {
	pubkey: 'seller-pubkey',
	tags: [
		['d', 'mug-collection'],
		['title', 'Mugs'],
		['summary', 'Handmade ceramic mugs'],
		['image', 'https://images.example/mugs.jpg'],
	],
}

describe('CollectionCardView', () => {
	test('renders SDK collection fields through host link, image, and seller slots', () => {
		const markup = renderToStaticMarkup(
			createElement(CollectionCardView, {
				collection,
				renderLink: (children, id, className) => createElement('a', { href: `/collection/${id}`, className }, children),
				renderImage: (url, title) => createElement('img', { src: url, alt: title }),
				renderSeller: createElement('span', null, 'Seller'),
			}),
		)

		expect(markup).toContain('href="/collection/mug-collection"')
		expect(markup).toContain('Mugs')
		expect(markup).toContain('Handmade ceramic mugs')
		expect(markup).toContain('https://images.example/mugs.jpg')
		expect(markup).toContain('Seller')
	})
})
