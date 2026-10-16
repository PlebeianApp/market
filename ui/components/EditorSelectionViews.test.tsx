import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CollectionSelectField } from './CollectionSelectField'
import { ProductSelectionList } from './ProductSelectionList'

const collections = [
	{
		pubkey: 'seller',
		tags: [
			['d', 'blue-mugs'],
			['title', 'Blue Mugs'],
			['summary', 'Blue ceramic mugs'],
		],
	},
]

describe('editor selection views', () => {
	test('renders collection options from SDK collection fields', () => {
		const markup = renderToStaticMarkup(
			createElement(CollectionSelectField, {
				collections,
				value: 'blue-mugs',
				onValueChange: () => {},
				id: 'collection-select',
			}),
		)

		expect(markup).toContain('value="blue-mugs" selected=""')
		expect(markup).toContain('Blue Mugs')
		expect(markup).toContain('Not In A Collection')
	})

	test('renders product selection rows and selected state', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductSelectionList, {
				items: [{ id: 'mug', title: 'Blue Mug', coordinates: '30402:seller:mug', imageUrl: 'https://images.example/mug.jpg' }],
				selectedCoordinates: ['30402:seller:mug'],
				isLoading: false,
				onToggle: () => {},
			}),
		)

		expect(markup).toContain('Blue Mug')
		expect(markup).toContain('checked=""')
		expect(markup).toContain('1 product selected')
		expect(markup).toContain('https://images.example/mug.jpg')
	})

	test('renders a loading state for product selection', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductSelectionList, { items: [], selectedCoordinates: [], isLoading: true, onToggle: () => {} }),
		)
		expect(markup).toContain('Loading your products...')
	})
})
