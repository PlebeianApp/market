import { useQuery } from '@tanstack/react-query'
import { getBugRelay, ndkActions } from '@/lib/stores/ndk'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { NDKRelaySet } from '@nostr-dev-kit/ndk'
import { buildBugReportsFilter, parseBugReports, type BugReport as SdkBugReport } from '@sdk/commerce/messaging/bugReportRead'

export type BugReport = SdkBugReport<NDKEvent>

export interface UserProfile {
	pubkey: string
	name?: string
	displayName?: string
	picture?: string
	about?: string
}

/**
 * Fetches bug reports (kind 1 events) from the instance's bug relay
 * (ADR-018 `bugRelay`, falling back to the main app relay) with t tag
 * "plebian2beta"
 */
export const fetchBugReports = async (limit: number = 20, until?: number): Promise<BugReport[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	const relayUrl = getBugRelay()
	if (!relayUrl) throw new Error('App relay not configured')

	// Query the bug relay explicitly so bug report history stays off the write set.
	const bugRelaySet = NDKRelaySet.fromRelayUrls([relayUrl], ndk)
	const events = await ndk.fetchEvents(buildBugReportsFilter(limit, until), { subId: 'bug-reports' }, bugRelaySet)
	return parseBugReports(events)
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
