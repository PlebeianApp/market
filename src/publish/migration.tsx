import { createProductEvent, type ProductFormData } from '@/publish/products'
import { ndkActions, getWriteRelaySet, getWriteRelays } from '@/lib/stores/ndk'
import NDK, { type NDKSigner, type NDKTag, type NDKRelay } from '@nostr-dev-kit/ndk'

export type MigrationStep = 'preparing' | 'signing' | 'publishing' | 'done'

export interface MigrationProgress {
	step: MigrationStep
	relayUrl?: string
	relayStatus?: 'pending' | 'success' | 'error'
	relayUrls?: string[]
}

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
	onProgress?: (progress: MigrationProgress) => void,
): Promise<string> => {
	onProgress?.({ step: 'preparing' })

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

	// Sign the event
	onProgress?.({ step: 'signing' })
	await event.sign(signer)

	// Get relay URLs for progress tracking
	const relaySet = getWriteRelaySet()
	const relayUrls = relaySet ? Array.from(relaySet.relays).map((r) => r.url) : getWriteRelays()

	// Notify that we're starting to publish with the list of relays
	onProgress?.({ step: 'publishing', relayUrls })

	// Listen for per-relay publish events
	const publishHandler = (relay: NDKRelay) => {
		onProgress?.({
			step: 'publishing',
			relayUrl: relay.url,
			relayStatus: 'success',
		})
	}
	event.on('relay:published', publishHandler)

	try {
		// Publish to relays
		await ndkActions.publishEvent(event)
	} finally {
		// Clean up event listener
		event.off('relay:published', publishHandler)
	}

	onProgress?.({ step: 'done' })

	return event.id
}
