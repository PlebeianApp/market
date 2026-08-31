import { useQuery } from '@tanstack/react-query'
import { getMainRelay, ndkActions } from '@/lib/stores/ndk'
import { applesauceIo } from '@/lib/nostr/io'
import { fetchNdkEventSet, type NDKEvent, type NDKFilter } from '@/lib/nostr/ndk-events'

export interface BugReport {
	id: string
	pubkey: string
	content: string
	createdAt: number
	event: NDKEvent
}

export interface UserProfile {
	pubkey: string
	name?: string
	displayName?: string
	picture?: string
	about?: string
}

/**
 * Fetches bug reports (kind 1 events) from the standard app relay
 * with t tag "plebian2beta"
 */
export const fetchBugReports = async (limit: number = 20, until?: number): Promise<BugReport[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	const relayUrl = getMainRelay()
	if (!relayUrl) throw new Error('App relay not configured')

	const filter: NDKFilter = {
		kinds: [1], // kind 1 is text notes
		'#t': ['plebian2beta'], // tag filter for plebian2beta
		limit,
		...(until && { until }),
	}

	// Query the app relay explicitly (seam relayUrls pin, ADR-0002) so bug
	// report history stays on the standard relay. Raw events are verified and
	// rehydrated into NDKEvents so consumer shapes stay identical.
	const events = await fetchNdkEventSet(applesauceIo, ndk, filter, { relayUrls: [relayUrl] })
	const bugReports = Array.from(events)
		.map(
			(event): BugReport => ({
				id: event.id,
				pubkey: event.pubkey,
				content: event.content,
				createdAt: event.created_at ?? Math.floor(Date.now() / 1000),
				event,
			}),
		)
		.sort((a, b) => b.createdAt - a.createdAt) // Sort by newest first

	return bugReports
}

// Query keys
export const bugReportKeys = {
	all: ['bugReports'] as const,
	lists: () => [...bugReportKeys.all, 'list'] as const,
	list: (limit: number, until?: number) => [...bugReportKeys.lists(), limit, until] as const,
	profiles: () => [...bugReportKeys.all, 'profiles'] as const,
	profile: (pubkey: string) => [...bugReportKeys.profiles(), pubkey] as const,
}

// React Query options for bug reports
export const bugReportsQueryOptions = (limit: number = 20, until?: number) => ({
	queryKey: bugReportKeys.list(limit, until),
	queryFn: () => fetchBugReports(limit, until),
	staleTime: 5 * 60 * 1000, // 5 minutes
})

// Hooks
export const useBugReports = (limit: number = 20, until?: number) => {
	return useQuery(bugReportsQueryOptions(limit, until))
}
