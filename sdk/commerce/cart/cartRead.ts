import { normalizePersistedCart, parseCartPersistenceContent, type PersistedCartContent } from './cartIntent'
import { CART_PERSISTENCE_D_TAG, CART_PERSISTENCE_KIND } from './cartSnapshotPublish'

export const CART_SNAPSHOT_FETCH_LIMIT = 20

// A type alias (not interface) so it stays assignable to relay-client filters with `#${string}` index signatures.
export type CartSnapshotFilter = {
	kinds: number[]
	authors: string[]
	'#d': string[]
	limit: number
}

export function buildCartSnapshotFilter(userPubkey: string): CartSnapshotFilter {
	return {
		kinds: [CART_PERSISTENCE_KIND],
		authors: [userPubkey],
		'#d': [CART_PERSISTENCE_D_TAG],
		limit: CART_SNAPSHOT_FETCH_LIMIT,
	}
}

/** Returns the normalized cart intent, or null when the content fails validation. */
export function parseCartSnapshotEvent(event: { content: string }): PersistedCartContent | null {
	const parsed = parseCartPersistenceContent(event.content)
	if (!parsed) return null
	return normalizePersistedCart(parsed)
}
