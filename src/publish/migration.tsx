import { createProductEvent, type ProductFormData } from '@/publish/products'
import NDK, { type NDKSigner, type NDKTag } from '@nostr-dev-kit/ndk'

/**
 * Publishes a migrated product (NIP-99) with migration tags
 * Adds "migrated" tag with the original NIP-15 event ID
 * Publishes to user's relays (same as regular products)
 */
export const publishMigratedProduct = async (
	formData: ProductFormData,
	originalNip15EventId: string,
	signer: NDKSigner,
	ndk: NDK,
): Promise<string> => {
	// Validation
	if (!formData.name.trim()) {
		throw new Error('Product name is required')
	}

	if (!formData.description.trim()) {
		throw new Error('Product description is required')
	}

	if (!formData.price.trim() || isNaN(Number(formData.price))) {
		throw new Error('Valid product price is required')
	}

	if (!formData.quantity.trim() || isNaN(Number(formData.quantity))) {
		throw new Error('Valid product quantity is required')
	}

	if (formData.images.length === 0) {
		throw new Error('At least one product image is required')
	}

	if (!formData.mainCategory) {
		throw new Error('Main category is required')
	}

	// Create the product event
	const event = createProductEvent(formData, signer, ndk)

	// Add migration tags
	event.tags.push(['migrated', originalNip15EventId] as NDKTag)

	// Sign and publish to user's relays (same as regular products)
	await event.sign(signer)
	await event.publish()

	return event.id
}
