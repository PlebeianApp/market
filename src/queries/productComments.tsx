import { filterBlacklistedEvents } from '@/lib/utils/blacklistFilters'
import { MAX_COMMENT_LENGTH, isValidTopLevelComment, PRODUCT_COMMENT_KIND } from '@/lib/schemas/productComment'
import { ndkActions } from '@/lib/stores/ndk'
import { productCommentKeys } from './queryKeyFactory'
import { queryOptions, useQuery } from '@tanstack/react-query'
import type { NDKFilter, NDKEvent } from '@nostr-dev-kit/ndk'

export { MAX_COMMENT_LENGTH }

export const fetchProductComments = async (productCoords: string, merchantPubkey: string): Promise<NDKEvent[]> => {
	if (!productCoords || !merchantPubkey) return []

	const ndk = ndkActions.getNDK()
	if (!ndk) {
		console.warn('NDK not ready, returning empty product comments list')
		return []
	}

	const filter: NDKFilter = {
		kinds: [PRODUCT_COMMENT_KIND],
		'#a': [productCoords],
		limit: 100,
	}

	const events = await ndkActions.fetchEventsWithTimeout(filter, { timeoutMs: 8000 })
	const filtered = filterBlacklistedEvents(Array.from(events)).filter((event) =>
		isValidTopLevelComment(event, productCoords, merchantPubkey),
	)
	const dedupedById = new Map<string, NDKEvent>()

	for (const event of filtered) {
		if (!event.id) continue
		const existing = dedupedById.get(event.id)
		if (!existing || (event.created_at ?? 0) >= (existing.created_at ?? 0)) {
			dedupedById.set(event.id, event)
		}
	}

	return Array.from(dedupedById.values()).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
}

export const productCommentsQueryOptions = (productCoords: string, merchantPubkey: string) =>
	queryOptions({
		queryKey: productCommentKeys.list(productCoords),
		queryFn: () => fetchProductComments(productCoords, merchantPubkey),
		enabled: !!productCoords && !!merchantPubkey,
		staleTime: 30000,
	})

export const useProductComments = (productCoords: string, merchantPubkey: string) =>
	useQuery(productCommentsQueryOptions(productCoords, merchantPubkey))
