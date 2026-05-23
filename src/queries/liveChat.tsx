import { ndkActions } from '@/lib/stores/ndk'
import { type NDKFilter, NDKEvent } from '@nostr-dev-kit/ndk'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { liveActivityKeys } from './queryKeyFactory'
import {
	LIVE_ACTIVITY_KIND,
	LIVE_CHAT_KIND,
	getLiveActivityCoord,
	parseLiveActivity,
	parseLiveChatMessage,
	type LiveActivity,
	type LiveChatMessage,
} from '@/lib/nip53'
import { getAuctionId } from './auctions'

export const fetchLiveActivity = async (auctionEvent: NDKEvent): Promise<LiveActivity | null> => {
	const dTag = getAuctionId(auctionEvent)
	if (!dTag) return null

	const ndk = ndkActions.getNDK()
	if (!ndk) return null

	const filters: NDKFilter[] = [
		{
			kinds: [LIVE_ACTIVITY_KIND],
			authors: [auctionEvent.pubkey],
			'#d': [dTag],
			limit: 1,
		},
	]

	const events = await ndkActions.fetchEventsWithTimeout(filters, { timeoutMs: 5000 })
	const event = events.size > 0 ? Array.from(events)[0] : null

	if (!event) return null
	return parseLiveActivity(event)
}

export const fetchLiveChatMessages = async (liveActivityCoord: string): Promise<LiveChatMessage[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) return []

	const filters: NDKFilter[] = [
		{
			kinds: [LIVE_CHAT_KIND],
			'#a': [liveActivityCoord],
			limit: 200,
		},
	]

	const events = await ndkActions.fetchEventsWithTimeout(filters, { timeoutMs: 5000 })
	return Array.from(events)
		.map(parseLiveChatMessage)
		.sort((a, b) => a.createdAt - b.createdAt)
}

export const useLiveActivity = (auctionEvent: NDKEvent | null) => {
	const dTag = auctionEvent ? getAuctionId(auctionEvent) : ''
	const coord = auctionEvent && dTag ? getLiveActivityCoord(auctionEvent.pubkey, dTag) : ''

	return useQuery(
		queryOptions({
			queryKey: liveActivityKeys.byCoord(coord),
			queryFn: () => (auctionEvent ? fetchLiveActivity(auctionEvent) : null),
			enabled: !!auctionEvent && !!dTag,
			refetchInterval: 60_000,
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
