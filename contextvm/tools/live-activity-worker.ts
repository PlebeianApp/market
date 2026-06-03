import { NDKEvent } from '@nostr-dev-kit/ndk'
import {
	AUCTION_KIND,
	getAuctionEndAt,
	getAuctionMaxEndAt,
	getAuctionStartAt,
	getAuctionTagValue,
	getAuctionTagValues,
} from '../../src/lib/auctionSettlement'
import {
	LIVE_ACTIVITY_KIND,
	LIVE_CHAT_KIND,
	buildLiveActivityTags,
	deriveLiveActivityStatus,
	type LiveActivityStatus,
} from '../../src/lib/nip53'
import type { AuctionContext } from '../../src/server/auction/context'

interface LiveActivityState {
	status: LiveActivityStatus
	currentParticipants: number
	totalParticipants: number
	updatedAt: number
}

const DEFAULT_INTERVAL_MS = 60_000
const DEFAULT_LOOKBACK_DAYS = 7
const PARTICIPANT_ACTIVE_WINDOW_S = 300
const MAX_AUCTIONS_PER_POLL = 500
const MAX_CHAT_MESSAGES_PER_ACTIVITY = 500

let dedupMap = new Map<string, LiveActivityState>()
let intervalHandle: ReturnType<typeof setInterval> | null = null

export function getIntervalMs(): number {
	const val = process.env.LIVE_ACTIVITY_INTERVAL_MS
	return val ? parseInt(val, 10) || DEFAULT_INTERVAL_MS : DEFAULT_INTERVAL_MS
}

export function getLookbackDays(): number {
	const val = process.env.LIVE_ACTIVITY_LOOKBACK_DAYS
	return val ? parseInt(val, 10) || DEFAULT_LOOKBACK_DAYS : DEFAULT_LOOKBACK_DAYS
}

export function getPathIssuerFilter(): string | undefined {
	return process.env.LIVE_ACTIVITY_PATH_ISSUER_FILTER || undefined
}

export function resetDedupMap(): void {
	dedupMap = new Map()
}

export function getDedupMap(): Map<string, LiveActivityState> {
	return dedupMap
}

export function countParticipants(
	messages: Array<{ pubkey: string; created_at: number }>,
	now: number,
): { current: number; total: number } {
	const authors = new Set<string>()
	const recentAuthors = new Set<string>()
	const cutoff = now - PARTICIPANT_ACTIVE_WINDOW_S

	for (const msg of messages) {
		authors.add(msg.pubkey)
		if (msg.created_at >= cutoff) {
			recentAuthors.add(msg.pubkey)
		}
	}

	return { current: recentAuthors.size, total: authors.size }
}

export async function fetchRecentAuctions(ctx: AuctionContext): Promise<NDKEvent[]> {
	const lookbackSeconds = getLookbackDays() * 86400
	const since = Math.floor(Date.now() / 1000) - lookbackSeconds
	const pathIssuerFilter = getPathIssuerFilter()

	const filter: Record<string, unknown> = {
		kinds: [AUCTION_KIND],
		since,
		limit: MAX_AUCTIONS_PER_POLL,
	}

	if (pathIssuerFilter) {
		filter['#path_issuer'] = [pathIssuerFilter]
	}

	const events = await ctx.ndk.fetchEvents(filter as any)
	return Array.from(events)
}

export async function fetchExistingLiveActivity(
	ctx: AuctionContext,
	auctionCoord: string,
): Promise<NDKEvent | null> {
	const events = await ctx.ndk.fetchEvents({
		kinds: [LIVE_ACTIVITY_KIND as any],
		'#a': [auctionCoord],
		limit: 1,
	} as any)
	const arr = Array.from(events)
	if (arr.length === 0) return null

	arr.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
	return arr[0]
}

export async function fetchChatParticipants(
	ctx: AuctionContext,
	liveActivityCoord: string,
): Promise<Array<{ pubkey: string; created_at: number }>> {
	const events = await ctx.ndk.fetchEvents({
		kinds: [LIVE_CHAT_KIND as any],
		'#a': [liveActivityCoord],
		limit: MAX_CHAT_MESSAGES_PER_ACTIVITY,
	} as any)
	return Array.from(events).map((e) => ({
		pubkey: e.pubkey,
		created_at: e.created_at ?? 0,
	}))
}

