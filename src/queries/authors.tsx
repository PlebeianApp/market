import { authorKeys } from './queryKeyFactory'
import { queryOptions } from '@tanstack/react-query'
import { ndkActions } from '@/lib/stores/ndk'
import { isValidHexKey } from '@/lib/utils'
import { buildProfileMetadataFilter, parseNostrAuthor, pickLatestEvent } from '@sdk/core/profile'

export type { NostrAuthor } from '@sdk/core/profile'

export const fetchAuthor = async (pubkey: string) => {
	// Reject an invalid pubkey before constructing the filter — a malformed
	// value in { authors: [...] } trips NDK's strict filter validation.
	if (!isValidHexKey(pubkey)) throw new Error('Author pubkey is required')

	const filter = buildProfileMetadataFilter(pubkey)

	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const events = await ndk.fetchEvents(filter)
	const latestEvent = pickLatestEvent(events)

	if (!latestEvent) {
		throw new Error('Author not found')
	}

	return parseNostrAuthor(latestEvent)
}

export const authorQueryOptions = (pubkey: string) =>
	queryOptions({
		queryKey: authorKeys.details(pubkey),
		queryFn: () => fetchAuthor(pubkey),
		enabled: isValidHexKey(pubkey),
	})
