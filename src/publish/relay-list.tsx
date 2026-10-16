import { ndkActions } from '@/lib/stores/ndk'
import { createNdkPublishContext } from '@platform/web/ndkPublishContext'
import { parseRelayListTags, publishRelayListWorkflow, type RelayPreference } from '@sdk/core/relays'

export type { RelayPreference }

/**
 * Publishes user's relay list as a kind 10002 event (NIP-65)
 *
 * This is a replaceable event that stores the user's preferred relays.
 * Other Nostr clients can read this to discover where to find the user's events.
 *
 * @param relays Array of relay preferences with read/write flags
 * @returns The event ID of the published relay list
 */
export async function publishRelayList(relays: RelayPreference[]): Promise<string> {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const signer = ndkActions.getSigner()
	if (!signer) throw new Error('User signer not available')

	const event = await publishRelayListWorkflow(await createNdkPublishContext(ndk, signer), relays)
	return event.id
}

/**
 * Parses relay tags from a kind 10002 event into RelayPreference objects
 */
export const parseRelayTags = parseRelayListTags
