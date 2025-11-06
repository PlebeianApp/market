import { configStore } from '@/lib/stores/config'
import { createProductEvent, type ProductFormData } from '@/publish/products'
import NDK, { type NDKSigner, type NDKTag } from '@nostr-dev-kit/ndk'

/**
 * Publishes a migrated product (NIP-99) with migration tags
 * Adds "migrated" tag with the original NIP-15 event ID
 * Publishes to the app relay
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

	// Get app relay
	const appRelay = configStore.state.config.appRelay
	if (!appRelay) {
		throw new Error('App relay not configured')
	}

	// Ensure app relay is added to NDK
	try {
		const { ndkActions } = await import('@/lib/stores/ndk')
		ndkActions.addExplicitRelay([appRelay])
	} catch (error) {
		console.error('Failed to add app relay:', error)
	}

	// Sign the event
	await event.sign(signer)

	// Publish to app relay specifically
	const relay = ndk.pool?.relays.get(appRelay)
	if (relay) {
		await relay.publish(event)
	} else {
		// Fallback to regular publish if relay not found
		await event.publish()
	}

	return event.id
}

