import { parseRelayListTags } from '../../core/relays/relayListPublish'
import { pickMostRecentTimestampedEvent } from '../../core/relays/relayListRead'

export const NIP15_PRODUCT_KIND = 30018
export const NIP99_PRODUCT_KIND = 30402
export const NIP15_PRODUCTS_FETCH_LIMIT = 100
export const MIGRATED_PRODUCTS_FETCH_LIMIT = 1000
export const MIGRATED_TAG = 'migrated'

// A type alias (not interface) so it stays assignable to relay-client filters with `#${string}` index signatures.
export type MigrationProductFilter = {
	kinds: number[]
	authors: string[]
	limit: number
}

export function buildNip15ProductsFilter(userPubkey: string): MigrationProductFilter {
	return { kinds: [NIP15_PRODUCT_KIND], authors: [userPubkey], limit: NIP15_PRODUCTS_FETCH_LIMIT }
}

export function buildMigratedProductsFilter(userPubkey: string): MigrationProductFilter {
	return { kinds: [NIP99_PRODUCT_KIND], authors: [userPubkey], limit: MIGRATED_PRODUCTS_FETCH_LIMIT }
}

/** `r` tag URLs from the most recent timestamped kind 10002 event; markers are ignored. */
export function readRelayListUrls(events: Iterable<{ tags: string[][]; created_at?: number }>): string[] {
	const event = pickMostRecentTimestampedEvent(events)
	return event ? parseRelayListTags(event.tags).map((relay) => relay.url) : []
}

/** App relay first, then the user's relays, else the fallback relays; duplicates dropped in order. */
export function resolveMigrationRelays(appRelay: string | undefined, userRelays: string[], fallbackRelays: string[]): string[] {
	const relays: string[] = []
	if (appRelay) relays.push(appRelay)
	for (const relay of userRelays.length > 0 ? userRelays : fallbackRelays) {
		if (!relays.includes(relay)) relays.push(relay)
	}
	return relays
}

/** Original NIP-15 event ids referenced by the first `migrated` tag of each NIP-99 product. */
export function collectMigratedOriginalIds(events: Iterable<{ tags: string[][] }>): Set<string> {
	const ids = new Set<string>()
	for (const event of events) {
		const migratedTag = event.tags.find((tag) => tag[0] === MIGRATED_TAG)
		if (migratedTag && migratedTag[1]) {
			ids.add(migratedTag[1])
		}
	}
	return ids
}
