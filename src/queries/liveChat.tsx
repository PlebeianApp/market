import { ndkActions } from '@/lib/stores/ndk'
import type { NDKFilter, NDKEvent } from '@nostr-dev-kit/ndk'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { liveActivityKeys } from './queryKeyFactory'
import {
	LIVE_ACTIVITY_KIND,
	LIVE_CHAT_KIND,
	AUCTION_KIND,
	parseLiveActivity,
	parseLiveChatMessage,
	type LiveActivity,
	type LiveChatMessage,
} from '@/lib/nip53'

type NDKKind = NonNullable<NDKFilter['kinds']>[number]
const LIVE_ACTIVITY_KIND_NDK = LIVE_ACTIVITY_KIND as unknown as NDKKind
const LIVE_CHAT_KIND_NDK = LIVE_CHAT_KIND as unknown as NDKKind
import { getAuctionId } from './auctions'
import { configStore } from '@/lib/stores/config'

export const fetchLiveActivity = async (event: NDKEvent): Promise<LiveActivity | null> => {
	const dTag = getAuctionId(event)
	if (!dTag) return null

	const ndk = ndkActions.getNDK()
	if (!ndk) return null

	const coord = `${AUCTION_KIND}:${event.pubkey}:${dTag}`

	const cvmServerPubkey = configStore.state.config.cvmServerPubkey

	const filter: NDKFilter = {
		kinds: [LIVE_ACTIVITY_KIND_NDK],
		'#a': [coord],
		limit: 10,
	}

	if (cvmServerPubkey) {
		filter.authors = [cvmServerPubkey]
	}

	const events = await ndkActions.fetchEventsWithTimeout([filter], { timeoutMs: 5000 })
	if (events.size === 0) return null

	const sorted = Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
	const parsed = parseLiveActivity(sorted[0])

	// NIP-53 stale check: if status=live but event is older than 1hr, treat as ended
	const STALE_THRESHOLD_S = 3600
	const eventAge = Math.floor(Date.now() / 1000) - (sorted[0].created_at ?? 0)
	if (parsed.status === 'live' && eventAge > STALE_THRESHOLD_S) {
		parsed.status = 'ended'
	}

	return parsed
}

export const fetchLiveChatMessages = async (liveActivityCoord: string): Promise<LiveChatMessage[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) return []

	const filters: NDKFilter[] = [
		{
			kinds: [LIVE_CHAT_KIND_NDK],
			'#a': [liveActivityCoord],
			limit: 200,
		},
	]

	const events = await ndkActions.fetchEventsWithTimeout(filters, { timeoutMs: 5000 })
	return Array.from(events)
		.map(parseLiveChatMessage)
		.sort((a, b) => a.createdAt - b.createdAt)
}

export interface UseLiveActivityOptions {
	refetchInterval?: number
}

export const useLiveActivity = (event: NDKEvent | null, options?: UseLiveActivityOptions) => {
	const dTag = event ? getAuctionId(event) : ''
	const coord = event && dTag ? `${AUCTION_KIND}:${event.pubkey}:${dTag}` : ''

	return useQuery(
		queryOptions({
			queryKey: liveActivityKeys.byCoord(coord),
			queryFn: () => (event ? fetchLiveActivity(event) : null),
			enabled: !!event && !!dTag,
			refetchInterval: options?.refetchInterval ?? 60_000,
		}),
	)
}

export const useLiveChatMessages = (liveActivityCoord: string, isActive: boolean) => {
	return useQuery(
		queryOptions({
			queryKey: liveActivityKeys.chatMessages(liveActivityCoord),
			queryFn: () => fetchLiveChatMessages(liveActivityCoord),
			enabled: !!liveActivityCoord,
			refetchInterval: isActive ? 3_000 : 15_000,
		}),
	)
}
