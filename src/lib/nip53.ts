export const LIVE_ACTIVITY_KIND = 30311
export const LIVE_CHAT_KIND = 1311
export const AUCTION_KIND = 30408
export const MARKETPLACE_TAG = 'plebeian'

export type LiveActivityStatus = 'planned' | 'live' | 'ended'

export interface LiveActivity {
	coord: string
	dTag: string
	sellerPubkey: string
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

export function getLiveActivityCoord(sellerPubkey: string, dTag: string): string {
	return `${LIVE_ACTIVITY_KIND}:${sellerPubkey}:${dTag}`
}

export function getAuctionCoordFromLiveActivity(liveActivityCoord: string): string {
	return liveActivityCoord.replace(`${LIVE_ACTIVITY_KIND}:`, `${AUCTION_KIND}:`)
}

export function getLiveActivityCoordFromAuction(auctionCoord: string): string {
	return auctionCoord.replace(`${AUCTION_KIND}:`, `${LIVE_ACTIVITY_KIND}:`)
}

export function deriveLiveActivityStatus(startsAt: number, maxEndAt: number, now?: number): LiveActivityStatus {
	const t = now ?? Math.floor(Date.now() / 1000)
	if (startsAt > 0 && t < startsAt) return 'planned'
	if (maxEndAt > 0 && t >= maxEndAt) return 'ended'
	return 'live'
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
		['a', `${AUCTION_KIND}:${params.sellerPubkey}:${params.dTag}`],
		['title', params.title],
		['status', params.status],
		['marketplace', MARKETPLACE_TAG],
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

	return {
		coord: getLiveActivityCoord(event.pubkey, dTag),
		dTag,
		sellerPubkey: event.pubkey,
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
