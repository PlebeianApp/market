import { ndkActions } from '@/lib/stores/ndk'
import { createNdkPublishContext } from '@platform/web/ndkPublishContext'
import {
	DEFAULT_RELAY_PREFERENCES,
	publishRelayPreferencesWorkflow,
	RELAY_PREFERENCES_D_TAG,
	type RelayPreferencesSettings,
} from '@sdk/core/relays'

export { DEFAULT_RELAY_PREFERENCES }
export type { RelayPreferencesSettings }

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

	const event = await publishRelayPreferencesWorkflow(await createNdkPublishContext(ndk, signer), preferences)
	return event.id
}

/**
 * Returns the d-tag used for relay preferences
 * Useful for building queries
 */
export function getRelayPreferencesDTag(): string {
	return RELAY_PREFERENCES_D_TAG
}
