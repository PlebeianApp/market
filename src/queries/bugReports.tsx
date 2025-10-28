import { useQuery } from '@tanstack/react-query'
import { ndkActions } from '@/lib/stores/ndk'
import NDK, { type NDKEvent, type NDKFilter } from '@nostr-dev-kit/ndk'

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

// Check for staging environment
const isStaging =
	(typeof process !== 'undefined' && process.env?.STAGING === 'true') ||
	(typeof import.meta !== 'undefined' && import.meta.env?.STAGING === 'true')

/**
 * Fetches bug reports (kind 1 events) from bugs.plebeian.market relay
 * with t tag "plebian2beta"
 */
export const fetchBugReports = async (limit: number = 20, until?: number): Promise<BugReport[]> => {
	// Create a dedicated NDK instance for bug reports to ensure we're fetching from the correct relay
	const bugReportRelays = isStaging ? ['wss://relay.staging.plebeian.market'] : ['wss://bugs.plebeian.market/']
	
	console.log('🐛 Fetching bug reports from relays:', bugReportRelays)
	
	const bugReportNdk = new NDK({
		explicitRelayUrls: bugReportRelays,
	})

	// Connect to the bugs relay with timeout
	try {
		const connectPromise = bugReportNdk.connect()
		const timeoutPromise = new Promise((_, reject) => 
			setTimeout(() => reject(new Error('Bug report fetch connection timeout')), 5000)
		)
		await Promise.race([connectPromise, timeoutPromise])
		
		const connectedRelays = bugReportNdk.pool?.connectedRelays() || []
		console.log('🐛 Connected to bug report relays:', connectedRelays.map(r => r.url))
	} catch (connectError) {
		console.warn('Bug report NDK connection warning:', connectError)
	}

	const filter: NDKFilter = {
		kinds: [1], // kind 1 is text notes
		'#t': ['plebian2beta'], // tag filter for plebian2beta
		limit,
		...(until && { until }),
	}

	console.log('🐛 Fetching events with filter:', filter)
	const events = await bugReportNdk.fetchEvents(filter)
	console.log('🐛 Fetched', events.size, 'bug report events from bugs relay')
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

	// Clean up the connection
	console.log('🐛 Cleaning up bug report NDK connections...')
	bugReportNdk.pool?.relays.forEach((relay) => relay.disconnect())

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
