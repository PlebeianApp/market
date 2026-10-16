import { ndkActions } from '@/lib/stores/ndk'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import {
	buildNip05RegistryFilter,
	getExpiredNip05ForPubkey,
	getNip05ForPubkey,
	isNip05Available,
	parseNip05Settings,
	type Nip05Settings as SdkNip05Settings,
} from '@sdk/core/profile'
import { configKeys } from './queryKeyFactory'

export { getExpiredNip05ForPubkey, getNip05ForPubkey, isNip05Available }
export type { Nip05Entry } from '@sdk/core/profile'

export type Nip05Settings = SdkNip05Settings<NDKEvent>

/**
 * Fetches NIP-05 registry (kind 30000 with d=nip05-names) for the app
 */
export const fetchNip05Settings = async (appPubkey?: string): Promise<Nip05Settings | null> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	let targetPubkey = appPubkey
	if (!targetPubkey) {
		throw new Error('App pubkey is required')
	}

	const events = await ndk.fetchEvents(buildNip05RegistryFilter(targetPubkey, 1))
	return parseNip05Settings(Array.from(events))
}

/**
 * Hook to fetch NIP-05 settings for the app
 */
export const useNip05Settings = (appPubkey?: string) => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()

	// Set up a live subscription to monitor nip05 changes
	useEffect(() => {
		if (!appPubkey || !ndk) return

		const nip05Filter = buildNip05RegistryFilter(appPubkey)

		const subscription = ndk.subscribe(nip05Filter, {
			closeOnEose: false,
		})

		subscription.on('event', () => {
			queryClient.invalidateQueries({ queryKey: configKeys.nip05(appPubkey) })
		})

		return () => {
			subscription.stop()
		}
	}, [appPubkey, ndk, queryClient])

	return useQuery({
		queryKey: configKeys.nip05(appPubkey || ''),
		queryFn: () => fetchNip05Settings(appPubkey),
		enabled: !!appPubkey,
		staleTime: 30000,
		refetchOnMount: true,
		refetchOnWindowFocus: true,
		refetchOnReconnect: true,
	})
}
