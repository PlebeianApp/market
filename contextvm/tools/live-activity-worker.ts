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
	/** True after the transition commentator message has been published. */
	commentatorDelivered: boolean
}

const DEFAULT_INTERVAL_MS = 60_000
const DEFAULT_LOOKBACK_DAYS = 7
const PARTICIPANT_ACTIVE_WINDOW_S = 300
const MAX_AUCTIONS_PER_POLL = 500
const MAX_CHAT_MESSAGES_PER_ACTIVITY = 500

let dedupMap = new Map<string, LiveActivityState>()
// One-shot timers scheduled to fire at each auction's maxEndAt, so the
// end-of-auction announcement is published immediately instead of waiting
// for the next 60s poll tick. Keyed by dedupKey (sellerPubkey:auctionDTag).
let endTimers = new Map<string, ReturnType<typeof setTimeout>>()
let intervalHandle: ReturnType<typeof setInterval> | null = null
let discoveryUnsub: (() => void) | null = null
// In-flight guard: ensures only one pollAndUpdateLiveActivities runs at a
// time, preventing overlapping scheduled-end and interval polls from both
// reading the same prior state and publishing duplicate messages.
let pollInFlight: Promise<unknown> | null = null

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
	for (const handle of endTimers.values()) clearTimeout(handle)
	endTimers.clear()
	pollInFlight = null
}

export function getDedupMap(): Map<string, LiveActivityState> {
	return dedupMap
}

