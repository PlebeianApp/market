import { faker } from '@faker-js/faker'
import NDK, { NDKEvent, type NDKPrivateKeySigner, type NDKTag } from '@nostr-dev-kit/ndk'

/**
 * NIP-15 product data structure
 */
export interface Nip15ProductData {
	id: string
	stall_id: string
	name: string
	description?: string
	images?: string[]
	currency: string
	price: number
	quantity: number | null
	specs?: Array<[string, string]>
	shipping?: Array<{
		id: string
		cost: number
	}>
}

/**
 * Generates NIP-15 product data (kind 30018)
 */
export function generateNip15ProductData(stallId: string, shippingZoneIds?: string[]): Nip15ProductData {
	const productId = faker.string.alphanumeric(10)
	const numImages = faker.number.int({ min: 1, max: 4 })
	const images = Array.from({ length: numImages }, () => faker.image.urlPicsumPhotos({ width: 1200, height: 400 }))

	// Generate specs (0-3 specs)
	const numSpecs = faker.number.int({ min: 0, max: 3 })
	const specs: Array<[string, string]> = []
	if (numSpecs > 0) {
		specs.push(['color', faker.color.human()])
		if (numSpecs > 1) {
			specs.push(['material', faker.commerce.productMaterial()])
		}
		if (numSpecs > 2) {
			specs.push(['size', faker.helpers.arrayElement(['Small', 'Medium', 'Large', 'XL'])])
		}
	}

	// Generate shipping costs if shipping zones are provided
	const shipping: Array<{ id: string; cost: number }> = []
	if (shippingZoneIds && shippingZoneIds.length > 0) {
		// Randomly select 1-2 shipping zones
		const selectedZones = faker.helpers.arrayElements(shippingZoneIds, {
			min: 1,
			max: Math.min(2, shippingZoneIds.length),
		})
		selectedZones.forEach((zoneId) => {
			shipping.push({
				id: zoneId,
				cost: faker.number.float({ min: 0, max: 10, fractionDigits: 2 }),
			})
		})
	}

	return {
		id: productId,
		stall_id: stallId,
		name: faker.commerce.productName(),
		description: faker.commerce.productDescription(),
		images,
		currency: faker.helpers.arrayElement(['USD', 'EUR', 'BTC', 'SATS']),
		price: faker.number.float({ min: 1, max: 100, fractionDigits: 2 }),
		quantity: faker.datatype.boolean(0.8) ? faker.number.int({ min: 1, max: 100 }) : null, // 80% chance of having quantity
		specs: specs.length > 0 ? specs : undefined,
		shipping: shipping.length > 0 ? shipping : undefined,
	}
}

/**
 * Creates and publishes a NIP-15 product event (kind 30018)
 */
export async function createNip15ProductEvent(
	signer: NDKPrivateKeySigner,
	ndk: NDK,
	productData: Nip15ProductData,
	category?: string,
): Promise<boolean> {
	const event = new NDKEvent(ndk)
	event.kind = 30018 // NIP-15 product kind
	event.content = JSON.stringify(productData)

	// Build tags
	const tags: NDKTag[] = [['d', productData.id]]

	// Add category tag if provided
	if (category) {
		tags.push(['t', category])
	}

	event.tags = tags

	// Set created_at to be in the past (older than NIP-99 products)
	event.created_at = Math.floor(Date.now() / 1000) - faker.number.int({ min: 86400, max: 2592000 }) // 1-30 days ago

	try {
		await event.sign(signer)
		await event.publish()
		console.log(`Published NIP-15 product: ${productData.name}`)
		return true
	} catch (error) {
		console.error(`Failed to publish NIP-15 product`, error)
		return false
	}
}
