import { chooseNewerCartSnapshot, normalizePersistedCart } from '@/lib/cart-persistence'
import { ndkActions } from '@/lib/stores/ndk'
import {
	CART_PERSISTENCE_D_TAG,
	CART_PERSISTENCE_KIND,
	parseCartPersistenceContent,
	type PersistedCartContent,
} from '@/lib/schemas/cartPersistence'
import { cartKeys } from '@/queries/queryKeyFactory'
import { queryOptions } from '@tanstack/react-query'

export { cartKeys }

export async function fetchLatestCartSnapshot(userPubkey: string): Promise<PersistedCartContent | null> {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	if (!userPubkey) return null

	const events = await ndkActions.fetchEventsWithTimeout({
		kinds: [CART_PERSISTENCE_KIND],
		authors: [userPubkey],
		'#d': [CART_PERSISTENCE_D_TAG],
		limit: 20,
	})

	const latestEvent = chooseNewerCartSnapshot(Array.from(events))
	if (!latestEvent) return null

	const parsed = parseCartPersistenceContent(latestEvent.content)
	if (!parsed) return null

	return normalizePersistedCart(parsed)
}

export const cartSnapshotQueryOptions = (userPubkey: string) =>
	queryOptions({
		queryKey: cartKeys.byPubkey(userPubkey),
		queryFn: () => fetchLatestCartSnapshot(userPubkey),
		enabled: !!userPubkey,
		staleTime: 60 * 1000,
		gcTime: 5 * 60 * 1000,
	})
