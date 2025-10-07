import { CURRENCIES, PRODUCT_CATEGORIES } from '@/lib/constants'
import type { ProductListingSchema } from '@/lib/schemas/productListing'
import { faker } from '@faker-js/faker'
import NDK, { NDKEvent, type NDKPrivateKeySigner, type NDKTag } from '@nostr-dev-kit/ndk'
import type { z } from 'zod'

export function generateProductData(
	availableShippingRefs?: string[],
	visibility: 'hidden' | 'on-sale' | 'pre-order' = 'on-sale',
): Omit<z.infer<typeof ProductListingSchema>, 'tags'> & { tags: NDKTag[] } {
	const productId = faker.string.alphanumeric(10)
	const price = faker.number.int({ min: 1, max: 20 }).toString()
	const numImages = faker.number.int({ min: 2, max: 5 })
	const images = Array.from(
		{ length: numImages },
		(_, i) => ['image', faker.image.urlPicsumPhotos({ width: 1200, height: 400 }), '800x600', i.toString()] as NDKTag,
	)

	// Add shipping options if available (randomly select 1-3 shipping options)
	const shippingTags: NDKTag[] = []
	if (availableShippingRefs && availableShippingRefs.length > 0) {
		const numShippingOptions = faker.number.int({ min: 1, max: Math.min(3, availableShippingRefs.length) })
		const selectedShipping = faker.helpers.arrayElements(availableShippingRefs, numShippingOptions)

		selectedShipping.forEach((shippingRef) => {
			// Randomly add extra cost for some shipping options
			const hasExtraCost = faker.datatype.boolean(0.3) // 30% chance of extra cost
			if (hasExtraCost) {
				const extraCost = faker.number.int({ min: 1, max: 5 }).toString()
				shippingTags.push(['shipping_option', shippingRef, extraCost])
			} else {
				shippingTags.push(['shipping_option', shippingRef])
			}
		})
	}

	// Generate category tags: at least one from PRODUCT_CATEGORIES, optionally 0-3 more random ones
	const categoryTags: NDKTag[] = []

	// Always add at least one category from PRODUCT_CATEGORIES
	const defaultCategory = faker.helpers.arrayElement([...PRODUCT_CATEGORIES])
	categoryTags.push(['t', defaultCategory])

	// Optionally add 0-3 additional random category tags
	const numAdditionalTags = faker.number.int({ min: 0, max: 3 })
	for (let i = 0; i < numAdditionalTags; i++) {
		categoryTags.push(['t', faker.commerce.department()])
	}

	return {
		kind: 30402,
		created_at: Math.floor(Date.now() / 1000),
		content: faker.commerce.productDescription(),
		tags: [
			['d', productId],
			['title', faker.commerce.productName()],
			['price', price, 'sats'],
			['type', 'simple', 'physical'],
			['visibility', visibility],
			['stock', faker.number.int({ min: 1, max: 100 }).toString()],
			['summary', faker.commerce.productDescription()],
			['spec', 'color', faker.color.human()],
			['spec', 'material', faker.commerce.productMaterial()],
			...images,
			...shippingTags,
			['weight', faker.number.float({ min: 0.1, max: 10, fractionDigits: 1 }).toString(), 'kg'],
			[
				'dim',
				`${faker.number.float({ min: 1, max: 50 })}x${faker.number.float({ min: 1, max: 50 })}x${faker.number.float({ min: 1, max: 50 })}`,
				'cm',
			],
			['location', faker.location.city()],
			['g', faker.string.alphanumeric(8).toLowerCase()],
			...categoryTags,
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
