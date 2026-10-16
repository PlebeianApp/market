import { describe, expect, test } from 'bun:test'
import { buildSellerProductEventData, validateSellerProductForPublish, type SellerProductListingInput } from './productListingWorkflow'

const form: SellerProductListingInput = {
	name: 'Coat',
	summary: 'Warm',
	description: 'A warm coat',
	price: '1200',
	quantity: '4',
	currency: 'SATS',
	status: 'on-sale',
	productType: 'single',
	mainCategory: 'clothing',
	selectedCollection: '30405:seller:summer',
	categories: [
		{ key: 'winter', name: 'winter', checked: true },
		{ key: 'unchecked', name: 'ignored', checked: false },
	],
	images: [{ imageUrl: 'https://example.test/coat.png', imageOrder: 0 }],
	specs: [{ key: 'size', value: 'M' }],
	shippings: [{ shippingRef: '30406:seller:standard', extraCost: '10' }],
	weight: { value: '2', unit: 'kg' },
	dimensions: null,
	isNSFW: false,
}

describe('seller product listing workflow', () => {
	test('validates using existing create/update constraints and issue order', () => {
		expect(validateSellerProductForPublish(form).ok).toBe(true)
		expect(validateSellerProductForPublish({ ...form, name: ' ', price: '' })).toEqual({ ok: false, issue: 'product-name-required' })
		expect(validateSellerProductForPublish({ ...form, shippings: [] })).toEqual({ ok: false, issue: 'product-shipping-required' })
	})

	test('builds current product event kind/tags and adds host-provided client tag last', () => {
		expect(buildSellerProductEventData(form, 'product-1', { clientTag: ['client', 'market', 'handler'] })).toEqual({
			kind: 30402,
			content: 'A warm coat',
			tags: [
				['d', 'product-1'],
				['title', 'Coat'],
				['price', '1200', 'SATS'],
				['type', 'simple', 'physical'],
				['visibility', 'on-sale'],
				['stock', '4'],
				['summary', 'Warm'],
				['image', 'https://example.test/coat.png', '800x600', '0'],
				['t', 'clothing'],
				['t', 'winter'],
				['spec', 'size', 'M'],
				['shipping_option', '30406:seller:standard', '10'],
				['weight', '2', 'kg'],
				['collection', '30405:seller:summer'],
				['client', 'market', 'handler'],
			],
		})
	})
})
