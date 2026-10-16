import type { V4VDTO } from '@/lib/stores/cart'
import { ndkActions } from '@/lib/stores/ndk'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { v4 as uuidv4 } from 'uuid'
import {
	buildV4VMerchantsFilter,
	buildV4VSharesFilter,
	collectV4VMerchantPubkeys,
	parseV4VShareEntries,
	pickMostRecentV4VEvent,
	resolveParsedV4VState,
	resolveV4VConfigurationState,
	type V4VConfigurationState,
} from '@sdk/commerce/v4v/v4vRead'
import { v4vKeys } from './queryKeyFactory'
import { filterBlacklistedPubkeys } from '@/lib/utils/blacklistFilters'
import {
	getNextCommunityQueryFixtureStep,
	hasCommunityQueryFixture,
	normalizeCommunityArrayFixture,
	resolveCommunityQueryFixtureStep,
} from '@/lib/tests/communityQueryFixtures'

export type { V4VConfigurationState }
export { resolveV4VConfigurationState }

export interface V4VConfiguration {
	shares: V4VDTO[]
	state: V4VConfigurationState
}

async function parseV4VSharesFromEvent(event: NDKEvent, ndk: ReturnType<typeof ndkActions.getNDK>): Promise<V4VDTO[]> {
	return Promise.all(
		parseV4VShareEntries(event.content).map(async (entry) => {
			let name = ''
			try {
				if (ndk) {
					const user = ndk.getUser({
						pubkey: entry.pubkey,
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

			return {
				id: entry.id,
				pubkey: entry.pubkey,
				name,
				percentage: entry.percentage,
			}
		}),
	)
}

export const fetchV4VConfiguration = async (pubkey: string): Promise<V4VConfiguration> => {
	try {
		if (!pubkey || pubkey.trim() === '') {
			console.warn('fetchV4VConfiguration: Empty pubkey provided')
			return { shares: [], state: 'unknown' }
		}

		const ndk = ndkActions.getNDK()
		if (!ndk) {
			console.warn('NDK not ready, returning unknown V4V configuration')
			return { shares: [], state: 'unknown' }
		}

		const events = await ndk.fetchEvents(buildV4VSharesFilter(pubkey))

		if (!events || events.size === 0) {
			return { shares: [], state: 'never-configured' }
		}

		const mostRecentEvent = pickMostRecentV4VEvent(events)
		const state = resolveV4VConfigurationState(mostRecentEvent)

		if (!mostRecentEvent || state === 'never-configured' || state === 'configured-zero') {
			return { shares: [], state }
		}

		if (state === 'unknown') {
			return { shares: [], state }
		}

		const shares = await parseV4VSharesFromEvent(mostRecentEvent, ndk)
		return {
			shares,
			state: resolveParsedV4VState(shares.length),
		}
	} catch (error) {
		console.error('Error fetching V4V configuration:', error)
		return { shares: [], state: 'unknown' }
	}
}

export const fetchV4VShares = async (pubkey: string): Promise<V4VDTO[]> => {
	const { shares } = await fetchV4VConfiguration(pubkey)
	return shares
}

export const v4VForUserQuery = async (userPubkey: string): Promise<V4VDTO[]> => {
	try {
		const { shares } = await fetchV4VConfiguration(userPubkey)
		return shares
	} catch (error) {
		console.error('Error fetching V4V shares:', error)
		return []
	}
}

export const useV4VConfiguration = (pubkey: string) => {
	return useQuery({
		queryKey: v4vKeys.userConfig(pubkey),
		queryFn: () => fetchV4VConfiguration(pubkey),
		enabled: !!pubkey,
	})
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
		await ndkActions.publishEvent(event)

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
			queryClient.invalidateQueries({ queryKey: v4vKeys.userConfig(variables.userPubkey) })
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
 * Throws on relay/network errors to enable error state handling
 */
export const fetchV4VMerchants = async (): Promise<string[]> => {
	const fixtureStep = getNextCommunityQueryFixtureStep<string[]>('merchants')
	if (fixtureStep) {
		return await resolveCommunityQueryFixtureStep('merchants', fixtureStep, (data) =>
			normalizeCommunityArrayFixture<string>('merchants', data),
		)
	}

	const ndk = ndkActions.getNDK()
	if (!ndk) {
		throw new Error('NDK not ready, cannot fetch merchants')
	}

	const events = await ndk.fetchEvents(buildV4VMerchantsFilter())

	if (!events || events.size === 0) {
		return []
	}

	return filterBlacklistedPubkeys(collectV4VMerchantPubkeys(events))
}

/**
 * Hook to fetch all merchants who have V4V configured
 */
export const useV4VMerchants = () => {
	return useQuery({
		queryKey: v4vKeys.merchants(),
		queryFn: fetchV4VMerchants,
		retry: (failureCount) => !hasCommunityQueryFixture('merchants') && failureCount < 3,
		staleTime: 1000 * 60 * 5, // 5 minutes
	})
}
