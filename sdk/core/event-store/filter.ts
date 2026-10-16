import type { NostrEventLike } from '../nostr/eventLike'

export interface EventFilter {
	ids?: string[]
	authors?: string[]
	kinds?: number[]
	since?: number
	until?: number
	limit?: number
	/** Tag filters such as `#d`, `#p`, `#t`. */
	[tagFilter: `#${string}`]: string[] | undefined
}

export function matchesFilter(event: NostrEventLike, filter: EventFilter): boolean {
	if (filter.ids && !filter.ids.includes(event.id)) return false
	if (filter.authors && !filter.authors.includes(event.pubkey)) return false
	if (filter.kinds && !filter.kinds.includes(event.kind)) return false
	const createdAt = event.created_at ?? 0
	if (filter.since !== undefined && createdAt < filter.since) return false
	if (filter.until !== undefined && createdAt > filter.until) return false

	for (const [key, values] of Object.entries(filter)) {
		if (!key.startsWith('#') || !values) continue
		const tagName = key.slice(1)
		const wanted = values as string[]
		if (!event.tags.some((tag) => tag[0] === tagName && wanted.includes(tag[1]))) return false
	}

	return true
}

/** Newest first, then by id; `limit` applies per filter as on relays. */
export function selectMatching<E extends NostrEventLike>(events: Iterable<E>, filters: EventFilter | readonly EventFilter[]): E[] {
	const list = Array.isArray(filters) ? filters : [filters as EventFilter]
	const byNewest = [...events].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0) || a.id.localeCompare(b.id))
	const selected = new Map<string, E>()
	for (const filter of list) {
		const matched = byNewest.filter((event) => matchesFilter(event, filter))
		for (const event of filter.limit !== undefined ? matched.slice(0, filter.limit) : matched) selected.set(event.id, event)
	}
	return [...selected.values()].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0) || a.id.localeCompare(b.id))
}
