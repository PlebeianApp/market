import { ndkActions } from '@/lib/stores/ndk'
import { commentKeys } from './queryKeyFactory'
import { queryOptions, useQuery } from '@tanstack/react-query'
import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'

// NIP-22 Comment kind
const COMMENT_KIND = 1111

export interface ProductComment {
	id: string
	content: string
	authorPubkey: string
	createdAt: number
	parentId?: string // For threaded replies
}

const transformCommentEvent = (event: NDKEvent): ProductComment => {
	// Get parent event id if this is a reply to another comment
	const parentTag = event.tags.find((t) => t[0] === 'e' && event.tags.some((kt) => kt[0] === 'k' && kt[1] === '1111'))
	const parentId = parentTag?.[1]

	return {
		id: event.id,
		content: event.content,
		authorPubkey: event.pubkey,
		createdAt: event.created_at ?? Math.floor(Date.now() / 1000),
		parentId,
	}
}

/**
 * Fetches NIP-22 comments for a product
 * @param productCoordinates - The product coordinates in format "30018:<pubkey>:<d-tag>"
 */
export const fetchProductComments = async (productCoordinates: string): Promise<ProductComment[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	// NIP-22 comments reference the root with an A tag for addressable events
	const filter: NDKFilter = {
		kinds: [COMMENT_KIND],
		'#A': [productCoordinates],
	}

	const events = await ndk.fetchEvents(filter)
	const comments = Array.from(events).map(transformCommentEvent)

	// Sort by oldest first (chronological order for comments)
	return comments.sort((a, b) => a.createdAt - b.createdAt)
}

export const productCommentsQueryOptions = (productCoordinates: string) =>
	queryOptions({
		queryKey: commentKeys.byProduct(productCoordinates),
		queryFn: () => fetchProductComments(productCoordinates),
		enabled: !!productCoordinates,
	})

/**
 * Hook to fetch comments for a product
 */
export const useProductComments = (productCoordinates: string) => {
	return useQuery(productCommentsQueryOptions(productCoordinates))
}
