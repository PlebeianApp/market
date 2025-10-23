import { useQuery } from '@tanstack/react-query'
import { ndkActions } from '@/lib/stores/ndk'
import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'

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
 * Fetches bug reports (kind 1 events) from bugs.plebeian.market relay
 * with t tag "plebian2beta"
 */
export const fetchBugReports = async (limit: number = 20, until?: number): Promise<BugReport[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	// Ensure bugs.plebeian.market relay is added
	ndkActions.addSingleRelay('wss://bugs.plebeian.market/')

	const filter: NDKFilter = {
		kinds: [1], // kind 1 is text notes
		'#t': ['plebian2beta'], // tag filter for plebian2beta
		limit,
		...(until && { until }),
	}

	const events = await ndk.fetchEvents(filter)
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

/**
 * Fetches user profile (kind 0 event) for a given pubkey
 */
export const fetchUserProfile = async (pubkey: string): Promise<UserProfile | null> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const filter: NDKFilter = {
		kinds: [0], // kind 0 is profile metadata
		authors: [pubkey],
		limit: 1,
	}

	const events = await ndk.fetchEvents(filter)
	const eventArray = Array.from(events)

	if (eventArray.length === 0) {
		return null
	}

	const event = eventArray[0]
	let profile: UserProfile

	try {
		const content = JSON.parse(event.content)
		profile = {
			pubkey,
			name: content.name,
			displayName: content.display_name,
			picture: content.picture,
			about: content.about,
		}
	} catch (error) {
		console.error('Failed to parse profile content:', error)
		profile = {
			pubkey,
		}
	}

	return profile
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

// React Query options for user profiles
export const userProfileQueryOptions = (pubkey: string) => ({
	queryKey: bugReportKeys.profile(pubkey),
	queryFn: () => fetchUserProfile(pubkey),
	staleTime: 10 * 60 * 1000, // 10 minutes
})

// Hooks
export const useBugReports = (limit: number = 20, until?: number) => {
	return useQuery(bugReportsQueryOptions(limit, until))
}

export const useUserProfile = (pubkey: string) => {
	return useQuery({
		...userProfileQueryOptions(pubkey),
		enabled: !!pubkey,
	})
}
