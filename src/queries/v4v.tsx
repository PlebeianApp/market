import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ndkActions } from '@/lib/stores/ndk'
import { v4vKeys } from './queryKeyFactory'
import type { V4VDTO } from '@/lib/stores/cart'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { nip19 } from 'nostr-tools'
import { v4 as uuidv4 } from 'uuid'

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

export const fetchV4VShares = async (pubkey: string): Promise<V4VDTO[]> => {
	try {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		const events = await ndk.fetchEvents({
			kinds: [30078],
			authors: [pubkey],
			'#l': ['v4v_share'],
		})

		if (!events || events.size === 0) {
			console.log('No V4V events found for pubkey:', pubkey)
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
				return []
			}

			const shares = await Promise.all(
				content
					.map(async (zapTag, index) => {
						if (zapTag[0] === 'zap' && zapTag[1] && zapTag[2]) {
							const pubkeyValue = zapTag[1]
							const percentage = parseFloat(zapTag[2]) || 5 // Default to 5% if invalid

							const normalized = normalizeAndEncodePubkey(pubkeyValue)
							if (!normalized) {
								return null
							}

							let name = 'Community Member'
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
									} else {
										console.log('No profile name or displayName found, using default')
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

export const publishV4VShares = async (shares: V4VDTO[], userPubkey: string, appPubkey?: string): Promise<boolean> => {
	try {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		const signer = ndkActions.getSigner()
		if (!signer) throw new Error('User signer not available')

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
