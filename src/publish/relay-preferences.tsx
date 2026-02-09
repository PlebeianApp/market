import { ndkActions } from '@/lib/stores/ndk'
import { NDKEvent } from '@nostr-dev-kit/ndk'

export interface RelayPreferencesSettings {
	includeAppDefaults: boolean
}

const RELAY_PREFERENCES_D_TAG = 'plebeian-market-relay-preferences'

/**
 * Publishes user's relay preferences as a kind 30078 event (NIP-78 Application Specific Data)
 *
 * This stores app-specific preferences like whether to include default fallback relays.
 * Using a d-tag makes this a parameterized replaceable event.
 *
 * @param preferences The relay preferences to save
 * @returns The event ID of the published preferences
 */
export async function publishRelayPreferences(preferences: RelayPreferencesSettings): Promise<string> {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const signer = ndkActions.getSigner()
	if (!signer) throw new Error('User signer not available')

	const event = new NDKEvent(ndk)
	event.kind = 30078 // NIP-78 Application Specific Data
	event.content = JSON.stringify(preferences)
	event.tags = [['d', RELAY_PREFERENCES_D_TAG]]

	await event.sign(signer)
	await ndkActions.publishEvent(event)

	return event.id
}

/**
 * Returns the d-tag used for relay preferences
 * Useful for building queries
 */
export function getRelayPreferencesDTag(): string {
	return RELAY_PREFERENCES_D_TAG
}

/**
 * Default preferences when no saved preferences exist
 */
export const DEFAULT_RELAY_PREFERENCES: RelayPreferencesSettings = {
	includeAppDefaults: true,
}
