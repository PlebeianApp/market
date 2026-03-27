import { ndkActions } from '@/lib/stores/ndk'
import { NDKEvent, type NDKFilter } from '@nostr-dev-kit/ndk'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { commentKeys } from './queryKeyFactory'
import { getCoordinates, getCoordinatesOrId } from '@/lib/nostr/coordinates'
import { isAddressableKind } from 'nostr-tools/kinds'

// NIP-22 Comment Kind
const COMMENT_KIND = 1111

export interface Comment {
	id: string
	authorPubkey: string
	content: string
	createdAt: number
	/** Root of the comment thread, e.g. Product Listing */
	targetEventId: string
	targetEventPubkey: string
	targetEventKind: number
	targetEventCoordinates?: string
	/** Parent comment in event format, if the comment is part of a thread */
	parentComment?: Comment
	children: Comment[]
}

const transformCommentEvent = (event: NDKEvent, eventTarget: NDKEvent, parent?: Comment): Comment => {
	return {
		id: event.id,
		content: event.content,
		authorPubkey: event.pubkey,
		createdAt: event.created_at ?? Math.floor(Date.now() / 1000),
		targetEventId: eventTarget.id,
		targetEventPubkey: eventTarget.pubkey,
		targetEventKind: eventTarget.kind,
		targetEventCoordinates: getCoordinates(eventTarget),
		parentComment: parent,
		children: [],
	}
}

const sortCommentThreadByDate = (thread: Comment) => {
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
	if (isAddressableKind(event.kind) && event.dTag) {
		// Addressable Event
		const coordinates = getCoordinates(event)

		filters.push({
			kinds: [COMMENT_KIND],
			'#a': [coordinates],
		})

		filtersReplies.push({
			kinds: [COMMENT_KIND],
			'#A': [coordinates],
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

	// Transform events into comments, using a map for fast access
	const mapCommentsById = new Map<string, Comment>()
	const mapRepliesById = new Map<string, Comment>()

	// Top-level comments
	events.forEach((e) => mapCommentsById.set(e.id, transformCommentEvent(e, event)))

	// Replies - No parent set for now, those are added with children later
	replies.forEach((e) => mapRepliesById.set(e.id, transformCommentEvent(e, event)))

	// Sort replies into threads - Add children & parents
	replies.forEach((e) => {
		const comment = mapRepliesById.get(e.id)

		if (!comment) return

		const parentId = e.tags.find((t) => t[0] === 'e')?.at(1)
		const parentComment = parentId ? (mapCommentsById.get(parentId) ?? mapRepliesById.get(parentId)) : undefined

		if (parentComment) {
			parentComment.children.push(comment)
			comment.parentComment = parentComment
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
	const targetCoordinates = getCoordinatesOrId(event)

	return useQuery(
		queryOptions({
			queryKey: commentKeys.byProduct(targetCoordinates),
			queryFn: () => fetchProductComments(event),
			enabled: !!targetCoordinates,
		}),
	)
}
