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
	for (const fe of events) {
		const eid = fe.event.id as string | undefined
		if (!eid) continue
		const replyParents = findAllReplyParentIds(fe.event)
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
	for (const fe of events) {
		const id = fe.event.id as string | undefined
		if (id && !seen.has(id)) ordered.push({ ...fe, depth: 0 })
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
	const rootId = findTagByMarker(eTags, 'root') || (baseEvent.id as string)
	if (!rootId) throw new Error('Unable to determine root id')

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
		if (e?.id) all.set(e.id as string, e)
	})
	threadSet.forEach((e) => {
		if (e?.id) all.set(e.id as string, e)
	})

	// Wrap and order
	const wrapped = Array.from(all.values()).map(withFirstFetchedAt)
	const ordered = orderThread(rootId, wrapped)

	return { rootId, ordered, byId: new Map(ordered.map((fe) => [fe.event.id as string, fe])) }
}

export const threadQueryOptions = (input: FetchedNDKEvent | string) =>
	queryOptions({
		queryKey: ['thread', typeof input === 'string' ? input : (input?.event as any)?.id ?? 'unknown'],
		queryFn: () => fetchThread(input),
	})
