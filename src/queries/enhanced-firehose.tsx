// Enhanced event queries using jumble patterns for proper feed loading
// Implements DataLoader batching, multi-tier caching, and comprehensive event kind support

import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'
import { NDKRelaySet } from '@nostr-dev-kit/ndk'
import { queryOptions } from '@tanstack/react-query'
import { noteKeys } from '@/queries/queryKeyFactory'
import { ndkActions } from '@/lib/stores/ndk'
import { defaultRelaysUrls } from '@/lib/constants'
import { configActions } from '@/lib/stores/config'
import DataLoader from 'dataloader'
import LRUCache from 'lru-cache'

// Extended event kinds based on jumble patterns
export const ExtendedKind = {
	PICTURE: 20,
	VIDEO: 21,
	SHORT_VIDEO: 22,
	POLL: 1068,
	POLL_RESPONSE: 1018,
	COMMENT: 1111,
	VOICE: 1222,
	VOICE_COMMENT: 1244,
	FAVORITE_RELAYS: 10012,
	BLOSSOM_SERVER_LIST: 10063,
	GROUP_METADATA: 39000,
} as const

// Comprehensive supported kinds for proper feed loading
export const SUPPORTED_KINDS = [
	1, // ShortTextNote
	6, // Repost
	ExtendedKind.PICTURE,
	ExtendedKind.VIDEO,
	ExtendedKind.SHORT_VIDEO,
	ExtendedKind.POLL,
	ExtendedKind.COMMENT,
	ExtendedKind.VOICE,
	ExtendedKind.VOICE_COMMENT,
	9802, // Highlights
	30023, // LongFormArticle
] as const

// Enhanced wrapper type with metadata for better feed management
export type EnhancedFetchedNDKEvent = {
	event: NDKEvent
	fetchedAt: number // ms since epoch
	relaysSeen: string[] // relays where this event was seen
	isFromCache: boolean
	priority: number // for sorting and relevance
}

// Global caches for enhanced performance
const eventCache = new LRUCache<string, NDKEvent>({ max: 5000, ttl: 1000 * 60 * 30 }) // 30 min TTL
const replaceableEventCache = new Map<string, NDKEvent>()
const firstFetchTimestamps = new Map<string, number>()
const relayTracker = new Map<string, Set<string>>() // eventId -> Set<relayUrl>

// DataLoader for batched event fetching
const eventDataLoader = new DataLoader<string, NDKEvent | null>(
	async (ids: readonly string[]) => {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		const appRelay = configActions.getAppRelay()
		const allRelays = appRelay ? [...defaultRelaysUrls, appRelay] : defaultRelaysUrls
		const relaySet = NDKRelaySet.fromRelayUrls(allRelays, ndk)

		const filter: NDKFilter = {
			ids: Array.from(ids),
			limit: ids.length * 2, // Allow some buffer for duplicates
		}

		try {
			const events = await ndk.fetchEvents(filter, undefined, relaySet)
			const eventMap = new Map<string, NDKEvent>()

			events.forEach((event) => {
				const id = (event as any).id
				if (id) {
					eventMap.set(id, event)
					// Track relays for this event
					if (!relayTracker.has(id)) {
						relayTracker.set(id, new Set())
					}
					// Add relay tracking logic here if relay info is available
				}
			})

			return Array.from(ids).map((id) => eventMap.get(id) || null)
		} catch (error) {
			console.error('Batch event fetch failed:', error)
			return Array.from(ids).map(() => null)
		}
	},
	{
		batchScheduleFn: (callback) => setTimeout(callback, 10), // Small delay for batching
		cacheMap: new Map(), // Use internal cache
	},
)

// Enhanced utility functions
function hasClientMostrTag(event: NDKEvent): boolean {
	const tags = (event as any)?.tags
	if (!Array.isArray(tags)) return false
	return tags.some((tag) => Array.isArray(tag) && tag.length >= 2 && tag[0] === 'client' && tag[1] === 'Mostr')
}

