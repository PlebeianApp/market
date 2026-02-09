import { ndkActions } from '@/lib/stores/ndk'
import {
	DEFAULT_RELAY_PREFERENCES,
	getRelayPreferencesDTag,
	publishRelayPreferences,
	type RelayPreferencesSettings,
} from '@/publish/relay-preferences'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export const relayPreferencesKeys = {
	all: ['relay-preferences'] as const,
	user: (pubkey: string) => [...relayPreferencesKeys.all, pubkey] as const,
} as const

/**
 * Fetches user's relay preferences (kind 30078 with d-tag)
 *
 * @param userPubkey The pubkey of the user to fetch preferences for
 * @returns RelayPreferencesSettings or null if not found
 */
export async function fetchRelayPreferences(userPubkey: string): Promise<RelayPreferencesSettings | null> {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const events = await ndk.fetchEvents({
		kinds: [30078],
		authors: [userPubkey],
		'#d': [getRelayPreferencesDTag()],
		limit: 1,
	})

	if (events.size === 0) {
		return null
	}

	// Get the most recent event
	let mostRecentEvent: NDKEvent | undefined
	let mostRecentTimestamp = 0
	events.forEach((event) => {
		if (event.created_at && event.created_at > mostRecentTimestamp) {
			mostRecentEvent = event
			mostRecentTimestamp = event.created_at
		}
	})

	if (!mostRecentEvent) {
		return null
	}

	try {
		const content = JSON.parse(mostRecentEvent.content)
		return {
			includeAppDefaults: content.includeAppDefaults ?? DEFAULT_RELAY_PREFERENCES.includeAppDefaults,
		}
	} catch (error) {
		console.error('Error parsing relay preferences:', error)
		return null
	}
}

/**
 * Hook to fetch user's relay preferences from Nostr
 * Returns default preferences if none are saved
 */
export function useRelayPreferences(pubkey: string | undefined) {
	return useQuery({
		queryKey: relayPreferencesKeys.user(pubkey ?? ''),
		queryFn: async () => {
			const prefs = await fetchRelayPreferences(pubkey!)
			return prefs ?? DEFAULT_RELAY_PREFERENCES
		},
		enabled: !!pubkey,
		staleTime: 5 * 60 * 1000, // 5 minutes
		gcTime: 10 * 60 * 1000, // 10 minutes
	})
}

/**
 * Hook to publish user's relay preferences to Nostr
 */
export function usePublishRelayPreferences() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (preferences: RelayPreferencesSettings) => publishRelayPreferences(preferences),
		onSuccess: async () => {
			// Get user pubkey to invalidate their preferences
			const ndk = ndkActions.getNDK()
			if (ndk?.signer) {
				try {
					const user = await ndk.signer.user()
					if (user?.pubkey) {
						queryClient.invalidateQueries({ queryKey: relayPreferencesKeys.user(user.pubkey) })
					}
				} catch (e) {
					console.error('Failed to invalidate relay preferences query:', e)
				}
			}
			// Also invalidate all preferences queries
			queryClient.invalidateQueries({ queryKey: relayPreferencesKeys.all })
		},
	})
}
