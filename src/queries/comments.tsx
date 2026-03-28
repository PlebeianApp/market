import { COMMENT_KIND, PRODUCT_KIND, getCommentAuthor, getCommentParentId, getCommentRootAddress } from '@/lib/schemas/productComment'
import { ndkActions } from '@/lib/stores/ndk'
import type { NDKFilter } from '@nostr-dev-kit/ndk'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { commentKeys } from './queryKeyFactory'

export { commentKeys }

export interface CommentData {
	id: string
	pubkey: string
	authorPubkey: string
	content: string
	createdAt: number
	productAddress: string
	parentId?: string
	replies?: CommentData[]
}

const parseCommentEvent = (event: NDKEvent): CommentData => {
	const authorPubkey = getCommentAuthor(event) ?? event.pubkey
	const productAddress = getCommentRootAddress(event) ?? ''
	const parentId = getCommentParentId(event)

	return {
		id: event.id,
		pubkey: event.pubkey,
		authorPubkey,
		content: event.content,
		createdAt: event.created_at ?? Math.floor(Date.now() / 1000),
		productAddress,
		parentId,
	}
}

const isTopLevelComment = (event: NDKEvent): boolean => {
	const hasParentKind = event.tags.some((t) => t[0] === 'k')
	return !hasParentKind
}

const sortByCreatedAt = (comments: CommentData[]): void => {
	comments.sort((a, b) => a.createdAt - b.createdAt)
	for (const comment of comments) {
		if (comment.replies && comment.replies.length > 0) {
			sortByCreatedAt(comment.replies)
		}
	}
}

export const fetchAllCommentsByProduct = async (productAddress: string): Promise<CommentData[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) {
		console.warn('NDK not ready, returning empty comments list')
		return []
	}

	const filter: NDKFilter = {
		kinds: [COMMENT_KIND],
		'#A': [productAddress],
		limit: 100,
	}

	const events = await ndkActions.fetchEventsWithTimeout(filter, { timeoutMs: 8000 })
	const allEvents = Array.from(events)

	const commentMap = new Map<string, CommentData>()
	const topLevelComments: CommentData[] = []

	for (const event of allEvents) {
		const comment: CommentData = { ...parseCommentEvent(event), replies: [] }
		commentMap.set(comment.id, comment)
	}

	const commentArray = Array.from(commentMap.values())
	for (const comment of commentArray) {
		if (comment.parentId) {
			const parent = commentMap.get(comment.parentId)
			if (parent) {
				parent.replies!.push(comment)
			} else {
				topLevelComments.push(comment)
			}
		} else {
			topLevelComments.push(comment)
		}
	}

	sortByCreatedAt(topLevelComments)

	topLevelComments.sort((a, b) => b.createdAt - a.createdAt)

	return topLevelComments
}

export const commentsQueryOptions = (productAddress: string) =>
	queryOptions({
		queryKey: commentKeys.byProduct(productAddress.split(':')[1] || '', productAddress.split(':')[2] || ''),
		queryFn: () => fetchAllCommentsByProduct(productAddress),
		staleTime: 60000,
		refetchInterval: 30000,
	})

export const useComments = (productAddress: string) => {
	return useQuery({
		...commentsQueryOptions(productAddress),
		enabled: !!productAddress,
	})
}

export const getProductCommentAddress = (productPubkey: string, productDTag: string): string => {
	return `${PRODUCT_KIND}:${productPubkey}:${productDTag}`
}
