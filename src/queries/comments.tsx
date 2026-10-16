import { ndkActions } from '@/lib/stores/ndk'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { commentKeys } from './queryKeyFactory'
import {
	buildCommentFilters,
	buildCommentThreads,
	getCommentTargetKey,
	mergeCommentEvents,
	type CommentRecord,
	type CommentThreadRecord,
} from '@sdk/commerce/messaging'

export { MAX_COMMENT_THREAD_DEPTH } from '@sdk/commerce/messaging'

export type Comment = CommentRecord<NDKEvent>

export type CommentThread = CommentThreadRecord<NDKEvent>

/**
 * Fetches NIP-22 comments for a product
 * @param productCoordinates - The product coordinates in format "30018:<pubkey>:<d-tag>"
 */
export const fetchProductComments = async (event: NDKEvent): Promise<Comment[]> => {
	const { filters, replyFilters, fallbackFilters } = buildCommentFilters(event)

	const [events, replies, fallbackEvents] = await Promise.all([
		ndkActions.fetchEventsWithTimeout(filters, { timeoutMs: 8000 }),
		ndkActions.fetchEventsWithTimeout(replyFilters, { timeoutMs: 8000 }),
		fallbackFilters ? ndkActions.fetchEventsWithTimeout(fallbackFilters, { timeoutMs: 8000 }) : Promise.resolve(new Set<NDKEvent>()),
	])

	return mergeCommentEvents(event, events, replies, fallbackEvents)
}

export const transformCommentsMapIntoThreads = (comments: Comment[]): CommentThread[] => buildCommentThreads(comments)

/**
 * Hook to fetch comments for a product
 */
export const useComments = (event: NDKEvent) => {
	const targetCoordinates = getCommentTargetKey(event)

	return useQuery(
		queryOptions({
			queryKey: commentKeys.byProduct(targetCoordinates),
			queryFn: () => fetchProductComments(event),
			enabled: !!targetCoordinates,
		}),
	)
}
