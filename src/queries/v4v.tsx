import type { V4VDTO } from '@/lib/stores/cart'
import { ndkActions } from '@/lib/stores/ndk'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { nip19 } from 'nostr-tools'
import { v4 as uuidv4 } from 'uuid'
import { v4vKeys } from './queryKeyFactory'
import { filterBlacklistedPubkeys } from '@/lib/utils/blacklistFilters'

function padHexString(hex: string): string {
	return hex.length % 2 === 1 ? '0' + hex : hex
}

function normalizeAndEncodePubkey(value: string): { pubkey: string; npub: string } | null {
	try {
		if (/^[0-9a-f]{60,64}$/i.test(value)) {
			const paddedHex = padHexString(value)
			return {
				pubkey: paddedHex,
				npub: nip19.npubEncode(paddedHex),
			}
		}

		if (value.startsWith('npub1') || value.startsWith('0npub1')) {
			const cleanValue = value.startsWith('0') ? value.substring(1) : value
			try {
				const { data: hexPubkey } = nip19.decode(cleanValue)
				return {
					pubkey: hexPubkey as string,
					npub: cleanValue,
				}
			} catch (e) {
				console.error('Failed to decode npub:', e)
				return null
			}
		}

		console.error('Unknown pubkey format:', value)
		return null
	} catch (e) {
		console.error('Error processing pubkey:', e, 'for value:', value)
		return null
	}
}

/**
 * Fetches V4V shares for a user
 *
 * Three distinct states:
 * 1. No V4V event exists → returns [] (user never configured V4V)
 * 2. V4V event with empty content [] → returns [] (user configured V4V but chose 0%, takes 100%)
 * 3. V4V event with shares → returns shares array
 *
 * NOTE: States 1 and 2 both return [], but state 2 has an event published.
 * The difference is important for UI logic (has the user made a choice vs never configured).
 */
export const fetchV4VShares = async (pubkey: string): Promise<V4VDTO[]> => {
	try {
		if (!pubkey || pubkey.trim() === '') {
			console.warn('fetchV4VShares: Empty pubkey provided')
			return []
		}

		const ndk = ndkActions.getNDK()
		if (!ndk) {
			throw new Error('NDK not initialized')
		}

		const events = await ndk.fetchEvents({
			kinds: [30078],
			authors: [pubkey],
			'#l': ['v4v_share'],
		})

		// State 1: No V4V event exists (never configured)
		if (!events || events.size === 0) {
			return []
		}

		let mostRecentEvent: NDKEvent | null = null
		let mostRecentTimestamp = 0

		const eventsArray = Array.from(events)

		for (const event of eventsArray) {
			if (event.created_at && event.created_at > mostRecentTimestamp) {
				mostRecentEvent = event
				mostRecentTimestamp = event.created_at
			}
		}

		if (!mostRecentEvent) {
			return []
		}

		try {
			const content = JSON.parse(mostRecentEvent.content)

			if (!Array.isArray(content)) {
				console.warn('V4V event content is not an array')
				return []
			}

			// State 2: V4V event exists but with empty array (user takes 100%)
			if (content.length === 0) {
				return []
			}

			// State 3: V4V event with actual shares
			// First, deduplicate by pubkey (keep the first occurrence)
			const seenPubkeys = new Set<string>()
			const dedupedContent = content.filter((zapTag) => {
				if (zapTag[0] === 'zap' && zapTag[1]) {
					const normalized = normalizeAndEncodePubkey(zapTag[1])
					if (normalized && !seenPubkeys.has(normalized.pubkey)) {
						seenPubkeys.add(normalized.pubkey)
						return true
					}
					return false
				}
				return false
			})

			const shares = await Promise.all(
				dedupedContent
					.map(async (zapTag, index) => {
						if (zapTag[0] === 'zap' && zapTag[1] && zapTag[2]) {
							const pubkeyValue = zapTag[1]
							const percentage = parseFloat(zapTag[2]) || 5 // Default to 5% if invalid

							const normalized = normalizeAndEncodePubkey(pubkeyValue)
							if (!normalized) {
								return null
							}

							let name = ''
							try {
								if (ndk) {
									const user = ndk.getUser({
										pubkey: normalized.pubkey,
									})
									await user.fetchProfile()
									if (user.profile?.name) {
										name = user.profile.name
									} else if (user.profile?.displayName) {
										name = user.profile.displayName
									}
								}
							} catch (error) {
								console.warn('Error fetching profile for V4V share:', error)
							}

							const shareObj = {
								id: `v4v-${index}-${normalized.pubkey.substring(0, 8)}`,
								pubkey: normalized.pubkey,
								name,
								percentage,
							}

							return shareObj
						}
						return null
					})
					.filter(Boolean),
			)

			return shares.filter(Boolean) as V4VDTO[]
		} catch (error) {
			console.error('Error parsing V4V share content:', error)
			return []
		}
	} catch (error) {
		console.error('Error fetching V4V shares:', error)
		return []
	}
}

