import { SHIPPING_KIND, type ShippingOptionSchema } from '@/lib/schemas/shippingOption'
import { COUNTRIES_ISO } from '@/lib/constants'
import { faker } from '@faker-js/faker'
import NDK, { NDKEvent, type NDKPrivateKeySigner, type NDKTag } from '@nostr-dev-kit/ndk'
import type { z } from 'zod'

// Get a subset of country codes for shipping
const COUNTRIES = Object.values(COUNTRIES_ISO)
	.slice(0, 20)
	.map((c) => c.iso3)
const REGIONS = {
	USA: ['US-CA', 'US-NY', 'US-TX', 'US-FL'],
	CAN: ['CA-BC', 'CA-ON', 'CA-QC'],
	GBR: ['GB-ENG', 'GB-SCT', 'GB-WLS'],
	// Add more as needed
}
const CARRIERS = ['FedEx', 'UPS', 'DHL', 'USPS', 'Royal Mail']
const WEIGHT_UNITS = ['kg', 'lb']
const DIMENSION_UNITS = ['cm', 'in']
const DISTANCE_UNITS = ['km', 'mi']

export function generateShippingData(): Omit<z.infer<typeof ShippingOptionSchema>, 'tags'> & { tags: NDKTag[] } {
	const shippingId = faker.string.alphanumeric(10)
	const country = faker.helpers.arrayElement(COUNTRIES)
	const price = faker.number.int({ min: 1, max: 10 }).toString()
	const service = faker.helpers.arrayElement(['standard', 'express', 'overnight', 'pickup'])
	const weightUnit = faker.helpers.arrayElement(WEIGHT_UNITS)
	const dimensionUnit = faker.helpers.arrayElement(DIMENSION_UNITS)

	const tags: NDKTag[] = [
		// Required tags
		['d', shippingId],
		['title', `${faker.helpers.arrayElement(['Standard', 'Express', 'Premium'])} Shipping to ${country}`],
		['price', price, 'sats'],
		['country', country],
		['service', service],

		// Optional tags
		['carrier', faker.helpers.arrayElement(CARRIERS)],
	]

	// Add optional region tag if country has regions
	if (REGIONS[country as keyof typeof REGIONS]) {
		tags.push(['region', faker.helpers.arrayElement(REGIONS[country as keyof typeof REGIONS])])
	}

	// Add duration tag
	tags.push([
		'duration',
		faker.number.int({ min: 1, max: 3 }).toString(),
		faker.number.int({ min: 4, max: 7 }).toString(),
		faker.helpers.arrayElement(['D', 'W']),
	])

	// Add location and geohash
	tags.push(['location', faker.location.city()])
	tags.push(['g', faker.string.alphanumeric(8).toLowerCase()])

	// Add weight constraints
	const minWeight = faker.number.float({ min: 0.1, max: 5, fractionDigits: 1 })
	const maxWeight = faker.number.float({ min: 5, max: 50, fractionDigits: 1 })
	tags.push(['weight-min', minWeight.toString(), weightUnit])
	tags.push(['weight-max', maxWeight.toString(), weightUnit])

	// Add dimension constraints
	const createDimensions = () => {
		return `${faker.number.float({ min: 1, max: 100 })}x${faker.number.float({ min: 1, max: 100 })}x${faker.number.float({ min: 1, max: 100 })}`
	}
	tags.push(['dim-min', createDimensions(), dimensionUnit])
	tags.push(['dim-max', createDimensions(), dimensionUnit])

	// Add price calculations (in sats)
	tags.push(['price-weight', faker.number.int({ min: 1, max: 3 }).toString(), weightUnit])
	tags.push(['price-volume', faker.number.int({ min: 1, max: 2 }).toString(), dimensionUnit])
	tags.push(['price-distance', faker.number.int({ min: 1, max: 2 }).toString(), faker.helpers.arrayElement(DISTANCE_UNITS)])

	return {
		kind: SHIPPING_KIND,
		created_at: Math.floor(Date.now() / 1000),
		content: faker.commerce.productDescription(),
		tags: tags,
	}
}

export async function createShippingEvent(signer: NDKPrivateKeySigner, ndk: NDK, shippingData: ReturnType<typeof generateShippingData>) {
	const event = new NDKEvent(ndk)
	event.kind = shippingData.kind
	event.content = shippingData.content
	event.tags = shippingData.tags
	event.created_at = shippingData.created_at

	try {
		await event.sign(signer)
		await event.publish()
		console.log(`Published shipping option: ${shippingData.tags.find((tag) => tag[0] === 'title')?.[1]}`)
		return true
	} catch (error) {
		console.error(`Failed to publish shipping option`, error)
		return false
	}
}
