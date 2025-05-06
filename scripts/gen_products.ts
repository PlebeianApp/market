import { CURRENCIES } from '@/lib/constants'
import type { ProductListingSchema } from '@/lib/schemas/productListing'
import { faker } from '@faker-js/faker'
import NDK, { NDKEvent, type NDKPrivateKeySigner, type NDKTag } from '@nostr-dev-kit/ndk'
import type { z } from 'zod'

export function generateProductData(): Omit<z.infer<typeof ProductListingSchema>, 'tags'> & { tags: NDKTag[] } {
	const productId = faker.string.alphanumeric(10)
	const price = faker.number.float({ min: 1, max: 1000, fractionDigits: 2 }).toString()
	const numImages = faker.number.int({ min: 2, max: 5 })
	const images = Array.from({ length: numImages }, (_, i) => ['image', faker.image.url(), '800x600', i.toString()] as NDKTag)

	return {
		kind: 30402,
		created_at: Math.floor(Date.now() / 1000),
		content: faker.commerce.productDescription(),
		tags: [
			['d', productId],
			['title', faker.commerce.productName()],
			['price', price, faker.helpers.arrayElement(CURRENCIES)],
			['type', 'simple', 'physical'],
			['visibility', 'on-sale'],
			['stock', faker.number.int({ min: 1, max: 100 }).toString()],
			['summary', faker.commerce.productDescription()],
			['spec', 'color', faker.color.human()],
			['spec', 'material', faker.commerce.productMaterial()],
			...images,
			['weight', faker.number.float({ min: 0.1, max: 10, fractionDigits: 1 }).toString(), 'kg'],
			[
				'dim',
				`${faker.number.float({ min: 1, max: 50 })}x${faker.number.float({ min: 1, max: 50 })}x${faker.number.float({ min: 1, max: 50 })}`,
				'cm',
			],
			['location', faker.location.city()],
			['g', faker.string.alphanumeric(8).toLowerCase()],
			['t', faker.commerce.department()],
		] as NDKTag[],
	}
}

export async function createProductEvent(signer: NDKPrivateKeySigner, ndk: NDK, productData: ReturnType<typeof generateProductData>) {
	const event = new NDKEvent(ndk)
	event.kind = productData.kind
	event.content = productData.content
	event.tags = productData.tags
	event.created_at = productData.created_at

	try {
		await event.sign(signer)
		await event.publish()
		console.log(`Published product: ${productData.tags.find((tag) => tag[0] === 'title')?.[1]}`)
		return true
	} catch (error) {
		console.error(`Failed to publish product`, error)
		return false
	}
}
