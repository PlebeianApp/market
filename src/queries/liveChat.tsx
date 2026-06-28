import { ndkActions } from '@/lib/stores/ndk'
import { type NDKFilter, NDKEvent } from '@nostr-dev-kit/ndk'
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

export const fetchLiveActivity = async (auctionEvent: NDKEvent): Promise<LiveActivity | null> => {
	const dTag = getAuctionId(auctionEvent)
	if (!dTag) return null

	const ndk = ndkActions.getNDK()
	if (!ndk) return null

	const auctionCoord = `${AUCTION_KIND}:${auctionEvent.pubkey}:${dTag}`

	const cvmServerPubkey = configStore.state.config.cvmServerPubkey

	const filter: NDKFilter = {
		kinds: [LIVE_ACTIVITY_KIND_NDK],
		'#a': [auctionCoord],
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

export const useLiveActivity = (auctionEvent: NDKEvent | null) => {
	const dTag = auctionEvent ? getAuctionId(auctionEvent) : ''
	const auctionCoord = auctionEvent && dTag ? `${AUCTION_KIND}:${auctionEvent.pubkey}:${dTag}` : ''

	return useQuery(
		queryOptions({
			queryKey: liveActivityKeys.byCoord(auctionCoord),
			queryFn: () => (auctionEvent ? fetchLiveActivity(auctionEvent) : null),
			enabled: !!auctionEvent && !!dTag,
			// Poll faster (15s) while an auction is planned and approaching its
			// start time, so the live chat activates promptly when the auction
			// goes live instead of waiting up to 60s. (PR #1019 review.)
			refetchInterval: (query) => pickLiveActivityRefetchMs(auctionEvent, query.state.data?.status),
		}),
	)
}

const LIVE_ACTIVITY_FAST_REFETCH_MS = 15_000
const LIVE_ACTIVITY_DEFAULT_REFETCH_MS = 60_000
const NEAR_START_WINDOW_S = 10 * 60

function getAuctionStartsAt(auctionEvent: NDKEvent | null): number {
	const raw = auctionEvent?.tags.find((t) => t[0] === 'start_at')?.[1]
	const parsed = raw ? parseInt(raw, 10) : 0
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function pickLiveActivityRefetchMs(auctionEvent: NDKEvent | null, status?: string): number {
	// Once we know it's planned, poll fast to catch the live transition.
	if (status === 'planned') return LIVE_ACTIVITY_FAST_REFETCH_MS

	// Before the first response (or if status is unknown), poll fast when the
	// auction's start time is within the near-start window — this is exactly
	// the window where the planned->live transition is about to happen.
	const startsAt = getAuctionStartsAt(auctionEvent)
	if (startsAt > 0) {
		const nowS = Math.floor(Date.now() / 1000)
		if (nowS >= startsAt - NEAR_START_WINDOW_S && nowS < startsAt + NEAR_START_WINDOW_S) {
			return LIVE_ACTIVITY_FAST_REFETCH_MS
		}
	}

	return LIVE_ACTIVITY_DEFAULT_REFETCH_MS
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
