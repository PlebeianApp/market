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

	// Fail closed: only accept live activity events from the expected CVM server.
	// The integrated boot path requires this identity before rendering the app.
	const cvmServerPubkey = configStore.state.config.cvmServerPubkey
	if (!cvmServerPubkey) {
		console.warn('fetchLiveActivity: cvmServerPubkey not configured — skipping live activity fetch')
		return null
	}

	const filter: NDKFilter = {
		kinds: [LIVE_ACTIVITY_KIND_NDK],
		authors: [cvmServerPubkey],
		'#a': [coord],
		limit: 10,
	}

	const events = await ndkActions.fetchEventsWithTimeout([filter], { timeoutMs: 5000 })
	if (events.size === 0) return null

	const sorted = Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
	return parseLiveActivity(sorted[0])
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
