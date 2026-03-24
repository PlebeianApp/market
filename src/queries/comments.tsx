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

// Comment threads formatting

export interface ProductCommentThread extends ProductComment {
	children: ProductCommentThread[]
}

const sortCommentThreadByDate = (thread: ProductCommentThread) => {
	// Sort thread children
	thread.children.sort((a, b) => a.createdAt - b.createdAt)

	// Recursive call to each child
	thread.children.forEach(sortCommentThreadByDate)
}

const sortCommentsIntoThreads = (comments: ProductComment[]): ProductCommentThread[] => {
	// Create a map based on comment ids for fast access
	const mapIdentifiers = new Map<string, ProductCommentThread>()
	comments.forEach((c) => mapIdentifiers.set(c.id, { ...c, children: [] }))

	// Initialize threads map
	const threads: ProductCommentThread[] = []

	// For each comment:
	for (const comment of comments) {
		// Get comment from map to apply / keep children
		const commentThreadable = mapIdentifiers.get(comment.id) ?? { children: [], ...comment }

		if (comment.parentId) {
			// If comment has parent id, then add that comment to the parent comment's thread
			const parentComment = mapIdentifiers.get(comment.parentId)
			parentComment?.children.push(commentThreadable)
		} else {
			// Else, comment becomes its own thread
			threads.push(commentThreadable)
		}
	}

	return threads
}

/**
 * Fetches NIP-22 comments for a product
 * @param productCoordinates - The product coordinates in format "30018:<pubkey>:<d-tag>"
 */
export const fetchProductComments = async (productCoordinates: string): Promise<ProductCommentThread[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	// NIP-22 comments reference the root with an A tag for addressable events
	const filter: NDKFilter = {
		kinds: [COMMENT_KIND],
		'#A': [productCoordinates],
	}

	const events = await ndk.fetchEvents(filter)
	const comments = Array.from(events).map(transformCommentEvent)

	// Sort comments into threads
	const threads = sortCommentsIntoThreads(comments)

	// Sort threads by date recursively
	threads.forEach(sortCommentThreadByDate)

	return threads
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