export async function publishLiveActivityUpdate(
	ctx: AuctionContext,
	params: {
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
		currentParticipants: number
		totalParticipants: number
	},
): Promise<void> {
	const tags = buildLiveActivityTags({
		dTag: params.dTag,
		sellerPubkey: params.sellerPubkey,
		title: params.title,
		summary: params.summary,
		image: params.image,
		startsAt: params.startsAt,
		maxEndAt: params.maxEndAt,
		status: params.status,
		relays: params.relays,
		categories: params.categories,
	})

	tags.push(['current_participants', String(params.currentParticipants)])
	tags.push(['total_participants', String(params.totalParticipants)])

	const event = new NDKEvent(ctx.ndk)
	event.kind = LIVE_ACTIVITY_KIND
	event.content = ''
	event.tags = tags
	event.created_at = Math.floor(Date.now() / 1000)

	await event.sign(ctx.signer)
	await event.publish()
}

type PublishFn = (params: {
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
	currentParticipants: number
	totalParticipants: number
}) => Promise<void>

export async function pollAndUpdateLiveActivities(
	ctx: AuctionContext,
	opts?: { publishOverride?: PublishFn },
): Promise<{
	checked: number
	created: number
	updated: number
	skipped: number
	errors: number
}> {
	const now = Math.floor(Date.now() / 1000)
	const stats = { checked: 0, created: 0, updated: 0, skipped: 0, errors: 0 }

	let auctions: NDKEvent[]
	try {
		auctions = await fetchRecentAuctions(ctx)
	} catch (err) {
		console.error('[live-activity-worker] Failed to fetch auctions:', err)
		stats.errors++
		return stats
	}

	const publish = opts?.publishOverride ?? ((p) => publishLiveActivityUpdate(ctx, p))

	for (const auction of auctions) {
		stats.checked++
		try {
			const dTag = getAuctionTagValue(auction, 'd')
			if (!dTag) continue

			const sellerPubkey = auction.pubkey
			const startsAt = getAuctionStartAt(auction)
			const maxEndAt = getAuctionMaxEndAt(auction) || getAuctionEndAt(auction)
			const status = deriveLiveActivityStatus(startsAt, maxEndAt, now)
			const title = getAuctionTagValue(auction, 'title')
			const summary = getAuctionTagValue(auction, 'summary')
			const images = getAuctionTagValues(auction, 'image')
			const image = images.length > 0 ? images[0] : undefined
			const categories = getAuctionTagValues(auction, 't')

			const auctionCoord = `${AUCTION_KIND}:${sellerPubkey}:${dTag}`
			const liveActivityCoord = `${LIVE_ACTIVITY_KIND}:${ctx.issuerPubkey}:${dTag}`

			const existing = await fetchExistingLiveActivity(ctx, auctionCoord)

			let currentParticipants = 0
			let totalParticipants = 0
			if (existing) {
				const participants = await fetchChatParticipants(ctx, liveActivityCoord)
				const counts = countParticipants(participants, now)
				currentParticipants = counts.current
				totalParticipants = counts.total
			}

			const lastKnown = dedupMap.get(dTag)
			if (
				lastKnown &&
				lastKnown.status === status &&
				lastKnown.currentParticipants === currentParticipants &&
				lastKnown.totalParticipants === totalParticipants
			) {
				stats.skipped++
				continue
			}

			const connectedRelays = ctx.ndk.pool?.connectedRelays?.() || []
			const relayUrls = connectedRelays.map((r: any) => r.url || r)

			await publish({
				dTag,
				sellerPubkey,
				title,
				summary,
				image,
				startsAt,
				maxEndAt,
				status,
				relays: relayUrls,
				categories,
				currentParticipants,
				totalParticipants,
			})

			dedupMap.set(dTag, {
				status,
				currentParticipants,
				totalParticipants,
				updatedAt: now,
			})

			if (existing) {
				stats.updated++
			} else {
				stats.created++
			}
		} catch (err) {
			console.error(`[live-activity-worker] Error processing auction:`, err)
			stats.errors++
		}
	}

	if (stats.created + stats.updated > 0) {
		console.log(
			`[live-activity-worker] Poll complete: ${stats.checked} checked, ${stats.created} created, ${stats.updated} updated, ${stats.skipped} skipped, ${stats.errors} errors`,
		)
	}

	return stats
}

export function startLiveActivityWorker(ctx: AuctionContext, intervalMs?: number): void {
	const interval = intervalMs ?? getIntervalMs()

	console.log(`[live-activity-worker] Starting worker (interval: ${interval}ms, lookback: ${getLookbackDays()} days)`)

	const tick = async () => {
		try {
			await pollAndUpdateLiveActivities(ctx)
		} catch (err) {
			console.error('[live-activity-worker] Unexpected error in poll cycle:', err)
		}
	}

	tick()

	intervalHandle = setInterval(tick, interval)
}

export function stopLiveActivityWorker(): void {
	if (intervalHandle !== null) {
		clearInterval(intervalHandle)
		intervalHandle = null
		console.log('[live-activity-worker] Stopped')
	}
}
