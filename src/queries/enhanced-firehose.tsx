// Enhanced event queries using jumble patterns for proper feed loading
// Implements DataLoader batching, multi-tier caching, and comprehensive event kind support

import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'
import { NDKRelaySet } from '@nostr-dev-kit/ndk'
import { queryOptions } from '@tanstack/react-query'
import { noteKeys } from '@/queries/queryKeyFactory'
import { ndkActions } from '@/lib/stores/ndk'
import { defaultRelaysUrls, writeRelaysUrls } from '@/lib/constants'
import { configActions } from '@/lib/stores/config'
import DataLoader from 'dataloader'
import { LRUCache } from 'typescript-lru-cache'

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
const eventCache = new LRUCache<string, NDKEvent>({ maxSize: 1000, entryExpirationTimeInMS: 1000 * 60 * 30 }) // 30 min TTL
const replaceableEventCache = new Map<string, NDKEvent>()
const firstFetchTimestamps = new Map<string, number>()
const lastDisplayedTimestamps = new Map<string, number>() // Track when events were last displayed
const relayTracker = new Map<string, Set<string>>() // eventId -> Set<relayUrl>

// DataLoader for batched event fetching
const eventDataLoader = new DataLoader<string, NDKEvent | null>(
	async (ids: readonly string[]) => {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		const allRelays = await getAugmentedRelayUrls()
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

// Track when an event is displayed to the user
export function updateEventDisplayTime(eventId: string): void {
	if (!eventId) return
	lastDisplayedTimestamps.set(eventId, Date.now())
}

// Get events that haven't been displayed recently
export function getStaleEvents(maxAge: number = 1000 * 60 * 60): string[] {
	const now = Date.now()
	const staleEvents: string[] = []

	// Check all events in the cache (avoid for...of to prevent downlevel iteration issues)
	eventCache.forEach((_value, key) => {
		const id = key as string
		const lastDisplayed = lastDisplayedTimestamps.get(id) || 0
		// If never displayed or displayed longer ago than maxAge
		if (lastDisplayed === 0 || now - lastDisplayed > maxAge) {
			staleEvents.push(id)
		}
	})

	return staleEvents
}

// Clean up stale events from cache to free memory
export function cleanupStaleEvents(maxAge: number = 1000 * 60 * 60, maxToRemove: number = 100): number {
	// Get stale events
	const staleEvents = getStaleEvents(maxAge)

	// Limit the number of events to remove at once to avoid performance issues
	const eventsToRemove = staleEvents.slice(0, maxToRemove)

	// Remove events from cache
	let removedCount = 0
	for (const id of eventsToRemove) {
		// Remove from main cache
		if (eventCache.delete(id)) {
			removedCount++
		}

		// Clean up associated metadata
		firstFetchTimestamps.delete(id)
		lastDisplayedTimestamps.delete(id)
		relayTracker.delete(id)
	}

	// Also check for any replaceable events that might be stale
	// This is a separate cache, so we handle it differently
	const now = Date.now()
	replaceableEventCache.forEach((repEvent, coordinate) => {
		const id = (repEvent as any)?.id
		if (!id) return

		const lastDisplayed = lastDisplayedTimestamps.get(id) || 0
		if (lastDisplayed === 0 || now - lastDisplayed > maxAge) {
			replaceableEventCache.delete(coordinate)
			removedCount++
		}
	})

	return removedCount
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

	const limit = opts?.limit ?? 10
	const kinds: number[] = opts?.kinds ?? [...SUPPORTED_KINDS]

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
	const allRelays = await getAugmentedRelayUrls()
	const relaySet = NDKRelaySet.fromRelayUrls(allRelays, ndk)
	// Optionally expanded relay set for follows feed (built from contact list relay hints)
	let followsRelaySet: NDKRelaySet | null = null

	// Enhanced follows handling with better contact list processing
	let mutedPubkeys: Set<string> | null = null
	let followedPubkeys: Set<string> | null = null

	if (opts?.follows) {
		try {
			const user = await ndkActions.getUser()
			const pubkey = user?.pubkey
			if (!pubkey) return []

			// Fetch contact list from the default relays to build the follows feed
			const contactsFilter: NDKFilter = { kinds: [3], authors: [pubkey], limit: 1 }
			let contactArr: NDKEvent[] = []
			try {
				const defaultEvents = await ndk.fetchEvents(contactsFilter, undefined, relaySet)
				contactArr = Array.from(defaultEvents)
			} catch (_) {}

			// Fallback: also try write relays if not found on default/app relays
			if (contactArr.length === 0) {
				try {
					const writeSet = NDKRelaySet.fromRelayUrls(writeRelaysUrls, ndk)
					const writeEvents = await ndk.fetchEvents(contactsFilter, undefined, writeSet)
					contactArr = Array.from(writeEvents)
				} catch (_) {}
			}

			// If found on default relays, republish latest contact list to the app's write relays for persistence
			if (contactArr.length > 0) {
				try {
					const latestToRepublish = contactArr.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
					const writeSet = NDKRelaySet.fromRelayUrls(writeRelaysUrls, ndk)
					await latestToRepublish.publish(writeSet)
				} catch (e) {
					console.warn('Failed to republish contact list to write relays', e)
				}
			}

			if (contactArr.length > 0) {
				const latest = contactArr.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
				const pTags = (latest?.tags || []).filter((t: any) => Array.isArray(t) && t[0] === 'p' && typeof t[1] === 'string')
				const followPubkeys = pTags.map((t: any) => t[1]) as string[]

				// Always include the logged-in user's own pubkey in the follows feed
				if (pubkey && !followPubkeys.includes(pubkey)) followPubkeys.push(pubkey)

				if (followPubkeys.length === 0) return []
				followedPubkeys = new Set(followPubkeys)

				// Expand relay set with any relay hints from contact list (third element of 'p' tags)
				try {
					const relayHints = pTags
						.map((t: any) => (typeof t[2] === 'string' ? t[2] : ''))
						.filter((u: string) => typeof u === 'string' && /^wss:\/\//i.test(u))
						.map((u: string) => u.trim())
						.filter((u: string) => !!u)
					const merged = Array.from(new Set<string>([...allRelays, ...relayHints]))
					// Cap number of extra relays to avoid overload (keep at most 20 more than defaults)
					const capped = merged.slice(0, allRelays.length + 20)
					followsRelaySet = NDKRelaySet.fromRelayUrls(capped, ndk)
				} catch (_) {}

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

		// For follows feed, fetch events in batches of 50 pubkeys at a time
		if (opts?.follows && followedPubkeys) {
			const pubkeyArray = Array.from(followedPubkeys)

			// Handle empty array edge case
			if (pubkeyArray.length === 0) {
				allEvents = []
			} else {
				// Iterate backwards in time until we have at least `limit` valid entries or hit max rounds
				const target = limit ?? 0
				let rounds = 0
				const maxRounds = 5
				let untilCursor: number | undefined = undefined
				const seenIds = new Set<string>()

				// Helper: event validity consistent with post-filtering
				const isValid = (e: NDKEvent): boolean => {
					try {
						if (!e || !(e as any).id) return false
						if (hasClientMostrTag(e) || isNSFWEvent(e)) return false
						const author = (e as any).pubkey as string
						if (mutedPubkeys && mutedPubkeys.has(author)) return false
						if (opts?.follows && followedPubkeys && !followedPubkeys.has(author)) return false
						if (mutedPubkeys) {
							const eventTags = (e as any).tags || []
							const pTags = eventTags.filter((t: any) => Array.isArray(t) && t[0] === 'p' && typeof t[1] === 'string')
							for (const t of pTags) {
								if (mutedPubkeys.has(t[1] as string)) return false
							}
						}
						return true
					} catch {
						return false
					}
				}

				while (rounds < maxRounds) {
					rounds++
					let roundFetched = 0
					let oldest = Number.POSITIVE_INFINITY

					for (let i = 0; i < pubkeyArray.length; i += 50) {
						const batchPubkeys = pubkeyArray.slice(i, i + 50)
						if (batchPubkeys.length === 0) continue

						const batchFilter: NDKFilter = {
							...filter,
							authors: batchPubkeys,
							// Use a larger per-batch limit so the final merge can select the newest
							limit: Math.max(limit, 100),
						}
						if (untilCursor && Number.isFinite(untilCursor)) {
							;(batchFilter as any).until = untilCursor
						}

						try {
							// Fetch events for this batch with timeout protection
							const batchEvents = await Promise.race([
								ndk.fetchEvents(batchFilter, undefined, followsRelaySet || relaySet),
								new Promise<Set<NDKEvent>>((resolve) => {
									setTimeout(() => resolve(new Set()), 6000) // 6 second timeout
								}),
							])
							const arr = Array.from(batchEvents)
							for (const ev of arr) {
								const id = (ev as any).id as string
								if (!id || seenIds.has(id)) continue
								seenIds.add(id)
								allEvents.push(ev)
								roundFetched++
								const c = (ev as any).created_at ?? 0
								if (typeof c === 'number' && c > 0 && c < oldest) oldest = c
							}
						} catch (error) {
							console.warn(`Failed to fetch batch of pubkeys ${i}-${i + 50}: ${error}`)
							// Continue with next batch even if this one fails
						}
					}

					// Stop if we already have enough valid entries
					const validSoFar = allEvents.filter(isValid)
					if (validSoFar.length >= target) break

					// If nothing new fetched or no older timestamp, stop
					if (roundFetched === 0 || !Number.isFinite(oldest)) break
					untilCursor = Math.floor(oldest - 1)
				}
			}
		} else {
			// For non-follows views, iteratively expand the time window (doubling each round)
			// until we have enough valid entries.
			const target = limit ?? 0
			let rounds = 0
			const maxRounds = 6
			let windowSeconds = 2 * 60 * 60 // start with 2 hours
			const nowSec = Math.floor(Date.now() / 1000)
			const seenIds = new Set<string>()
			// Helper aligned with later validation (minus follows-only checks)
			const isValid = (e: NDKEvent): boolean => {
				try {
					if (!e || !(e as any).id) return false
					if (hasClientMostrTag(e) || isNSFWEvent(e)) return false
					// Basic mute handling when available
					if (mutedPubkeys) {
						const author = (e as any).pubkey as string
						if (mutedPubkeys.has(author)) return false
						const eventTags = (e as any).tags || []
						for (const t of eventTags) {
							if (Array.isArray(t) && t[0] === 'p' && typeof t[1] === 'string' && mutedPubkeys.has(t[1])) return false
						}
					}
					return true
				} catch {
					return false
				}
			}
			while (rounds < maxRounds) {
				rounds++
				const roundFilter: NDKFilter = {
					...filter,
					limit: Math.max(limit, 200),
					since: nowSec - windowSeconds,
				}
				try {
					const roundEvents = await Promise.race([
						ndk.fetchEvents(roundFilter, undefined, relaySet),
						new Promise<Set<NDKEvent>>((resolve) => setTimeout(() => resolve(new Set()), 6000)),
					])
					const arr = Array.from(roundEvents)
					for (const ev of arr) {
						const id = (ev as any).id as string
						if (!id || seenIds.has(id)) continue
						seenIds.add(id)
						allEvents.push(ev)
					}
				} catch (err) {
					console.warn('Non-follows round fetch failed:', err)
				}
				const validSoFar = allEvents.filter(isValid)
				if (validSoFar.length >= target) break
				// Double the time window for the next attempt
				windowSeconds *= 2
			}
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

			// For follows feed, strictly include only notes authored by followed users
			if (opts?.follows && followedPubkeys) {
				return followedPubkeys.has(eventAuthor)
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

		// Sort by newest first using created_at primarily to ensure freshest posts are shown
		enhanced.sort((a, b) => {
			const aCreated = ((a.event as any)?.created_at ?? 0) as number
			const bCreated = ((b.event as any)?.created_at ?? 0) as number
			if (bCreated !== aCreated) return bCreated - aCreated
			// Tie-breakers: higher priority first, then by fetchedAt (newer first)
			const priorityDiff = b.priority - a.priority
			if (priorityDiff !== 0) return priorityDiff
			return b.fetchedAt - a.fetchedAt
		})

		// Enforce final limit after merging/sorting across batches to guarantee newest
		return enhanced.slice(0, limit)
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
		queryFn: async () => {
			// When fetching a specific note, update its display timestamp
			const note = await fetchEnhancedNote(id)
			// Mark as displayed immediately (will be updated again by IntersectionObserver when actually in view)
			updateEventDisplayTime(id)
			return note
		},
		staleTime: 5 * 60 * 1000, // 5 minutes
	})

export const enhancedNotesQueryOptions = (opts?: {
	tag?: string
	author?: string
	follows?: boolean
	limit?: number
	kinds?: number[]
	cacheKey?: string
}) =>
	queryOptions({
		queryKey: [
			...noteKeys.all,
			'enhanced-list',
			normalizeTag(opts?.tag) || '',
			opts?.author?.trim() || '',
			opts?.follows ? 'follows' : '',
			opts?.cacheKey || '',
			(opts?.kinds || SUPPORTED_KINDS).join(','),
		],
		queryFn: () => fetchEnhancedNotes(opts),
		staleTime: 2 * 60 * 1000, // 2 minutes for feeds
	})

// Infinite paging support: fetch a single page with optional cursors
export type EnhancedNotesPage = {
	items: EnhancedFetchedNDKEvent[]
	oldest: number | null // created_at of oldest item in this page
	newest: number | null // created_at of newest item in this page
}

export async function fetchEnhancedNotesPage(
	opts?: { tag?: string; author?: string; follows?: boolean; kinds?: number[] },
	page?: { since?: number; until?: number; pageSize?: number },
): Promise<EnhancedNotesPage> {
	const ndk = ndkActions.getNDK()
	if (!ndk) return { items: [], oldest: null, newest: null }

	const kinds: number[] = opts?.kinds ?? [...SUPPORTED_KINDS]
	const pageSize = Math.max(1, page?.pageSize ?? 4)

	// Build base filter
	const filter: NDKFilter = { kinds, limit: Math.max(100, pageSize * 25) }
	const normTag = normalizeTag(opts?.tag)
	if (normTag) (filter as any)['#t'] = [normTag]
	if (opts?.author && opts.author.trim()) (filter as any).authors = [opts.author.trim()]
	if (typeof page?.since === 'number') (filter as any).since = Math.floor(page!.since!)
	if (typeof page?.until === 'number') (filter as any).until = Math.floor(page!.until!)

	const allRelays = await getAugmentedRelayUrls()
	const relaySet = NDKRelaySet.fromRelayUrls(allRelays, ndk)

	// Follows/mutes
	let mutedPubkeys: Set<string> | null = null
	let followedPubkeys: Set<string> | null = null
	if (opts?.follows) {
		try {
			const user = await ndkActions.getUser()
			const pubkey = user?.pubkey
			if (!pubkey) return { items: [], oldest: null, newest: null }
			// Contact list
			const contactsFilter: NDKFilter = { kinds: [3], authors: [pubkey], limit: 1 }
			const contacts = await ndk.fetchEvents(contactsFilter, undefined, relaySet)
			const arr = Array.from(contacts)
			if (arr.length > 0) {
				const latest = arr.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
				const pTags = (latest?.tags || []).filter((t: any) => Array.isArray(t) && t[0] === 'p' && typeof t[1] === 'string')
				const followPubkeys = pTags.map((t: any) => t[1]) as string[]
				if (pubkey && !followPubkeys.includes(pubkey)) followPubkeys.push(pubkey)
				followedPubkeys = new Set(followPubkeys)
				// Do not constrain the filter by authors here; instead, use the same pattern as the global feed
				// by fetching broadly and applying follows post-filtering below.
			} else {
				return { items: [], oldest: null, newest: null }
			}
			// Mutes
			try {
				const muteFilter: NDKFilter = { kinds: [10000 as any], authors: [pubkey], limit: 1 }
				const muteEvents = await ndk.fetchEvents(muteFilter, undefined, relaySet)
				const muteArr = Array.from(muteEvents)
				if (muteArr.length > 0) {
					const latestMute = muteArr.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
					const pMuteTags = (latestMute?.tags || []).filter((t: any) => Array.isArray(t) && t[0] === 'p' && typeof t[1] === 'string')
					mutedPubkeys = new Set(pMuteTags.map((t: any) => t[1] as string))
				}
			} catch {}
		} catch {}
	}

	try {
		const result = await Promise.race([
			ndk.fetchEvents(filter, undefined, relaySet),
			new Promise<Set<NDKEvent>>((resolve) => setTimeout(() => resolve(new Set()), 7000)),
		])
		const all = Array.from(result)
		// Filtering similar to main path
		const filtered = all.filter((e) => {
			try {
				if (!e || !(e as any).id) return false
				if (hasClientMostrTag(e) || isNSFWEvent(e)) return false
				const author = (e as any).pubkey as string
				if (mutedPubkeys && mutedPubkeys.has(author)) return false
				if (opts?.follows && followedPubkeys && !followedPubkeys.has(author)) return false
				if (mutedPubkeys) {
					const tags = (e as any).tags || []
					for (const t of tags) {
						if (Array.isArray(t) && t[0] === 'p' && typeof t[1] === 'string' && mutedPubkeys.has(t[1])) return false
					}
				}
				return true
			} catch {
				return false
			}
		})
		// Sort newest first
		filtered.sort((a, b) => ((b as any).created_at ?? 0) - ((a as any).created_at ?? 0))
		const sliced = filtered.slice(0, pageSize)
		const enhanced = sliced.map((e) => withEnhancedMetadata(e))
		const newest = enhanced.length > 0 ? (((enhanced[0].event as any).created_at as number) ?? null) : null
		const oldest = enhanced.length > 0 ? (((enhanced[enhanced.length - 1].event as any).created_at as number) ?? null) : null
		return { items: enhanced, oldest, newest }
	} catch (e) {
		console.warn('fetchEnhancedNotesPage failed', e)
		return { items: [], oldest: null, newest: null }
	}
}

// Helper: fetch and cache user's relay list (NIP-65 kind:10002)
let __userRelayCache: { urls: string[]; fetchedAt: number } | null = null
const USER_RELAY_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export async function getUserRelayUrls(): Promise<string[]> {
	try {
		const now = Date.now()
		if (__userRelayCache && now - __userRelayCache.fetchedAt < USER_RELAY_CACHE_TTL_MS) {
			return __userRelayCache.urls
		}
		const ndk = ndkActions.getNDK()
		if (!ndk) return []
		const user = await ndkActions.getUser()
		const pubkey = user?.pubkey
		if (!pubkey) return []

		const appRelay = configActions.getAppRelay()
		const baseRelays = appRelay ? [...defaultRelaysUrls, appRelay] : defaultRelaysUrls
		const trySets: NDKRelaySet[] = [NDKRelaySet.fromRelayUrls(baseRelays, ndk), NDKRelaySet.fromRelayUrls(writeRelaysUrls, ndk)]
		let found: NDKEvent | null = null
		for (const rs of trySets) {
			try {
				const filter: NDKFilter = { kinds: [10002 as any], authors: [pubkey], limit: 1 }
				const result = await ndk.fetchEvents(filter, undefined, rs)
				const arr = Array.from(result)
				if (arr.length > 0) {
					found = arr.sort((a, b) => ((b as any).created_at ?? 0) - ((a as any).created_at ?? 0))[0]
					break
				}
			} catch (_) {}
		}
		const relays: string[] = []
		if (found) {
			const tags = ((found as any).tags || []) as any[]
			for (const t of tags) {
				if (Array.isArray(t) && t[0] === 'r' && typeof t[1] === 'string') {
					const url = t[1].trim()
					if (/^wss:\/\//i.test(url)) relays.push(url)
				}
			}
		}
		const unique = Array.from(new Set(relays))
		__userRelayCache = { urls: unique, fetchedAt: now }
		return unique
	} catch {
		return []
	}
}

export async function getAugmentedRelayUrls(): Promise<string[]> {
	const ndk = ndkActions.getNDK()
	if (!ndk) return defaultRelaysUrls
	const appRelay = configActions.getAppRelay()
	const base = appRelay ? [...defaultRelaysUrls, appRelay] : [...defaultRelaysUrls]
	let userRelays: string[] = []
	try {
		userRelays = await getUserRelayUrls()
	} catch {}
	const merged = Array.from(new Set<string>([...base, ...userRelays]))
	// Cap to a reasonable number to avoid overload (keep at most 40 total)
	return merged.slice(0, 40)
}
