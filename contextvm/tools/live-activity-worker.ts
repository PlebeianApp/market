import type { ApplesauceRelayPool } from '@contextvm/sdk'
import type { NostrSigner } from '@contextvm/sdk'
import type { NostrEvent, EventTemplate, Filter } from 'nostr-tools'
import {
	LIVE_ACTIVITY_KIND,
	LIVE_CHAT_KIND,
	AUCTION_KIND,
	buildLiveActivityTags,
	buildLiveActivityDTag,
	deriveLiveActivityStatus,
	type LiveActivityStatus,
} from '../../src/lib/nip53'

export interface LiveActivityWorkerContext {
	relayPool: ApplesauceRelayPool
	signer: NostrSigner
	issuerPubkey: string
}

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
let bidSubscriptions = new Map<string, () => void>()
let intervalHandle: ReturnType<typeof setInterval> | null = null
let discoveryUnsub: (() => void) | null = null

export function getIntervalMs(): number {
	const val = process.env.LIVE_ACTIVITY_INTERVAL_MS
	return val ? parseInt(val, 10) || DEFAULT_INTERVAL_MS : DEFAULT_INTERVAL_MS
}

export function getLookbackDays(): number {
	const val = process.env.LIVE_ACTIVITY_LOOKBACK_DAYS
	return val ? parseInt(val, 10) || DEFAULT_LOOKBACK_DAYS : DEFAULT_LOOKBACK_DAYS
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

function getTagValue(event: NostrEvent, name: string): string {
	return event.tags.find((t) => t[0] === name)?.[1] ?? ''
}

function getTagValues(event: NostrEvent, name: string): string[] {
	return event.tags.filter((t) => t[0] === name && t[1]).map((t) => t[1] ?? '')
}

// =========================================================================
// Phase 2: CVM Commentator — publish system chat messages on auction events
// =========================================================================

async function publishCommentatorMessage(ctx: LiveActivityWorkerContext, liveActivityCoord: string, content: string): Promise<void> {
	const template: EventTemplate = {
		kind: LIVE_CHAT_KIND,
		content,
		created_at: Math.floor(Date.now() / 1000),
		tags: [['a', liveActivityCoord, '', 'root']],
	}
	const signed = await ctx.signer.signEvent(template)
	await ctx.relayPool.publish(signed)
}

async function openBidSubscription(
	ctx: LiveActivityWorkerContext,
	auctionCoord: string,
	liveActivityCoord: string,
	dedupKey: string,
	since: number,
): Promise<void> {
	if (bidSubscriptions.has(dedupKey)) return

	const unsub = await ctx.relayPool.subscribe(
		[{ kinds: [1023], '#a': [auctionCoord], since } as unknown as Filter],
		async (bidEvent: NostrEvent) => {
			try {
				const amountTag = bidEvent.tags.find((t) => t[0] === 'amount')?.[1]
				const amount = amountTag ? parseInt(amountTag, 10) : 0
				const formattedAmount = amount.toLocaleString()
				const bidderNpub = `npub1${bidEvent.pubkey.slice(0, 12)}…`
				await publishCommentatorMessage(ctx, liveActivityCoord, `🔵 New bid from ${bidderNpub}: ${formattedAmount} sats`)
			} catch (err) {
				console.error('[live-activity-worker] Failed to publish commentator message:', err)
			}
		},
	)

	bidSubscriptions.set(dedupKey, unsub)
	console.log(`[live-activity-worker] Bid subscription opened for ${dedupKey}`)
}

function closeBidSubscription(dedupKey: string): void {
	const unsub = bidSubscriptions.get(dedupKey)
	if (unsub) {
		unsub()
		bidSubscriptions.delete(dedupKey)
		console.log(`[live-activity-worker] Bid subscription closed for ${dedupKey}`)
	}
}

export function getBidSubscriptions(): Map<string, () => void> {
	return bidSubscriptions
}

async function fetchEventsUntilEose(relayPool: ApplesauceRelayPool, filters: Filter[], timeoutMs = 5000): Promise<NostrEvent[]> {
	return new Promise((resolve) => {
		const collected: NostrEvent[] = []
		let resolved = false

		const timer = setTimeout(() => {
			if (!resolved) {
				resolved = true
				unsub?.()
				resolve(collected)
			}
		}, timeoutMs)

		let unsub: (() => void) | undefined

		relayPool
			.subscribe(
				filters,
				(event) => {
					collected.push(event)
				},
				() => {
					if (!resolved) {
						resolved = true
						clearTimeout(timer)
						unsub?.()
						resolve(collected)
					}
				},
			)
			.then((fn) => {
				unsub = fn
			})
	})
}

export async function fetchRecentLiveChatAuctions(ctx: LiveActivityWorkerContext): Promise<NostrEvent[]> {
	const lookbackSeconds = getLookbackDays() * 86400
	const since = Math.floor(Date.now() / 1000) - lookbackSeconds

	const events = await fetchEventsUntilEose(ctx.relayPool, [
		{
			kinds: [AUCTION_KIND],
			'#live_chat': ['enabled'],
			since,
			limit: MAX_AUCTIONS_PER_POLL,
		},
	])
	return events
}

export async function fetchExistingLiveActivity(ctx: LiveActivityWorkerContext, auctionCoord: string): Promise<NostrEvent | null> {
	const events = await fetchEventsUntilEose(ctx.relayPool, [
		{
			kinds: [LIVE_ACTIVITY_KIND],
			'#a': [auctionCoord],
			authors: [ctx.issuerPubkey],
			limit: 1,
		},
	])
	if (events.length === 0) return null

	events.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
	return events[0]
}

export async function fetchChatParticipants(
	ctx: LiveActivityWorkerContext,
	liveActivityCoord: string,
): Promise<Array<{ pubkey: string; created_at: number }>> {
	const events = await fetchEventsUntilEose(ctx.relayPool, [
		{
			kinds: [LIVE_CHAT_KIND],
			'#a': [liveActivityCoord],
			limit: MAX_CHAT_MESSAGES_PER_ACTIVITY,
		},
	])
	return events.map((e) => ({
		pubkey: e.pubkey,
		created_at: e.created_at ?? 0,
	}))
}

export async function publishLiveActivityUpdate(
	ctx: LiveActivityWorkerContext,
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

	const template: EventTemplate = {
		kind: LIVE_ACTIVITY_KIND,
		content: '',
		created_at: Math.floor(Date.now() / 1000),
		tags,
	}

	const signed = await ctx.signer.signEvent(template)
	await ctx.relayPool.publish(signed)
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
	ctx: LiveActivityWorkerContext,
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

	let auctions: NostrEvent[]
	try {
		auctions = await fetchRecentLiveChatAuctions(ctx)
	} catch (err) {
		console.error('[live-activity-worker] Failed to fetch auctions:', err)
		stats.errors++
		return stats
	}

	const publish = opts?.publishOverride ?? ((p) => publishLiveActivityUpdate(ctx, p))

	for (const auction of auctions) {
		stats.checked++
		try {
			const auctionDTag = getTagValue(auction, 'd')
			if (!auctionDTag) continue

			const sellerPubkey = auction.pubkey
			const startsAt = parseInt(getTagValue(auction, 'start_at') || '0', 10) || 0
			const endAt = parseInt(getTagValue(auction, 'end_at') || '0', 10) || 0
			const maxEndAt = parseInt(getTagValue(auction, 'max_end_at') || '0', 10) || endAt
			const status = deriveLiveActivityStatus(startsAt, maxEndAt, now)
			const title = getTagValue(auction, 'title')
			const summary = getTagValue(auction, 'summary')
			const images = getTagValues(auction, 'image')
			const image = images.length > 0 ? images[0] : undefined
			const categories = getTagValues(auction, 't')

			const auctionCoord = `${AUCTION_KIND}:${sellerPubkey}:${auctionDTag}`
			const safeDTag = buildLiveActivityDTag(auctionCoord)
			const liveActivityCoord = `${LIVE_ACTIVITY_KIND}:${ctx.issuerPubkey}:${safeDTag}`

			const dedupKey = `${sellerPubkey}:${auctionDTag}`

			const existing = await fetchExistingLiveActivity(ctx, auctionCoord)

			let currentParticipants = 0
			let totalParticipants = 0
			if (existing) {
				const participants = await fetchChatParticipants(ctx, liveActivityCoord)
				const counts = countParticipants(participants, now)
				currentParticipants = counts.current
				totalParticipants = counts.total
			}

			const lastKnown = dedupMap.get(dedupKey)
			if (
				lastKnown &&
				lastKnown.status === status &&
				lastKnown.currentParticipants === currentParticipants &&
				lastKnown.totalParticipants === totalParticipants
			) {
				stats.skipped++
				continue
			}

			const relayUrls = ctx.relayPool.getRelayUrls()

			await publish({
				dTag: safeDTag,
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

			dedupMap.set(dedupKey, {
				status,
				currentParticipants,
				totalParticipants,
				updatedAt: now,
			})

			// Phase 2: CVM commentator — manage bid subscriptions and publish milestones
			const prevStatus = lastKnown?.status

			if (status === 'live') {
				// Open bid subscription if not already open
				await openBidSubscription(ctx, auctionCoord, liveActivityCoord, dedupKey, now)

				if (prevStatus !== 'live' && prevStatus !== undefined) {
					await publishCommentatorMessage(ctx, liveActivityCoord, '🟢 Auction is now live!')
				}
			} else if (status === 'ended') {
				// Close bid subscription when auction ends
				closeBidSubscription(dedupKey)

				if (prevStatus !== 'ended' && prevStatus !== undefined) {
					await publishCommentatorMessage(ctx, liveActivityCoord, `🏁 Auction ended. Watched by ${totalParticipants} users.`)
				}
			}

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

export function startLiveActivityWorker(ctx: LiveActivityWorkerContext, intervalMs?: number): void {
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
	for (const [key, unsub] of bidSubscriptions) {
		unsub()
	}
	bidSubscriptions.clear()
	if (discoveryUnsub) {
		discoveryUnsub()
		discoveryUnsub = null
	}
	if (intervalHandle !== null) {
		clearInterval(intervalHandle)
		intervalHandle = null
		console.log('[live-activity-worker] Stopped')
	}
}
