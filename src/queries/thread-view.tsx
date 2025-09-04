import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'
import { NDKRelaySet } from '@nostr-dev-kit/ndk'
import { queryOptions } from '@tanstack/react-query'
import { ndkActions } from '@/lib/stores/ndk'
import { defaultRelaysUrls } from '@/lib/constants'
import type { FetchedNDKEvent } from '@/queries/firehose'

// Thread event with depth information for proper indentation display
export type ThreadEvent = FetchedNDKEvent & {
	depth: number
}

// Local first-fetched cache to keep consistent ordering with other queries
const firstFetchTimestamps = new Map<string, number>()

// Utility function to check if an event has a "client:Mostr" tag
function hasClientMostrTag(event: NDKEvent): boolean {
	const tags = (event as any)?.tags
	if (!Array.isArray(tags)) return false

	return tags.some((tag) => Array.isArray(tag) && tag.length >= 2 && tag[0] === 'client' && tag[1] === 'Mostr')
}

function withFirstFetchedAt(e: NDKEvent): FetchedNDKEvent {
	const id = e.id as string
	const existing = id ? firstFetchTimestamps.get(id) : undefined
	const now = Date.now()
	const ts = existing ?? now
	if (id && existing === undefined) firstFetchTimestamps.set(id, ts)
	return { event: e, fetchedAt: ts }
}

// Helpers to safely read tags
function getETags(ev: NDKEvent): any[][] {
	const tags = (ev as any)?.tags
	if (Array.isArray(tags)) return tags.filter((t) => Array.isArray(t) && t[0] === 'e') as any[][]
	return []
}

function findTagByMarker(tags: any[][], marker: string): string | undefined {
	for (const t of tags) {
		// expected shape: ["e", <id>, <relay?>, <marker>]
		if (t[0] === 'e' && t[3] === marker && typeof t[1] === 'string') return t[1] as string
	}
	return undefined
}

function findAllReplyParentIds(ev: NDKEvent): string[] {
	const tags = getETags(ev)
	const ids: string[] = []
	for (const t of tags) {
		if (t[0] === 'e' && t[3] === 'reply' && typeof t[1] === 'string') ids.push(t[1])
	}
	return ids
}

function hasRootTag(ev: NDKEvent, rootId?: string): boolean {
	const tags = getETags(ev)
	const rootTagId = findTagByMarker(tags, 'root')

	// If no specific rootId is provided, just check if any root tag exists
	if (rootId === undefined) return rootTagId !== undefined

	// If rootId is provided, verify the root tag points to the correct root
	return rootTagId === rootId
}

function isValidReply(ev: NDKEvent, rootId: string): boolean {
	const eid = ev.id as string | undefined
	if (!eid) return false

	// Check if note's ID equals root ID (self-referencing)
	if (eid === rootId) return false

	// Check for traditional reply structure: BOTH root and reply tags
	const hasRoot = hasRootTag(ev, rootId)
	const replyParents = findAllReplyParentIds(ev)
	const hasReply = replyParents.length > 0

	// Allow traditional replies with both root and reply tags
	if (hasRoot && hasReply) return true

	// NEW: Allow notes with only reply tags where the reply target matches the root
	// This handles cases where notes have only 'reply' tags and we designate their root
	// parent as the event ID in the e tag index 1
	if (!hasRoot && hasReply) {
		// Check if any reply tag points to the current rootId
		return replyParents.includes(rootId)
	}

	return false
}

export type ThreadFetchResult = {
	rootId: string
	ordered: ThreadEvent[]
	byId: Map<string, ThreadEvent>
}

