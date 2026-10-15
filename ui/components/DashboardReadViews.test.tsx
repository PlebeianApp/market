import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DashboardCollectionDetails, DashboardCollectionTrigger } from './DashboardCollectionListItem'
import { DashboardOverviewStats } from './DashboardOverviewStats'
import { DashboardProductDetails, DashboardProductTrigger } from './DashboardProductListItem'

const product = {
	pubkey: 'seller',
	created_at: 10,
	content: 'A detailed mug description',
	tags: [
		['d', 'mug'],
		['title', 'Blue Mug'],
		['price', '12', 'SATS'],
		['stock', '3'],
		['visibility', 'on-sale'],
		['image', 'https://images.example/mug.jpg'],
	],
}

const collection = {
	pubkey: 'seller',
	content: 'Collection description',
	tags: [
		['d', 'mugs'],
		['title', 'Mugs'],
		['summary', 'Ceramic mugs'],
		['image', 'https://images.example/mugs.jpg'],
		['a', '30402:seller:blue-mug'],
	],
}

describe('dashboard SDK views', () => {
	test('renders product trigger and details from SDK product fields', () => {
		const trigger = renderToStaticMarkup(createElement(DashboardProductTrigger, { product }))
		const details = renderToStaticMarkup(
			createElement(DashboardProductDetails, {
				product,
				renderLink: (children) => createElement('a', { href: '/products/product-id' }, children),
			}),
		)

		expect(trigger).toContain('Blue Mug')
		expect(trigger).toContain('text-green-600')
		expect(details).toContain('A detailed mug description')
		expect(details).toContain('12 SATS')
		expect(details).toContain('3 in stock')
		expect(details).toContain('https://images.example/mug.jpg')
		expect(details).toContain('href="/products/product-id"')
	})

	test('renders collection trigger and details from SDK collection fields', () => {
		const trigger = renderToStaticMarkup(createElement(DashboardCollectionTrigger, { collection }))
		const details = renderToStaticMarkup(
			createElement(DashboardCollectionDetails, {
				collection,
				renderImage: (url) => createElement('img', { src: url, alt: 'Collection header' }),
			}),
		)

		expect(trigger).toContain('Mugs')
		expect(details).toContain('Ceramic mugs')
		expect(details).toContain('Collection description')
		expect(details).toContain('>1</span>')
		expect(details).toContain('https://images.example/mugs.jpg')
	})

	test('computes dashboard metrics through SDK visibility and order recipient helpers', () => {
		const markup = renderToStaticMarkup(
			createElement(DashboardOverviewStats, {
				products: [product, { ...product, tags: [...product.tags, ['visibility', 'hidden']] }],
				orders: [{ order: { pubkey: 'buyer', tags: [['p', 'seller']] } }, { order: { pubkey: 'seller', tags: [['p', 'buyer']] } }],
				userPubkey: 'seller',
				conversationCount: 2,
				isLoading: false,
			}),
		)

		expect(markup).toContain('>1</div>')
		expect(markup).toContain('Orders received')
		expect(markup).toContain('Orders placed')
		expect(markup).toContain('>2</div>')
	})
})
