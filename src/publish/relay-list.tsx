import { ndkActions } from '@/lib/stores/ndk'
import { NDKEvent } from '@nostr-dev-kit/ndk'

export interface RelayPreference {
	url: string
	read: boolean
	write: boolean
}

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

	const event = new NDKEvent(ndk)
	event.kind = 10002 // NIP-65 Relay List Metadata
	event.content = ''

	// Build relay tags per NIP-65
	// ["r", "wss://relay.example.com"] for both read and write
	// ["r", "wss://relay.example.com", "read"] for read-only
	// ["r", "wss://relay.example.com", "write"] for write-only
	event.tags = relays
		.filter((relay) => relay.read || relay.write) // Only include relays with at least one permission
		.map((relay) => {
			// Normalize URL
			const url = relay.url.startsWith('ws://') || relay.url.startsWith('wss://') ? relay.url : `wss://${relay.url}`

			if (relay.read && relay.write) {
				return ['r', url] // Both read and write (no marker)
			} else if (relay.read) {
				return ['r', url, 'read']
			} else {
				return ['r', url, 'write']
			}
		})

	await event.sign(signer)
	await ndkActions.publishEvent(event)

	return event.id
}

/**
 * Parses relay tags from a kind 10002 event into RelayPreference objects
 */
export function parseRelayTags(tags: string[][]): RelayPreference[] {
	return tags
		.filter((tag) => tag[0] === 'r' && tag[1])
		.map((tag) => {
			const url = tag[1]
			const marker = tag[2]

			// No marker means both read and write
			if (!marker) {
				return { url, read: true, write: true }
			}

			return {
				url,
				read: marker === 'read',
				write: marker === 'write',
			}
		})
}
