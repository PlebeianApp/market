import { chooseNewerCartSnapshot } from '@/lib/cart-persistence'
import { ndkActions } from '@/lib/stores/ndk'
import type { PersistedCartContent } from '@/lib/schemas/cartPersistence'
import { cartKeys } from '@/queries/queryKeyFactory'
import { buildCartSnapshotFilter, parseCartSnapshotEvent } from '@sdk/commerce/cart/cartRead'
import { queryOptions } from '@tanstack/react-query'

export { cartKeys }

export async function fetchLatestCartSnapshot(userPubkey: string): Promise<PersistedCartContent | null> {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	if (!userPubkey) return null

	const events = await ndkActions.fetchEventsWithTimeout(buildCartSnapshotFilter(userPubkey))

	const latestEvent = chooseNewerCartSnapshot(Array.from(events))
	if (!latestEvent) return null

	return parseCartSnapshotEvent(latestEvent)
}

export const cartSnapshotQueryOptions = (userPubkey: string) =>
	queryOptions({
		queryKey: cartKeys.byPubkey(userPubkey),
		queryFn: () => fetchLatestCartSnapshot(userPubkey),
		enabled: !!userPubkey,
		staleTime: 60 * 1000,
		gcTime: 5 * 60 * 1000,
	})
