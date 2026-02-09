import { ndkActions } from '@/lib/stores/ndk'
import { parseRelayTags, type RelayPreference } from '@/publish/relay-list'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { publishRelayList } from '@/publish/relay-list'

export const relayListKeys = {
	all: ['relay-list'] as const,
	user: (pubkey: string) => [...relayListKeys.all, pubkey] as const,
} as const

/**
 * Fetches user's relay list (kind 10002) with full read/write preferences
 *
 * @param userPubkey The pubkey of the user to fetch relay list for
 * @returns Array of RelayPreference objects with read/write flags
 */
export async function fetchUserRelayListWithPreferences(userPubkey: string): Promise<RelayPreference[]> {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const events = await ndk.fetchEvents({
		kinds: [10002],
		authors: [userPubkey],
		limit: 1,
	})

	if (events.size === 0) {
		return []
	}

	// Get the most recent relay list event
	let mostRecentEvent: NDKEvent | undefined
	let mostRecentTimestamp = 0
	events.forEach((event) => {
		if (event.created_at && event.created_at > mostRecentTimestamp) {
			mostRecentEvent = event
			mostRecentTimestamp = event.created_at
		}
	})

	if (!mostRecentEvent) {
		return []
	}

	return parseRelayTags(mostRecentEvent.tags)
}

/**
 * Hook to fetch user's relay list from Nostr
 */
export function useUserRelayList(pubkey: string | undefined) {
	return useQuery({
		queryKey: relayListKeys.user(pubkey ?? ''),
		queryFn: () => fetchUserRelayListWithPreferences(pubkey!),
		enabled: !!pubkey,
		staleTime: 5 * 60 * 1000, // 5 minutes
		gcTime: 10 * 60 * 1000, // 10 minutes
	})
}

/**
 * Hook to publish user's relay list to Nostr
 */
export function usePublishRelayList() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (relays: RelayPreference[]) => publishRelayList(relays),
		onSuccess: async () => {
			// Get user pubkey to invalidate their relay list
			const ndk = ndkActions.getNDK()
			if (ndk?.signer) {
				try {
					const user = await ndk.signer.user()
					if (user?.pubkey) {
						queryClient.invalidateQueries({ queryKey: relayListKeys.user(user.pubkey) })
					}
				} catch (e) {
					console.error('Failed to invalidate relay list query:', e)
				}
			}
			// Also invalidate all relay list queries
			queryClient.invalidateQueries({ queryKey: relayListKeys.all })
		},
	})
}
