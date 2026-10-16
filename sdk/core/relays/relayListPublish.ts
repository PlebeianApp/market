import type { EventPublishContext } from '../ports/eventPublish'
import type { SignedEventLike } from '../ports/signer'
import { signAndPublish, type UnsignedEventData } from '../publishing'

export const RELAY_LIST_KIND = 10002
export const APP_SPECIFIC_DATA_KIND = 30078
export const RELAY_PREFERENCES_D_TAG = 'plebeian-market-relay-preferences'

export interface RelayPreference {
	url: string
	read: boolean
	write: boolean
}

export interface RelayPreferencesSettings {
	includeAppDefaults: boolean
}

export const DEFAULT_RELAY_PREFERENCES: RelayPreferencesSettings = {
	includeAppDefaults: true,
}

function normalizeRelayUrl(url: string): string {
	return url.startsWith('ws://') || url.startsWith('wss://') ? url : `wss://${url}`
}

/** NIP-65 `r` tags: no marker means read+write; relays with neither permission are dropped. */
export function buildRelayListTags(relays: readonly RelayPreference[]): string[][] {
	return relays
		.filter((relay) => relay.read || relay.write)
		.map((relay) => {
			const url = normalizeRelayUrl(relay.url)
			if (relay.read && relay.write) return ['r', url]
			return relay.read ? ['r', url, 'read'] : ['r', url, 'write']
		})
}

export function parseRelayListTags(tags: readonly string[][]): RelayPreference[] {
	return tags
		.filter((tag) => tag[0] === 'r' && tag[1])
		.map((tag) => {
			const [, url, marker] = tag
			if (!marker) return { url, read: true, write: true }
			return { url, read: marker === 'read', write: marker === 'write' }
		})
}

export function buildRelayListEventData(relays: readonly RelayPreference[]): UnsignedEventData {
	return { kind: RELAY_LIST_KIND, content: '', tags: buildRelayListTags(relays) }
}

export function buildRelayPreferencesEventData(preferences: RelayPreferencesSettings): UnsignedEventData {
	return { kind: APP_SPECIFIC_DATA_KIND, content: JSON.stringify(preferences), tags: [['d', RELAY_PREFERENCES_D_TAG]] }
}

export function publishRelayListWorkflow<SignedEvent extends SignedEventLike>(
	context: EventPublishContext<SignedEvent>,
	relays: readonly RelayPreference[],
): Promise<SignedEvent> {
	return signAndPublish(context, buildRelayListEventData(relays))
}

export function publishRelayPreferencesWorkflow<SignedEvent extends SignedEventLike>(
	context: EventPublishContext<SignedEvent>,
	preferences: RelayPreferencesSettings,
): Promise<SignedEvent> {
	return signAndPublish(context, buildRelayPreferencesEventData(preferences))
}
