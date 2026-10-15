import { describe, expect, test } from 'bun:test'
import { getProductCoordinates, getProductId, getProductImages, getProductTitle, isNSFWProduct } from './productReadModel'

const seller = 'a'.repeat(64)

describe('product read model', () => {
	test('uses addressable d-tag identity and standard title fallback', () => {
		const product = { pubkey: seller, tags: [['d', 'coat']] }
		expect(getProductId(product)).toBe('coat')
		expect(getProductCoordinates(product)).toBe(`30402:${seller}:coat`)
		expect(getProductTitle(product)).toBe('Untitled Product')
	})

	test('orders images by the published order tag and recognizes NSFW warning', () => {
		const product = {
			tags: [
				['image', 'second.jpg', '', '2'],
				['image', 'first.jpg', '', '1'],
				['content-warning', 'nsfw'],
			],
		}
		expect(getProductImages(product).map((tag) => tag[1])).toEqual(['first.jpg', 'second.jpg'])
		expect(isNSFWProduct(product)).toBe(true)
	})
})