function isNSFWEvent(event: NDKEvent): boolean {
	try {
		const tags = (event as any)?.tags
		const content = (event as any)?.content
		const hasTag = Array.isArray(tags)
			? (tags as any[]).some((t: any) => Array.isArray(t) && t[0] === 't' && typeof t[1] === 'string' && t[1].toLowerCase() === 'nsfw')
			: false
		const contentStr = typeof content === 'string' ? (content as string) : ''
		const hasHash = /(^|\W)#nsfw(\W|$)/i.test(contentStr)
		return hasTag || hasHash
	} catch {
		return false
	}
}

function normalizeTag(input?: string): string | undefined {
	if (typeof input !== 'string') return undefined
	const trimmed = input.trim()
	if (!trimmed) return undefined
	const withoutHash = trimmed.replace(/^#/, '')
	return withoutHash.toLowerCase()
}

function isReplaceableEvent(kind: number): boolean {
	return (kind >= 10000 && kind < 20000) || (kind >= 30000 && kind < 40000)
}

function getReplaceableCoordinate(event: NDKEvent): string {
	const kind = (event as any).kind
	const pubkey = (event as any).pubkey
	const dTag = (event as any).tags?.find((tag: any[]) => tag[0] === 'd')?.[1] || ''
	return `${kind}:${pubkey}:${dTag}`
}

function calculateEventPriority(event: NDKEvent): number {
	const now = Date.now() / 1000
	const age = now - ((event as any).created_at || 0)
	const ageScore = Math.max(0, 1 - age / (24 * 60 * 60)) // Decay over 24 hours

	// Priority based on event type
	const kind = (event as any).kind
	let kindScore = 0.5 // Default

	if (kind === 1)
		kindScore = 1.0 // Text notes highest priority
	else if (kind === 6)
		kindScore = 0.9 // Reposts high priority
	else if ([ExtendedKind.PICTURE, ExtendedKind.VIDEO].includes(kind))
		kindScore = 0.8 // Media high priority
	else if (kind === 30023) kindScore = 0.7 // Articles medium-high priority

	return ageScore * kindScore
}

function withEnhancedMetadata(e: NDKEvent, isFromCache: boolean = false): EnhancedFetchedNDKEvent {
	const id = (e as any).id as string
	const existing = id ? firstFetchTimestamps.get(id) : undefined
	const now = Date.now()
	const ts = existing ?? now

	if (id && existing === undefined) {
		firstFetchTimestamps.set(id, ts)
	}

	return {
		event: e,
		fetchedAt: ts,
		relaysSeen: Array.from(relayTracker.get(id) || []),
		isFromCache,
		priority: calculateEventPriority(e),
	}
}

// Enhanced note fetching with improved algorithms
export const fetchEnhancedNotes = async (opts?: {
	tag?: string
	author?: string
	follows?: boolean
	limit?: number
	kinds?: number[]
}): Promise<EnhancedFetchedNDKEvent[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const limit = opts?.limit || 10
	const kinds = opts?.kinds || SUPPORTED_KINDS

	const filter: NDKFilter = {
		kinds: kinds,
		limit: limit,
	}

	// Enhanced tag filtering
	const normTag = normalizeTag(opts?.tag)
	if (normTag) {
		;(filter as any)['#t'] = [normTag]
	}

	// Enhanced author filtering
	if (opts?.author && typeof opts.author === 'string' && opts.author.trim()) {
		;(filter as any).authors = [opts.author.trim()]
	}

	// Enhanced relay selection
	const appRelay = configActions.getAppRelay()
	const allRelays = appRelay ? [...defaultRelaysUrls, appRelay] : defaultRelaysUrls
	const relaySet = NDKRelaySet.fromRelayUrls(allRelays, ndk)

	// Enhanced follows handling with better contact list processing
	let mutedPubkeys: Set<string> | null = null
	let followedPubkeys: Set<string> | null = null

	if (opts?.follows) {
		try {
			const user = await ndkActions.getUser()
			const pubkey = user?.pubkey
			if (!pubkey) return []

			// Fetch contact list with enhanced filtering
			const contactsFilter: NDKFilter = { kinds: [3], authors: [pubkey], limit: 1 }
			const contactEvents = await ndk.fetchEvents(contactsFilter, undefined, relaySet)
			const contactArr = Array.from(contactEvents)

			if (contactArr.length > 0) {
				const latest = contactArr.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
				const pTags = (latest?.tags || []).filter((t: any) => Array.isArray(t) && t[0] === 'p' && typeof t[1] === 'string')
				const followPubkeys = pTags.map((t: any) => t[1]) as string[]

				if (followPubkeys.length === 0) return []
				followedPubkeys = new Set(followPubkeys)

				// For follow feed, create batched queries (10 pubkeys per batch)
				// instead of querying all pubkeys individually
				const pubkeyBatches: string[][] = []
				const pubkeyArray = Array.from(followedPubkeys)

				// Create batches of 30 pubkeys
				for (let i = 0; i < pubkeyArray.length; i += 30) {
					const batch = pubkeyArray.slice(i, i + 30)
					pubkeyBatches.push(batch)
				}

				// We'll create batched filters when fetching events
				// This is handled when we set the 'authors' filter below
			} else {
				return []
			}

			// Enhanced mute list handling
			try {
				const muteFilter: NDKFilter = { kinds: [10000 as any], authors: [pubkey], limit: 1 }
				const muteEvents = await ndk.fetchEvents(muteFilter, undefined, relaySet)
				const muteArr = Array.from(muteEvents)

				if (muteArr.length > 0) {
					const latestMute = muteArr.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
					const pMuteTags = (latestMute?.tags || []).filter((t: any) => Array.isArray(t) && t[0] === 'p' && typeof t[1] === 'string')
					mutedPubkeys = new Set(pMuteTags.map((t: any) => t[1] as string))
				}
			} catch (_) {
				// Ignore mute fetching errors
			}
		} catch (_) {
			return []
		}
	}

	// Fetch events with enhanced error handling
	try {
		let allEvents: NDKEvent[] = []

		// For follows feed, fetch events in batches of 10 pubkeys at a time
		if (opts?.follows && followedPubkeys) {
			const pubkeyArray = Array.from(followedPubkeys)

			// Handle empty array edge case
			if (pubkeyArray.length === 0) {
				allEvents = []
			} else {
				// Process in batches of 10 pubkeys
				for (let i = 0; i < pubkeyArray.length; i += 10) {
					const batchPubkeys = pubkeyArray.slice(i, i + 10)
					if (batchPubkeys.length === 0) continue

					// Create a filter with the current batch of pubkeys
					const batchFilter: NDKFilter = {
						...filter,
						authors: batchPubkeys,
					}

					try {
						// Fetch events for this batch with timeout protection
						const batchEvents = await Promise.race([
							ndk.fetchEvents(batchFilter, undefined, relaySet),
							new Promise<Set<NDKEvent>>((resolve) => {
								setTimeout(() => resolve(new Set()), 5000) // 5 second timeout
							}),
						])
						allEvents = [...allEvents, ...Array.from(batchEvents)]
					} catch (error) {
						console.warn(`Failed to fetch batch of pubkeys ${i}-${i + 10}: ${error}`)
						// Continue with next batch even if this one fails
					}
				}
			}
		} else {
			// For non-follows feed, use the original filter
			const events = await ndk.fetchEvents(filter, undefined, relaySet)
			allEvents = Array.from(events)
		}

		// Enhanced filtering and validation
		const validNotes = allEvents.filter((e) => {
			if (!e || !(e as any).id) return false
			if (hasClientMostrTag(e) || isNSFWEvent(e)) return false

			// Get event data
			const eventAuthor = (e as any).pubkey as string
			const eventTags = (e as any).tags || []
			const pTags = eventTags.filter((t: any) => Array.isArray(t) && t[0] === 'p' && typeof t[1] === 'string')
			const mentionedPubkeys = pTags.map((t: any) => t[1] as string)

			// Check for muted users (both author and mentioned users)
			if (mutedPubkeys) {
				// Filter out notes authored by muted users
				if (mutedPubkeys.has(eventAuthor)) {
					return false
				}

				// Filter out notes containing p tags referencing muted users
				for (const mentionedPubkey of mentionedPubkeys) {
					if (mutedPubkeys.has(mentionedPubkey)) {
						return false
					}
				}
			}

			// For follow feed, only include notes authored by or mentioning followed users
			if (opts?.follows && followedPubkeys) {
				// Include if authored by a followed user
				if (followedPubkeys.has(eventAuthor)) {
					return true
				}

				// Include if mentions a followed user
				for (const mentionedPubkey of mentionedPubkeys) {
					if (followedPubkeys.has(mentionedPubkey)) {
						return true
					}
				}

				// If this is a follow feed and note doesn't match criteria, exclude it
				return false
			}

			return true
		})

		// Cache valid events
		validNotes.forEach((event) => {
			const id = (event as any).id
			if (id) {
				eventCache.set(id, event)

				// Handle replaceable events
				if (isReplaceableEvent((event as any).kind)) {
					const coordinate = getReplaceableCoordinate(event)
					const existing = replaceableEventCache.get(coordinate)
					if (!existing || ((event as any).created_at || 0) > ((existing as any).created_at || 0)) {
						replaceableEventCache.set(coordinate, event)
					}
				}
			}
		})

		// Enhanced metadata and sorting
		const enhanced = validNotes.map((e) => withEnhancedMetadata(e))

		// Multi-factor sorting: priority, then fetchedAt
		enhanced.sort((a, b) => {
			const priorityDiff = b.priority - a.priority
			if (Math.abs(priorityDiff) > 0.1) return priorityDiff
			return b.fetchedAt - a.fetchedAt
		})

		return enhanced
	} catch (error) {
		console.error('Enhanced notes fetch failed:', error)
		return []
	}
}

// Enhanced single note fetching
export const fetchEnhancedNote = async (id: string): Promise<EnhancedFetchedNDKEvent> => {
	// Check cache first
	const cached = eventCache.get(id)
	if (cached) {
		return withEnhancedMetadata(cached, true)
	}

	// Use DataLoader for batched fetching
	const event = await eventDataLoader.load(id)
	if (!event) {
		throw new Error('Post not found')
	}

	// Enhanced filtering
	if (hasClientMostrTag(event) || isNSFWEvent(event)) {
		throw new Error('Post filtered out')
	}

	// Cache the event
	eventCache.set(id, event)

	return withEnhancedMetadata(event)
}

// Enhanced query options
export const enhancedNoteQueryOptions = (id: string) =>
	queryOptions({
		queryKey: noteKeys.details(id),
		queryFn: () => fetchEnhancedNote(id),
		staleTime: 5 * 60 * 1000, // 5 minutes
	})

export const enhancedNotesQueryOptions = (opts?: { tag?: string; author?: string; follows?: boolean; limit?: number; kinds?: number[] }) =>
	queryOptions({
		queryKey: [
			...noteKeys.all,
			'enhanced-list',
			normalizeTag(opts?.tag) || '',
			opts?.author?.trim() || '',
			opts?.follows ? 'follows' : '',
			opts?.limit || 10,
			(opts?.kinds || SUPPORTED_KINDS).join(','),
		],
		queryFn: () => fetchEnhancedNotes(opts),
		staleTime: 2 * 60 * 1000, // 2 minutes for feeds
	})
