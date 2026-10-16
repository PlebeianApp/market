import {
	APP_SPECIFIC_DATA_KIND,
	DEFAULT_RELAY_PREFERENCES,
	parseRelayListTags,
	RELAY_LIST_KIND,
	RELAY_PREFERENCES_D_TAG,
	type RelayPreference,
	type RelayPreferencesSettings,
} from './relayListPublish'

// A type alias (not interface) so it stays assignable to relay-client filters with `#${string}` index signatures.
export type RelayListFilter = {
	kinds: number[]
	authors: string[]
	'#d'?: string[]
	limit?: number
}

export function buildRelayListFilter(pubkey: string): RelayListFilter {
	return { kinds: [RELAY_LIST_KIND], authors: [pubkey], limit: 1 }
}

export function buildRelayPreferencesFilter(pubkey: string): RelayListFilter {
	return { kinds: [APP_SPECIFIC_DATA_KIND], authors: [pubkey], '#d': [RELAY_PREFERENCES_D_TAG], limit: 1 }
}

/** First event with the highest positive `created_at`; events without one never win. */
export function pickMostRecentTimestampedEvent<E extends { created_at?: number }>(events: Iterable<E>): E | undefined {
	let mostRecent: E | undefined
	let mostRecentTimestamp = 0
	for (const event of events) {
		if (event.created_at && event.created_at > mostRecentTimestamp) {
			mostRecent = event
			mostRecentTimestamp = event.created_at
		}
	}
	return mostRecent
}

export function parseRelayListEvents(events: Iterable<{ tags: string[][]; created_at?: number }>): RelayPreference[] {
	const event = pickMostRecentTimestampedEvent(events)
	return event ? parseRelayListTags(event.tags) : []
}

/** Missing `includeAppDefaults` falls back to the default. Throws on invalid JSON or `null` content. */
export function parseRelayPreferencesContent(content: string): RelayPreferencesSettings {
	const parsed = JSON.parse(content)
	return { includeAppDefaults: parsed.includeAppDefaults ?? DEFAULT_RELAY_PREFERENCES.includeAppDefaults }
}