export const v4VForUserQuery = async (userPubkey: string): Promise<V4VDTO[]> => {
	try {
		const shares = await fetchV4VShares(userPubkey)
		return shares
	} catch (error) {
		console.error('Error fetching V4V shares:', error)
		return []
	}
}

export const useV4VShares = (pubkey: string) => {
	return useQuery({
		queryKey: v4vKeys.userShares(pubkey),
		queryFn: () => fetchV4VShares(pubkey),
		enabled: !!pubkey,
	})
}

/**
 * Publishes V4V shares configuration
 *
 * Handles three scenarios:
 * 1. shares = [] → Publishes event with empty array (user takes 100%, V4V is 0%)
 * 2. shares = [...] → Publishes event with shares (user configured V4V recipients)
 * 3. To delete/clear → Call this with empty array []
 *
 * NOTE: Empty array is valid and means "I configured V4V to 0%", different from no event.
 */
export const publishV4VShares = async (shares: V4VDTO[], userPubkey: string, appPubkey?: string): Promise<boolean> => {
	try {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		const signer = ndkActions.getSigner()
		if (!signer) throw new Error('User signer not available')

		// zapTags can be empty array (user takes 100%)
		const zapTags = shares.map((share) => ['zap', share.pubkey, share.percentage.toString()])

		const event = new NDKEvent(ndk)
		event.kind = 30078
		event.content = JSON.stringify(zapTags)
		event.tags = [
			['d', uuidv4()],
			['l', 'v4v_share'],
		]

		if (appPubkey) {
			event.tags.push(['p', appPubkey])
		}

		await event.sign(signer)
		await event.publish()

		return true
	} catch (error) {
		console.error('Error publishing V4V shares:', error)
		return false
	}
}

export const usePublishV4VShares = () => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationKey: v4vKeys.publishShare(),
		mutationFn: (params: { shares: V4VDTO[]; userPubkey: string; appPubkey?: string }) =>
			publishV4VShares(params.shares, params.userPubkey, params.appPubkey),
		onSuccess: (_, variables) => {
			// Invalidate the specific user's V4V shares query
			queryClient.invalidateQueries({ queryKey: v4vKeys.userShares(variables.userPubkey) })
			// Also invalidate all V4V queries to be safe
			queryClient.invalidateQueries({ queryKey: v4vKeys.all })
		},
	})
}

/**
 * Fetches all users who have configured V4V shares (merchants)
 * Returns an array of unique pubkeys
 */
export const fetchV4VMerchants = async (): Promise<string[]> => {
	try {
		const ndk = ndkActions.getNDK()
		if (!ndk) {
			throw new Error('NDK not initialized')
		}

		const events = await ndk.fetchEvents({
			kinds: [30078],
			'#l': ['v4v_share'],
			limit: 100, // Limit to 100 most recent merchants
		})

		if (!events || events.size === 0) {
			return []
		}

		// Get unique pubkeys from the events and filter out blacklisted ones
		const pubkeySet = new Set<string>()
		Array.from(events).forEach((event) => {
			if (event.pubkey) {
				pubkeySet.add(event.pubkey)
			}
		})

		return filterBlacklistedPubkeys(Array.from(pubkeySet))
	} catch (error) {
		console.error('Error fetching V4V merchants:', error)
		return []
	}
}

/**
 * Hook to fetch all merchants who have V4V configured
 */
export const useV4VMerchants = () => {
	return useQuery({
		queryKey: v4vKeys.merchants(),
		queryFn: fetchV4VMerchants,
		staleTime: 1000 * 60 * 5, // 5 minutes
	})
}
