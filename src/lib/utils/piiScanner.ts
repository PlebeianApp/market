import { ORDER_PROCESS_KIND } from '@/lib/schemas/order'
import { ndkActions } from '@/lib/stores/ndk'

export interface PIIScanResult {
	hasPII: boolean
	eventsWithPII: PIIEvent[]
	totalEventsScanned: number
}

export interface PIIEvent {
	eventId: string
	createdAt: number
	piiTags: string[] // Field names only
	relayUrl: string
}

/**
 * Scan for PII exposure in user's order events
 * @param userPubkey The user's public key
 * @returns PIIScanResult with details about exposed PII
 */
export async function scanForPIIExposure(userPubkey: string): Promise<PIIScanResult> {
	const ndk = ndkActions.getNDK()
	if (!ndk) {
		throw new Error('NDK not initialized')
	}

	try {
		// Fetch all order events authored by the user (kind 16)
		const filter = {
			kinds: [ORDER_PROCESS_KIND],
			authors: [userPubkey],
		}

		// Use timeout-safe fetch helper to prevent hanging on slow relays
		const events = await ndkActions.fetchEventsWithTimeout(filter, { timeoutMs: 10000 })
		const eventsArray = Array.from(events)

		console.log(`[PII Scanner] Scanning ${eventsArray.length} order events for PII exposure`)

		const piiLeaks: PIIEvent[] = []

		// Check each event for PII tags
		for (const event of eventsArray) {
			const piiTags: string[] = []

			// Check for all affected PII fields from the private checkout leak
			const addressTag = event.tags.find((tag) => tag[0] === 'address')
			if (addressTag) {
				piiTags.push('address')
			}

			const emailTag = event.tags.find((tag) => tag[0] === 'email')
			if (emailTag) {
				piiTags.push('email')
			}

			const phoneTag = event.tags.find((tag) => tag[0] === 'phone')
			if (phoneTag) {
				piiTags.push('phone')
			}

			// Check for delivery notes and other checkout data
			const notesTag = event.tags.find((tag) => tag[0] === 'notes')
			if (notesTag) {
				piiTags.push('delivery notes')
			}

			// If PII found, add to results
			if (piiTags.length > 0) {
				piiLeaks.push({
					eventId: event.id,
					createdAt: event.created_at || 0,
					piiTags, // Only field names, no actual values
					relayUrl: event.relay?.url ?? 'unknown',
				})
			}
		}

		return {
			hasPII: piiLeaks.length > 0,
			eventsWithPII: piiLeaks,
			totalEventsScanned: eventsArray.length,
		}
	} catch (error) {
		console.error('[PII Scanner] Error scanning for PII:', error)
		throw error
	}
}
