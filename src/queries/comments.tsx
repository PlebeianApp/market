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

export const fetchCommentsByProduct = async (productAddress: string): Promise<CommentData[]> => {
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

	const topLevelComments = allEvents.filter(isTopLevelComment)

	const sortedComments = topLevelComments.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))

	return sortedComments.map(parseCommentEvent)
}

export const commentsQueryOptions = (productAddress: string) =>
	queryOptions({
		queryKey: commentKeys.byProduct(productAddress.split(':')[1] || '', productAddress.split(':')[2] || ''),
		queryFn: () => fetchCommentsByProduct(productAddress),
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
