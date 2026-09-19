import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

export const LIVE_ACTIVITY_KIND = 30311
export const LIVE_CHAT_KIND = 1311
export const AUCTION_KIND = 30408
export type LiveActivityStatus = 'planned' | 'live' | 'ended'

/**
 * Addressing budget for relay tag indexes.
 *
 * Why this constant exists
 * ------------------------
 * A relay's tag index is what makes `#a` lookups possible at all. The storage
 * backend our relays run (khatru's boltdb store) indexes a tag **only** when the
 * tag name is a single character *and* the tag value is at most 100 characters
 * (`eventstore/boltdb/helpers.go`: `if len(tag) < 2 || len(tag[0]) != 1 ||
 * len(tag[1]) == 0 || len(tag[1]) > 100 { continue }`). The query planner then
 * treats an `#a` filter as high-selectivity ("goodness 8") and builds the query
 * from that one index with **no fallback scan** — so a longer value is stored,
 * indexed nowhere, and returned to nobody.
 *
 * The protocol must not depend on a relay-side fix: it has to work on any relay,
 * including ones we do not operate and ones whose index rules we cannot change.
 * So every `a` value this feature publishes stays inside the budget. Measured on
 * our own relays before this rule (2026-09-18): the auction coordinate at 98
 * characters resolves, a 101-character value does not; 442 of 500 sampled
 * kind-1311 events on the production relay carry `a` values longer than 100 and
 * are therefore invisible to an `#a` lookup.
 */
export const RELAY_TAG_INDEX_VALUE_MAX_LENGTH = 100

/**
 * `30311` + `:` + the 64-hex activity-owner pubkey + `:` — the fixed part of a
 * live-activity coordinate. Everything left over is the `d` tag's budget.
 */
const LIVE_ACTIVITY_COORD_OVERHEAD_LENGTH = `${LIVE_ACTIVITY_KIND}:`.length + 64 + 1

/** Longest `d` tag a live activity may carry: 100 − 71 = 29 characters. */
export const LIVE_ACTIVITY_DTAG_MAX_LENGTH = RELAY_TAG_INDEX_VALUE_MAX_LENGTH - LIVE_ACTIVITY_COORD_OVERHEAD_LENGTH

/** Human-readable prefix on the live-activity `d` tag. */
export const LIVE_ACTIVITY_DTAG_PREFIX = 'auction'

/**
 * How much of the auction-coordinate digest goes into the `d` tag. 12 hex
 * characters = 48 bits: with thousands of live auctions the collision
 * probability is negligible, and `auction:` + 12 = 20 characters leaves 9 of the
 * 29-character budget as headroom.
 */
export const AUCTION_HASH_HEX_LENGTH = 12

const sha256Hex = (value: string): string => bytesToHex(sha256(new TextEncoder().encode(value)))

/** True when a tag value fits the relay tag-index budget above. */
export const isWithinRelayTagIndexBudget = (tagValue: string): boolean => tagValue.length <= RELAY_TAG_INDEX_VALUE_MAX_LENGTH

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

export function deriveLiveActivityStatus(startsAt: number, endAt: number, now?: number): LiveActivityStatus {
	const t = now ?? Math.floor(Date.now() / 1000)
	if (startsAt > 0 && t < startsAt) return 'planned'
	if (endAt > 0 && t >= endAt) return 'ended'
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
	const digest = sha256Hex(auctionCoord).slice(0, AUCTION_HASH_HEX_LENGTH)
	return `${LIVE_ACTIVITY_DTAG_PREFIX}:${digest}`
}

export function buildLiveActivityCoord(activityOwnerPubkey: string, auctionCoord: string): string {
	const dTag = buildLiveActivityDTag(auctionCoord)
	return `${LIVE_ACTIVITY_KIND}:${activityOwnerPubkey}:${dTag}`
}

export function buildLiveActivityTags(params: {
	/** The kind-30408 coordinate this activity is for — the `a` reference tag. */
	auctionCoord: string
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
		// The activity's own `d` is derived from the auction coordinate, so the
		// caller cannot pass a `d` that disagrees with the reference tag below.
		['d', buildLiveActivityDTag(params.auctionCoord)],
		// 2-way reachability, activity → auction: a plain NIP-01 `a` tag holding
		// the full auction coordinate (98 chars today, inside the budget). The
		// other direction is the deterministic derivation above, which lets any
		// client compute this activity's address from the auction alone.
		['a', params.auctionCoord],
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
