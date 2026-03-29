import { MAX_COMMENT_LENGTH, PRODUCT_COMMENT_KIND } from '@/lib/schemas/productComment'
import { ndkActions } from '@/lib/stores/ndk'
import NDK, { NDKEvent, type NDKTag } from '@nostr-dev-kit/ndk'

export type PublishedProductCommentId = string

export const createProductCommentEvent = (productCoords: string, merchantPubkey: string, content: string, ndk: NDK): NDKEvent => {
	const event = new NDKEvent(ndk)
	event.kind = PRODUCT_COMMENT_KIND
	event.content = content
	event.tags = [
		['A', productCoords],
		['K', '30402'],
		['P', merchantPubkey],
		['a', productCoords],
		['k', '30402'],
		['p', merchantPubkey],
	] satisfies NDKTag[]
	return event
}

/**
 * Publishes a comment and returns the signed comment event id.
 */
export const publishProductComment = async (
	productCoords: string,
	merchantPubkey: string,
	rawContent: string,
): Promise<PublishedProductCommentId> => {
	const content = rawContent.trim()
	if (!productCoords) throw new Error('Product coordinates are required')
	if (!merchantPubkey) throw new Error('Merchant pubkey is required')
	if (!content) throw new Error('Comment cannot be empty')
	if (content.length > MAX_COMMENT_LENGTH) throw new Error(`Comment cannot exceed ${MAX_COMMENT_LENGTH} characters`)

	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	if (!ndk) throw new Error('NDK not initialized')
	if (!signer) throw new Error('No signer available')

	const event = createProductCommentEvent(productCoords, merchantPubkey, content, ndk)
	await event.sign(signer)
	await ndkActions.publishEvent(event)
	if (!event.id) throw new Error('Comment publish did not produce an event id')

	return event.id
}
