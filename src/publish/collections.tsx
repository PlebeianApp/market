import NDK, { NDKEvent, type NDKSigner } from '@nostr-dev-kit/ndk'

export interface CollectionFormData {
	name: string
	description: string
	headerImageUrl?: string
	products: string[] // Array of product coordinates
}

/**
 * Creates a new collection event (kind 30405)
 */
export const createCollectionEvent = (formData: CollectionFormData, signer: NDKSigner, ndk: NDK, collectionId?: string): NDKEvent => {
	const event = new NDKEvent(ndk)
	event.kind = 30405 // Collections kind
	event.content = formData.description

	// Generate a unique ID if not provided (for new collections)
	const id = collectionId || crypto.randomUUID()

	// Required tags
	event.tags = [
		['d', id], // Collection identifier
		['title', formData.name],
	]

	// Optional header image
	if (formData.headerImageUrl) {
		event.tags.push(['image', formData.headerImageUrl])
	}

	// Add product references
	formData.products.forEach((productCoords) => {
		event.tags.push(['a', productCoords])
	})

	return event
}

/**
 * Publishes a new collection
 */
export const publishCollection = async (formData: CollectionFormData, signer: NDKSigner, ndk: NDK): Promise<string | null> => {
	try {
		const event = createCollectionEvent(formData, signer, ndk)
		await event.sign(signer)
		await event.publish()

		// Return the collection ID
		const dTag = event.tags.find((tag) => tag[0] === 'd')
		return dTag?.[1] || null
	} catch (error) {
		console.error('Error publishing collection:', error)
		throw error
	}
}

/**
 * Updates an existing collection
 */
export const updateCollection = async (
	collectionId: string,
	formData: CollectionFormData,
	signer: NDKSigner,
	ndk: NDK,
): Promise<string | null> => {
	try {
		const event = createCollectionEvent(formData, signer, ndk, collectionId)
		await event.sign(signer)
		await event.publish()

		return collectionId
	} catch (error) {
		console.error('Error updating collection:', error)
		throw error
	}
}

/**
 * Deletes a collection by publishing a deletion event
 */
export const deleteCollection = async (collectionId: string, signer: NDKSigner, ndk: NDK): Promise<boolean> => {
	try {
		// Create a deletion event (kind 5)
		const deleteEvent = new NDKEvent(ndk)
		deleteEvent.kind = 5
		deleteEvent.content = 'Collection deleted'

		// Reference the collection to delete
		const pubkey = await signer.user().then((user) => user.pubkey)
		deleteEvent.tags = [['a', `30405:${pubkey}:${collectionId}`]]

		await deleteEvent.sign(signer)
		await deleteEvent.publish()

		return true
	} catch (error) {
		console.error('Error deleting collection:', error)
		throw error
	}
}
