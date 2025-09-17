// queries for kind 1 feeds

import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'
import { NDKRelaySet } from '@nostr-dev-kit/ndk'
import { queryOptions } from '@tanstack/react-query'
import { noteKeys } from '@/queries/queryKeyFactory'
import { ndkActions } from '@/lib/stores/ndk'
import { defaultRelaysUrls } from '@/lib/constants'
import { configActions } from '@/lib/stores/config'

// Wrapper type to include the timestamp of when the event was first fetched
export type FetchedNDKEvent = {
	event: NDKEvent
	fetchedAt: number // ms since epoch
}

// Keep a module-level cache to preserve the first-fetched timestamp per event id
const firstFetchTimestamps = new Map<string, number>()

// Utility function to check if an event has a "client:Mostr" tag
function hasClientMostrTag(event: NDKEvent): boolean {
	const tags = (event as any)?.tags
	if (!Array.isArray(tags)) return false

	return tags.some((tag) => Array.isArray(tag) && tag.length >= 2 && tag[0] === 'client' && tag[1] === 'Mostr')
}

// Utility function to detect NSFW via t:nsfw tag or #nsfw in content
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

// Normalize user-provided tag filter text
function normalizeTag(input?: string): string | undefined {
	if (typeof input !== 'string') return undefined
	const trimmed = input.trim()
	if (!trimmed) return undefined
	const withoutHash = trimmed.replace(/^#/, '')
	return withoutHash.toLowerCase()
}

function withFirstFetchedAt(e: NDKEvent): FetchedNDKEvent {
	const id = e.id as string
	const existing = id ? firstFetchTimestamps.get(id) : undefined
	const now = Date.now()
	const ts = existing ?? now
	if (id && existing === undefined) {
		firstFetchTimestamps.set(id, ts)
	}
	return { event: e, fetchedAt: ts }
}

export const fetchNotes = async (opts?: { tag?: string; author?: string; follows?: boolean }): Promise<FetchedNDKEvent[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const filter: NDKFilter = {
		kinds: [1, 1111], // kind 1 is text notes, kind 1111 is replies
		limit: 200,
	}

 // If a tag filter is provided, constrain to events with that 't' tag
	const normTag = normalizeTag(opts?.tag)
	if (normTag) {
		;(filter as any)['#t'] = [normTag]
	}
	// If an author filter is provided (pubkey), constrain to that author
	if (opts?.author && typeof opts.author === 'string' && opts.author.trim()) {
		;(filter as any).authors = [opts.author.trim()]
	}

 // Ensure we query using the default relay URLs plus the home relay if available
	const appRelay = configActions.getAppRelay()
	const allRelays = appRelay ? [...defaultRelaysUrls, appRelay] : defaultRelaysUrls
	const relaySet = NDKRelaySet.fromRelayUrls(allRelays, ndk)

	// If follows mode is requested, fetch the current user's contact list and limit authors
	let mutedPubkeys: Set<string> | null = null
	if (opts?.follows) {
		try {
			const user = await ndkActions.getUser()
			const pubkey = user?.pubkey
			if (!pubkey) {
				return []
			}
			const contactsFilter: NDKFilter = { kinds: [3], authors: [pubkey], limit: 1 }
			const contactEvents = await ndk.fetchEvents(contactsFilter, undefined, relaySet)
			const contactArr = Array.from(contactEvents)
			if (contactArr.length > 0) {
				const latest = contactArr.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
				const pTags = (latest?.tags || []).filter((t: any) => Array.isArray(t) && t[0] === 'p' && typeof t[1] === 'string')
				const followPubkeys = pTags.map((t: any) => t[1]) as string[]
				if (followPubkeys.length === 0) {
					return []
				}
				;(filter as any).authors = followPubkeys
			} else {
				return []
			}
			// Fetch mute list (kind 10000) and build muted set
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
				// ignore mute fetching errors
			}
		} catch (_) {
			return []
		}
	}

	const events = await ndk.fetchEvents(filter, undefined, relaySet)
	const notes = Array.from(events)
	// Filter out any falsy events or events without an id to avoid downstream crashes
	const validNotes = notes.filter((e) => !!e && !!(e as any).id)
	// Filter out events with client:Mostr tags and NSFW and (in follows mode) mutes
	const filteredNotes = validNotes.filter((e) => {
		if (hasClientMostrTag(e) || isNSFWEvent(e)) return false
		if (opts?.follows && mutedPubkeys && (e as any).pubkey) {
			return !mutedPubkeys.has(((e as any).pubkey as string))
		}
		return true
	})
	// Map to include first-fetched timestamps and then sort by fetchedAt desc
	const wrapped = filteredNotes.map(withFirstFetchedAt)
	wrapped.sort((a, b) => b.fetchedAt - a.fetchedAt)
	return wrapped
}

export const fetchNote = async (id: string): Promise<FetchedNDKEvent> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const event = await ndk.fetchEvent(id)
	if (!event) {
		throw new Error('Post not found')
	}
	// Filter out events with client:Mostr tags and NSFW
	if (hasClientMostrTag(event) || isNSFWEvent(event)) {
		throw new Error('Post filtered out')
	}
	return withFirstFetchedAt(event)
}

export const noteQueryOptions = (id: string) =>
	queryOptions({
		queryKey: noteKeys.details(id),
		queryFn: () => fetchNote(id),
	})

export const notesQueryOptions = (opts?: { tag?: string; author?: string; follows?: boolean }) =>
	queryOptions({
		queryKey: [...noteKeys.all, 'list', normalizeTag(opts?.tag) || '', opts?.author?.trim() || '', opts?.follows ? 'follows' : ''],
		queryFn: () => fetchNotes(opts),
	})
