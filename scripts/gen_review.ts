import type { ProductReviewSchema } from '@/lib/schemas/productReview'
import { faker } from '@faker-js/faker'
import NDK, { NDKEvent, type NDKPrivateKeySigner, type NDKTag } from '@nostr-dev-kit/ndk'
import type { z } from 'zod'

/**
 * Creates a product reference string in the format a:30402:pubkey:d-identifier
 */
export function createProductReference(pubkey: string, identifier: string): string {
	return `a:30402:${pubkey}:${identifier}`
}

export function generateReviewData(productRefs: string[]): Omit<z.infer<typeof ProductReviewSchema>, 'tags'> & { tags: NDKTag[] } {
	// Select a random product reference from the available ones
	const productRef = faker.helpers.arrayElement(productRefs)

	// Generate a primary "thumb" rating (0 to 1)
	const thumbRating = faker.number.float({ min: 0, max: 1, fractionDigits: 1 }).toString()

	// Generate 1-3 additional category ratings
	const categories = ['quality', 'value', 'shipping', 'customer_service', 'appearance']
	const selectedCategories = faker.helpers.arrayElements(categories, faker.number.int({ min: 1, max: 3 }))

	const categoryRatings = selectedCategories.map((category) => {
		return ['rating', faker.number.float({ min: 0, max: 1, fractionDigits: 1 }).toString(), category] as NDKTag
	})

	// Generate review content
	const reviewContent = faker.helpers.arrayElement([
		faker.lorem.paragraph(),
		`${faker.lorem.sentence()} ${faker.lorem.paragraph()} ${faker.lorem.sentence()}`,
		faker.lorem.paragraphs(2),
	])

	return {
		kind: 31555,
		created_at: Math.floor(Date.now() / 1000),
		content: reviewContent,
		tags: [['d', productRef], ['rating', thumbRating, 'thumb'], ...categoryRatings] as NDKTag[],
	}
}

export async function createReviewEvent(signer: NDKPrivateKeySigner, ndk: NDK, reviewData: ReturnType<typeof generateReviewData>) {
	const event = new NDKEvent(ndk)
	event.kind = reviewData.kind
	event.content = reviewData.content
	event.tags = reviewData.tags
	event.created_at = reviewData.created_at

	try {
		await event.sign(signer)
		await event.publish()
		console.log(`Published review for product: ${reviewData.tags.find((tag) => tag[0] === 'd')?.[1]}`)
		return true
	} catch (error) {
		console.error(`Failed to publish review`, error)
		return false
	}
}
