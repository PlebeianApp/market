import type { QueryClient } from '@tanstack/react-query'
import { auctionKeys, collectionKeys, paymentDetailsKeys, productKeys, shippingKeys } from '@/queries/queryKeyFactory'
import { DELETION_REQUEST_KIND, readDeletionTargets, type EventStorePort } from '@sdk/core/event-store'
import type { NostrEventLike } from '@sdk/core'
import { getRawEventStore } from './applesauceReadContext'
import { getNdkEventStore } from './ndkReadContext'

const QUERY_ROOTS_BY_KIND: Record<number, readonly unknown[]> = {
	30402: productKeys.all,
	30405: collectionKeys.all,
	30406: shippingKeys.all,
	30408: auctionKeys.all,
	30078: paymentDetailsKeys.all,
}

/** Refetches the cached lists a newly seen deletion affects; returns an unsubscribe function. */
export function syncEventStoresToQueryClient(queryClient: QueryClient): () => void {
	const sessionStartedAt = Math.floor(Date.now() / 1000)

	const onDeletion = (deletion: NostrEventLike) => {
		// Older deletions arrive via read lookups, and that read already applied them.
		if ((deletion.created_at ?? 0) < sessionStartedAt) return
		const kinds = new Set(readDeletionTargets(deletion).coordinates.map((coordinate) => Number(coordinate.split(':')[0])))
		for (const kind of kinds) {
			const queryKey = QUERY_ROOTS_BY_KIND[kind]
			if (queryKey) void queryClient.invalidateQueries({ queryKey })
		}
	}

	const stores: EventStorePort<NostrEventLike>[] = [getNdkEventStore() as EventStorePort<NostrEventLike>, getRawEventStore()]
	const unsubscribes = stores.map((store) => store.subscribe({ kinds: [DELETION_REQUEST_KIND] }, onDeletion))
	return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
}
