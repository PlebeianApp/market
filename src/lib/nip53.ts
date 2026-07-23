export const LIVE_ACTIVITY_KIND = 30311
export const LIVE_CHAT_KIND = 1311
export const AUCTION_KIND = 30408
export type LiveActivityStatus = 'planned' | 'live' | 'ended'

export interface LiveActivity {
	coord: string
	activityOwnerPubkey: string
	sellerPubkey: string
	dTag: string
	title: string
	summary: string
	image: string | undefined
	status: LiveActivityStatus
	starts: number
	ends: number
	relays: string[]
}

export interface LiveChatMessage {
	id: string
	authorPubkey: string
	content: string
	createdAt: number
	event: any
}

export function deriveLiveActivityStatus(startsAt: number, maxEndAt: number, now?: number): LiveActivityStatus {
	const t = now ?? Math.floor(Date.now() / 1000)
	if (startsAt > 0 && t < startsAt) return 'planned'
	if (maxEndAt > 0 && t >= maxEndAt) return 'ended'
	return 'live'
}

/**
 * Resolve the effective availability status of a live activity, using auction
 * timestamps as hard boundaries. Relay-reported status is only accepted WITHIN
 * those boundaries:
 *
 * - Before `startsAt`: always 'planned' (relay 'live' cannot open chat early)
 * - After `biddingCutoffAt`: always 'ended' (relay 'live' cannot extend chat)
 * - Between starts and cutoff: accept relay status if present, else derive from timestamps
 *
 * If no relay activity exists, falls back to timestamp-derived status.
 * If relay activity exists but its status is outside the boundary, the boundary wins.
 */
export function resolveLiveActivityStatus(
	relayStatus: LiveActivityStatus | null,
	startsAt: number,
	biddingCutoffAt: number,
	now?: number,
): LiveActivityStatus {
	const t = now ?? Math.floor(Date.now() / 1000)

	// Hard boundary: before start → always planned
	if (startsAt > 0 && t < startsAt) return 'planned'

	// Hard boundary: past bidding cutoff → always ended
	if (biddingCutoffAt > 0 && t >= biddingCutoffAt) return 'ended'

	// Within bounds: prefer relay status if available
	if (relayStatus) return relayStatus

	// No relay status: derive from timestamps (we're between start and cutoff)
	return 'live'
}

export function parseAuctionCoordFromATag(event: any): string | null {
	const aTag = event.tags?.find((t: string[]) => t[0] === 'a')
	if (!aTag?.[1]) return null
	const coord = aTag[1]
	if (!coord.startsWith(`${AUCTION_KIND}:`)) return null
	return coord
}

export function buildLiveActivityDTag(auctionCoord: string): string {
	const parts = auctionCoord.split(':')
	const sellerPubkey = parts[1] || ''
	const auctionDTag = parts.slice(2).join(':')
	return `auction:${sellerPubkey.slice(0, 16)}:${auctionDTag}`
}

export function buildLiveActivityCoord(activityOwnerPubkey: string, auctionCoord: string): string {
	const dTag = buildLiveActivityDTag(auctionCoord)
	return `${LIVE_ACTIVITY_KIND}:${activityOwnerPubkey}:${dTag}`
}

export function buildLiveActivityTags(params: {
	dTag: string
	sellerPubkey: string
	title: string
	summary: string
	image: string | undefined
	startsAt: number
	maxEndAt: number
	status: LiveActivityStatus
	relays: string[]
	categories: string[]
}): string[][] {
	const tags: string[][] = [
		['d', params.dTag],
		['a', `${AUCTION_KIND}:${params.sellerPubkey}:${params.dTag.split(':').slice(2).join(':') || params.dTag}`],
		['title', params.title],
		['status', params.status],
		['client', 'plebeian.market'],
		['p', params.sellerPubkey, '', 'Host'],
	]

	if (params.summary) tags.push(['summary', params.summary])
	if (params.image) tags.push(['image', params.image])
	if (params.startsAt > 0) tags.push(['starts', String(params.startsAt)])
	if (params.maxEndAt > 0) tags.push(['ends', String(params.maxEndAt)])
	if (params.relays.length > 0) tags.push(['relays', ...params.relays])
	for (const cat of params.categories) {
		tags.push(['t', cat])
	}

	return tags
}

export function parseLiveActivity(event: any): LiveActivity {
	const dTag = event.tags.find((t: string[]) => t[0] === 'd')?.[1] ?? ''
	const status = (event.tags.find((t: string[]) => t[0] === 'status')?.[1] as LiveActivityStatus) ?? 'planned'
	const title = event.tags.find((t: string[]) => t[0] === 'title')?.[1] ?? ''
	const summary = event.tags.find((t: string[]) => t[0] === 'summary')?.[1] ?? ''
	const image = event.tags.find((t: string[]) => t[0] === 'image')?.[1]
	const starts = parseInt(event.tags.find((t: string[]) => t[0] === 'starts')?.[1] ?? '0', 10) || 0
	const ends = parseInt(event.tags.find((t: string[]) => t[0] === 'ends')?.[1] ?? '0', 10) || 0
	const relays = event.tags.find((t: string[]) => t[0] === 'relays')?.slice(1) ?? []
	const sellerPubkey = event.tags.find((t: string[]) => t[0] === 'p' && t[3] === 'Host')?.[1] ?? event.pubkey
	const activityOwnerPubkey = event.pubkey

	return {
		coord: `${LIVE_ACTIVITY_KIND}:${activityOwnerPubkey}:${dTag}`,
		activityOwnerPubkey,
		sellerPubkey,
		dTag,
		title,
		summary,
		image,
		status,
		starts,
		ends,
		relays,
	}
}

export function parseLiveChatMessage(event: any): LiveChatMessage {
	return {
		id: event.id,
		authorPubkey: event.pubkey,
		content: event.content ?? '',
		createdAt: event.created_at ?? Math.floor(Date.now() / 1000),
		event,
	}
}
