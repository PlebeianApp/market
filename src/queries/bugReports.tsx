import { useQuery } from '@tanstack/react-query'
import { ndkActions } from '@/lib/stores/ndk'
import { SimplePool, type Event, type Filter } from 'nostr-tools'

export interface BugReport {
	id: string
	pubkey: string
	content: string
	createdAt: number
	event: Event
}

export interface UserProfile {
	pubkey: string
	name?: string
	displayName?: string
	picture?: string
	about?: string
}

// Check for staging environment
const isStaging =
	(typeof process !== 'undefined' && process.env?.STAGING === 'true') ||
	(typeof import.meta !== 'undefined' && import.meta.env?.STAGING === 'true')

/**
 * Fetches bug reports (kind 1 events) from bugs.plebeian.market relay
 * with t tag "plebian2beta"
 */
export const fetchBugReports = async (limit: number = 20, until?: number): Promise<BugReport[]> => {
	// Use SimplePool for direct relay communication
	const bugReportRelay = isStaging ? 'wss://relay.staging.plebeian.market' : 'wss://bugs.plebeian.market/'

	console.log('🐛 Fetching bug reports from relay:', bugReportRelay)

	const pool = new SimplePool()

	try {
		const filter: Filter = {
			kinds: [1], // kind 1 is text notes
			'#t': ['plebian2beta'], // tag filter for plebian2beta
			limit,
			...(until && { until }),
		}

		console.log('🐛 Fetching events with filter:', filter)

		// Fetch events with timeout
		const fetchPromise = pool.querySync([bugReportRelay], filter)
		const timeoutPromise = new Promise<Event[]>((_, reject) => setTimeout(() => reject(new Error('Bug report fetch timeout')), 10000))

		const events = await Promise.race([fetchPromise, timeoutPromise])
		console.log('🐛 Fetched', events.length, 'bug report events from bugs relay')

		const bugReports = events
			.map(
				(event): BugReport => ({
					id: event.id,
					pubkey: event.pubkey,
					content: event.content,
					createdAt: event.created_at,
					event,
				}),
			)
			.sort((a, b) => b.createdAt - a.createdAt) // Sort by newest first

		return bugReports
	} catch (error) {
		console.error('🐛 Failed to fetch bug reports:', error)
		throw error
	} finally {
		// Clean up the pool
		console.log('🐛 Cleaning up SimplePool connections...')
		pool.close([bugReportRelay])
	}
}

/**
 * Fetches user profile (kind 0 event) for a given pubkey
 */
export const fetchUserProfile = async (pubkey: string): Promise<UserProfile | null> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const filter: Filter = {
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
	staleTime: 30 * 1000, // 30 seconds - refresh more frequently for bug reports
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