// Build an ordered thread starting at a root id, placing replies immediately after their parent (depth-first)
function orderThread(rootId: string, events: FetchedNDKEvent[]): ThreadEvent[] {
	const byId = new Map<string, FetchedNDKEvent>()
	for (const fe of events) if (fe.event.id) byId.set(fe.event.id as string, fe)

	// Build parent -> children mapping from reply tags
	const children = new Map<string, FetchedNDKEvent[]>()
	const filteredEventIds = new Set<string>() // Track events that should be completely excluded

	for (const fe of events) {
		const eid = fe.event.id as string | undefined
		if (!eid) continue
		const replyParents = findAllReplyParentIds(fe.event)
		const eTags = getETags(fe.event)
		const hasAnyETags = eTags.length > 0

		// Filter out any event that has e tags but doesn't meet valid reply criteria
		// OR has reply parents but isn't a valid reply
		if (hasAnyETags && !isValidReply(fe.event, rootId) && eid !== rootId) {
			filteredEventIds.add(eid) // Mark this event as filtered
			continue // Skip this event as it doesn't meet reply requirements
		}

		for (const pid of replyParents) {
			if (!children.has(pid)) children.set(pid, [])
			children.get(pid)!.push(fe)
		}
	}

	const ordered: ThreadEvent[] = []
	const seen = new Set<string>()

	function dfs(currentId: string, depth: number = 0) {
		const cur = byId.get(currentId)
		if (cur && !seen.has(currentId)) {
			seen.add(currentId)
			ordered.push({ ...cur, depth })
		}
		const kids = children.get(currentId) || []
		// Place replies immediately after parent in a stable order (by fetchedAt asc)
		kids.sort((a, b) => a.fetchedAt - b.fetchedAt)
		for (const child of kids) {
			const cid = child.event.id as string | undefined
			if (cid && !seen.has(cid)) dfs(cid, depth + 1)
		}
	}

	dfs(rootId, 0)

	// Append any remaining events that weren't reachable from root (safety)
	// BUT exclude events that were filtered out for lacking proper root tags
	for (const fe of events) {
		const id = fe.event.id as string | undefined
		if (id && !seen.has(id) && !filteredEventIds.has(id)) {
			ordered.push({ ...fe, depth: 0 })
		}
	}
	return ordered
}

// Fetch the thread for a given event (by object or id):
// - Determine root id from 'e' tag marker 'root' (index 3)
// - Fetch root event and all events that reference the root in their 'e' tags
export async function fetchThread(input: FetchedNDKEvent | string): Promise<ThreadFetchResult> {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	let baseEvent: NDKEvent | undefined
	let startId: string

	if (typeof input === 'string') {
		startId = input
		const fetched = await ndk.fetchEvent(startId)
		if (fetched) baseEvent = fetched
	} else {
		baseEvent = input.event
		startId = (baseEvent.id as string) || ''
	}

	if (!baseEvent && startId) {
		// attempt to fetch it so we can inspect tags
		const fetched = await ndk.fetchEvent(startId)
		if (fetched) baseEvent = fetched
	}

	if (!baseEvent) throw new Error('Base event not found')

	const eTags = getETags(baseEvent)

	// Only use proper 'root' marker - no fallback to reply targets or event ID
	const rootId = findTagByMarker(eTags, 'root')
	console.log('rootId', rootId)
	if (!rootId) throw new Error('Unable to determine root id - no root tag found')

	// Build filters: fetch the root event and all that reference it
	// Standard Nostr threading uses kind 1 and potentially others like 1111; include both as in firehose
	const relaySet = NDKRelaySet.fromRelayUrls(defaultRelaysUrls, ndk)

	const rootFilter: NDKFilter = { ids: [rootId], kinds: [1, 1111], limit: 1 }
	const threadFilter: NDKFilter = { kinds: [1, 1111], '#e': [rootId], limit: 500 }

	const [rootSet, threadSet] = await Promise.all([
		ndk.fetchEvents(rootFilter, undefined, relaySet),
		ndk.fetchEvents(threadFilter, undefined, relaySet),
	])

	const all = new Map<string, NDKEvent>()
	rootSet.forEach((e) => {
		if (e?.id && !hasClientMostrTag(e)) all.set(e.id as string, e)
		console.log('mostr root', hasClientMostrTag(e))
	})
	threadSet.forEach((e) => {
		if (e?.id && !hasClientMostrTag(e)) all.set(e.id as string, e)
		console.log('mostr reply', hasClientMostrTag(e))
	})
	// Wrap and order
	const wrapped = Array.from(all.values()).map(withFirstFetchedAt)
	const ordered = orderThread(rootId, wrapped)

	return { rootId, ordered, byId: new Map(ordered.map((fe) => [fe.event.id as string, fe])) }
}

export const threadQueryOptions = (input: FetchedNDKEvent | string) =>
	queryOptions({
		queryKey: ['thread', typeof input === 'string' ? input : ((input?.event as any)?.id ?? 'unknown')],
		queryFn: () => fetchThread(input),
	})
