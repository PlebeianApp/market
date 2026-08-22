import { useEffect, useRef, useState } from 'react'
import type { NostrEventLike } from './eventLike'
import type { NostrFilter } from './io'
import { applesauceIo } from './io'

/**
 * Live subscription to a Nostr filter via the applesauce I/O adapter.
 *
 * Streams events as they arrive (deduped by id, sorted newest-first) and
 * tracks an `isStreaming` flag that flips off once the subscription has been
 * established for a grace period. The `NostrIo` port deliberately has no EOSE
 * callback, so the grace timeout is the only signal that "loading" is done.
 *
 * Returns a cleanup-safe unsubscribe on unmount and when `filter`/`enabled`
 * change.
 */
export function useSubscriptionEvents(
	filter: NostrFilter | NostrFilter[] | null,
	enabled: boolean,
): { events: NostrEventLike[]; isStreaming: boolean } {
	const [events, setEvents] = useState<NostrEventLike[]>([])
	const [isStreaming, setIsStreaming] = useState(false)
	const seenIds = useRef(new Set<string>())

	// Serialize the filter so we only re-subscribe when it actually changes,
	// not on every render where the caller allocates a fresh array.
	const filterKey = filter ? JSON.stringify(filter) : null

	useEffect(() => {
		if (!enabled || !filter) return

		seenIds.current.clear()
		setEvents([])
		setIsStreaming(true)

		const unsubscribe = applesauceIo.subscribe(filter, (event) => {
			if (seenIds.current.has(event.id)) return
			seenIds.current.add(event.id)
			setEvents((prev) => {
				if (prev.some((e) => e.id === event.id)) return prev
				return [...prev, event].sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
			})
		})

		// Flip the streaming flag off after a grace window so loading states
		// resolve even when the relay never reaches (or reports) EOSE.
		const timer = setTimeout(() => setIsStreaming(false), 10000)

		return () => {
			clearTimeout(timer)
			unsubscribe()
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [enabled, filterKey])

	return { events, isStreaming }
}
