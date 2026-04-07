import { describe, expect, test } from 'bun:test'
import { createProductEvent } from '@/publish/products'

const BASE_FORM_DATA = {
	name: 'Product',
	summary: 'Summary',
	description: 'Description',
	price: '1000',
	quantity: '1',
	currency: 'SATS',
	status: 'on-sale' as const,
	productType: 'single' as const,
	mainCategory: 'Bitcoin',
	selectedCollection: null,
	categories: [],
	images: [{ imageUrl: 'https://example.com/product.png', imageOrder: 0 }],
	specs: [],
	weight: null,
	dimensions: null,
	isNSFW: false,
}

describe('product publish shipping tags', () => {
	test('publish transformation uses canonical shipping refs only', () => {
		const event = createProductEvent(
			{
				...BASE_FORM_DATA,
				shippings: [{ shippingRef: '30406:merchant:standard', extraCost: '5' }],
			},
			{} as any,
			{} as any,
		)

		expect(event.tags).toContainEqual(['shipping_option', '30406:merchant:standard', '5'])
	})

	test('legacy shipping input normalizes to canonical shipping refs before publishing', () => {
		const event = createProductEvent(
			{
				...BASE_FORM_DATA,
				shippings: [
					{
						shipping: {
							id: '30406:merchant:pickup',
							name: 'Local Pickup',
						},
						extraCost: '',
					},
				] as any,
			},
			{} as any,
			{} as any,
		)

		expect(event.tags).toContainEqual(['shipping_option', '30406:merchant:pickup'])
		expect(event.tags.some((tag) => tag[0] === 'shipping_option' && tag[1] === 'Local Pickup')).toBe(false)
	})
})