export function countParticipants(
	messages: Array<{ pubkey: string; created_at: number }>,
	now: number,
	excludePubkeys?: string[],
): { current: number; total: number } {
	// The CVM publishes its own kind-1311 commentator messages (milestones)
	// signed with the issuer key. Those are system messages, not participants,
	// so callers pass the issuer pubkey here to keep it out of the counts.
	const exclude = excludePubkeys?.length ? new Set(excludePubkeys) : null
	const authors = new Set<string>()
	const recentAuthors = new Set<string>()
	const cutoff = now - PARTICIPANT_ACTIVE_WINDOW_S

	for (const msg of messages) {
		if (exclude?.has(msg.pubkey)) continue
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
// CVM Commentator — publish system chat messages on auction lifecycle
// transitions. Per-bid commentary was removed per PR #1149 review feedback:
// the worker does not establish canonical root, status validity, bidding
// window, rebid chain, Cashu validity, or auditor validity for individual
// bids, so it must not assert "New bid" as a CVM-signed system message.
// =========================================================================

/** Neutral end-of-auction message — max_end_at closes bidding, not settlement. */
export const NEUTRAL_END_MESSAGE = '🏁 Bidding closed; settlement pending.'

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

// -------------------------------------------------------------------------
// Scheduled end callback: instead of waiting up to `interval` for the next
// poll to notice an auction ended, schedule a one-shot timer at maxEndAt
// that fires an immediate poll tick so the end transition + commentator
// message publish right on time. The pollInFlight guard and dedup /
// commentatorDelivered tracking keep the announcement idempotent if both
// the timer and a regular poll tick race.
// -------------------------------------------------------------------------

export function getEndTimers(): Map<string, ReturnType<typeof setTimeout>> {
	return endTimers
}

export function clearEndTimers(): void {
	for (const handle of endTimers.values()) clearTimeout(handle)
	endTimers.clear()
}

/**
 * Schedule a one-shot poll at the auction's maxEndAt. No-op if `maxEndAt` is
 * not in the future or a timer is already registered for `dedupKey`.
 * Returns the scheduled delay in ms (0 means not scheduled).
 */
export function scheduleAuctionEnd(ctx: LiveActivityWorkerContext, dedupKey: string, maxEndAt: number): number {
	if (endTimers.has(dedupKey)) return 0
	const delay = maxEndAt * 1000 - Date.now()
	if (!Number.isFinite(delay) || delay <= 0) return 0

	const handle = setTimeout(() => {
		endTimers.delete(dedupKey)
		console.log(`[live-activity-worker] Scheduled end callback fired for ${dedupKey}`)
		pollAndUpdateLiveActivities(ctx).catch((err) => console.error('[live-activity-worker] Error in scheduled end poll:', err))
	}, delay)

	endTimers.set(dedupKey, handle)
	return delay
}

function clearAuctionEndTimer(dedupKey: string): void {
	const handle = endTimers.get(dedupKey)
	if (handle) {
		clearTimeout(handle)
		endTimers.delete(dedupKey)
	}
}

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
	// Coalesce all poll triggers through one in-flight operation. If a
	// scheduled end-timer fires while an interval poll is still running,
	// this guard prevents both from reading the same prior state and
	// publishing duplicate transitions. The second caller awaits the
	// first poll's result and returns its stats.
	if (pollInFlight) {
		return pollInFlight as Promise<{
			checked: number
			created: number
			updated: number
			skipped: number
			errors: number
		}>
	}

	const pollPromise = doPollAndUpdateLiveActivities(ctx, opts)
	pollInFlight = pollPromise
	try {
		return await pollPromise
	} finally {
		pollInFlight = null
	}
}

async function doPollAndUpdateLiveActivities(
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
				// Exclude the CVM's own commentator messages from participant counts.
				const counts = countParticipants(participants, now, [ctx.issuerPubkey])
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

			// Update dedupMap with the new state, but do NOT mark
			// commentatorDelivered yet — that is set only after the
			// commentator message is successfully published below.
			dedupMap.set(dedupKey, {
				status,
				currentParticipants,
				totalParticipants,
				updatedAt: now,
				commentatorDelivered: lastKnown?.commentatorDelivered ?? false,
			})

			// CVM commentator — publish lifecycle transition messages.
			// Per-bid commentary and winner assertions removed per PR #1149
			// review: the worker does not validate canonical root, status
			// validity, bidding window, rebid chain, Cashu validity, or
			// auditor validity for individual bids.
			const prevStatus = lastKnown?.status

			if (status === 'live') {
				// Publish "live" transition only if not already delivered
				if (prevStatus !== 'live' && prevStatus !== undefined && !lastKnown?.commentatorDelivered) {
					try {
						await publishCommentatorMessage(ctx, liveActivityCoord, '🟢 Auction is now live!')
						// Mark commentator delivery complete only after successful publication
						dedupMap.set(dedupKey, {
							status,
							currentParticipants,
							totalParticipants,
							updatedAt: now,
							commentatorDelivered: true,
						})
					} catch (err) {
						console.error('[live-activity-worker] Failed to publish live commentator message:', err)
						// Not marked as delivered — next poll will retry
					}
				}

				// Schedule a one-shot poll at auction end so the end transition +
				// announcement fire immediately instead of waiting up to 60s.
				if (maxEndAt > now) {
					scheduleAuctionEnd(ctx, dedupKey, maxEndAt)
				}
			} else if (status === 'ended') {
				// The scheduled end timer is no longer needed (we're ending now).
				clearAuctionEndTimer(dedupKey)

				// Publish "ended" transition only if not already delivered.
				// Per PR #1149 review: max_end_at closes bidding but does NOT
				// establish a final winner or settlement outcome. Use a neutral
				// message instead of asserting "Won by" before structural/Cashu
				// validity, reserve outcome, path release, redemption, fallback,
				// or seller-confirmed settlement.
				if (prevStatus !== 'ended' && !lastKnown?.commentatorDelivered) {
					try {
						await publishCommentatorMessage(ctx, liveActivityCoord, NEUTRAL_END_MESSAGE)
						// Mark commentator delivery complete only after successful publication
						dedupMap.set(dedupKey, {
							status,
							currentParticipants,
							totalParticipants,
							updatedAt: now,
							commentatorDelivered: true,
						})
					} catch (err) {
						console.error('[live-activity-worker] Failed to publish end commentator message:', err)
						// Not marked as delivered — next poll will retry
					}
				}
			} else if (status === 'planned') {
				// Auction hasn't started yet, but make sure we'll catch the exact
				// end time once it does go live (timer is a no-op until maxEndAt).
				if (maxEndAt > now) {
					scheduleAuctionEnd(ctx, dedupKey, maxEndAt)
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
	for (const handle of endTimers.values()) {
		clearTimeout(handle)
	}
	endTimers.clear()
	if (discoveryUnsub) {
		discoveryUnsub()
		discoveryUnsub = null
	}
	if (intervalHandle !== null) {
		clearInterval(intervalHandle)
		intervalHandle = null
		console.log('[live-activity-worker] Stopped')
	}
	pollInFlight = null
}