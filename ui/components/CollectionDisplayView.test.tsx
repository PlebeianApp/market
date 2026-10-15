import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CollectionDisplayView } from './CollectionDisplayView'

const collection = {
	pubkey: 'seller',
	tags: [
		['d', 'blue-mugs'],
		['title', 'Blue Mugs'],
		['summary', 'A set of blue ceramic mugs'],
		['image', 'https://images.example/blue-mugs.jpg'],
	],
}

describe('CollectionDisplayView', () => {
	test('renders collection details from SDK read-model fields and editor actions', () => {
		const markup = renderToStaticMarkup(
			createElement(CollectionDisplayView, {
				collection,
				collectionId: 'blue-mugs',
				index: 0,
				isLoading: false,
				onMoveUp: () => {},
				onRemove: () => {},
				canMoveUp: false,
				isRemoving: false,
				renderImage: (url, alt) => createElement('img', { src: url, alt }),
			}),
		)

		expect(markup).toContain('Blue Mugs')
		expect(markup).toContain('A set of blue ceramic mugs')
		expect(markup).toContain('ID: blue-mugs')
		expect(markup).toContain('https://images.example/blue-mugs.jpg')
		expect(markup).toContain('aria-label="Move collection 1 up"')
		expect(markup).toContain('Remove collection 1')
	})
})
