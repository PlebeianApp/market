import { ndkActions } from '@/lib/stores/ndk'
import { NDKEvent, type NDKFilter } from '@nostr-dev-kit/ndk'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { commentKeys } from './queryKeyFactory'
import { isAddressableKind } from 'nostr-tools/kinds'

// NIP-22 Comment Kind
const COMMENT_KIND = 1111

export interface Comment {
	id: string
	authorPubkey: string
	content: string
	createdAt: number
	/** Reference to the same comment as an event */
	event: NDKEvent
	/** Root of the comment thread, e.g. Product Listing */
	targetEventId: string
	targetEventPubkey: string
	targetEventKind: number
	targetEventCoordinates?: string
	/** Comment parent Id */
	parentId?: string
}

export interface CommentThread extends Comment {
	parentComment?: Comment
	children: CommentThread[]
}

const transformCommentEvent = (event: NDKEvent, eventTarget: NDKEvent): Comment => {
	const parentId = event.tags.find((t) => t[0] === 'e')?.at(1)
	const coordinates = isAddressableKind(eventTarget.kind) ? eventTarget.tagAddress() : undefined

	return {
		id: event.id,
		content: event.content,
		authorPubkey: event.pubkey,
		createdAt: event.created_at ?? Math.floor(Date.now() / 1000),
		event: event,
		targetEventId: eventTarget.id,
		targetEventPubkey: eventTarget.pubkey,
		targetEventKind: eventTarget.kind,
		targetEventCoordinates: coordinates,
		parentId,
	}
}

const transformCommentEventAsThread = (event: NDKEvent, eventTarget: NDKEvent, parent?: Comment) => {
	return { ...transformCommentEvent(event, eventTarget), parent, children: [] }
}

const sortCommentThreadByDate = (thread: CommentThread) => {
	// Sort thread children
	thread.children.sort((a, b) => a.createdAt - b.createdAt)

	// Recursive call to each child
	thread.children.forEach(sortCommentThreadByDate)
}

/**
 * Fetches NIP-22 comments for a product
 * @param productCoordinates - The product coordinates in format "30018:<pubkey>:<d-tag>"
 */
export const fetchProductComments = async (event: NDKEvent): Promise<Comment[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const filters: NDKFilter[] = []
	const filtersReplies: NDKFilter[] = []

	// Build the filter based on whether the target is addressable or regular
	if (isAddressableKind(event.kind)) {
		// Addressable Event
		const address = event.tagAddress()

		filters.push({
			kinds: [COMMENT_KIND],
			'#a': [address],
		})

		filtersReplies.push({
			kinds: [COMMENT_KIND],
			'#A': [address],
		})
	} else {
		// Regular Event (e.g., Kind 1, 4, etc.)
		filters.push({
			kinds: [COMMENT_KIND],
			'#e': [event.id],
		})

		filtersReplies.push({
			kinds: [COMMENT_KIND],
			'#E': [event.id],
		})
	}

	const [events, replies] = await Promise.all([ndk.fetchEvents(filters), ndk.fetchEvents(filtersReplies)])

	const comments = Array<Comment>()

	events.forEach((e) => comments.push(transformCommentEvent(e, event)))
	replies.forEach((e) => comments.push(transformCommentEvent(e, event)))

	return comments
}

export const transformCommentsMapIntoThreads = (comments: Comment[]): CommentThread[] => {
	// Put comments into map for higher efficiency
	const mapCommentsById = new Map<string, CommentThread>()
	comments.forEach((c) => mapCommentsById.set(c.id, { ...c, children: [] }))

	// Replies - No parent set for now, those are added with children late

	// Sort replies into threads - Add children & parents
	mapCommentsById.forEach((comment) => {
		if (!comment.parentId) return

		const parentComment = mapCommentsById.get(comment.parentId)

		if (parentComment) {
			// If child has parent, add connections
			parentComment.children.push(comment)
			comment.parentComment = parentComment

			// Remove item from map as to only keep top-level parents
			mapCommentsById.delete(comment.id)
		}
	})

	const commentThreads = Array.from(mapCommentsById.values())

	// Sort comments by date
	commentThreads.sort((a, b) => a.createdAt - b.createdAt)

	// Sort threads by date recursively
	commentThreads.forEach(sortCommentThreadByDate)

	return commentThreads
}

/**
 * Hook to fetch comments for a product
 */
export const useComments = (event: NDKEvent) => {
	const targetCoordinates = isAddressableKind(event.kind) ? event.tagAddress() : event.id

	return useQuery(
		queryOptions({
			queryKey: commentKeys.byProduct(targetCoordinates),
			queryFn: () => fetchProductComments(event),
			enabled: !!targetCoordinates,
		}),
	)
}
