import { NostrService } from './nostr'
import type { NDKFilter } from '@nostr-dev-kit/ndk'
import { AppSettingsSchema, type AppSettings } from './schemas/app'

export async function fetchAppSettings(relayUrl: string, appPubkey: string): Promise<AppSettings | null> {
	const nostrService = NostrService.getInstance([relayUrl])
	await nostrService.connect()

	const filter: NDKFilter = {
		kinds: [31990],
		authors: [appPubkey],
		limit: 1,
	}

	const events = await nostrService.ndkInstance.fetchEvents(filter)
	const eventArray = Array.from(events)

	if (eventArray.length === 0) {
		return null
	}

	const latestEvent = eventArray.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]

	try {
		const parsedContent = JSON.parse(latestEvent.content)
		return AppSettingsSchema.parse(parsedContent)
	} catch (error) {
		console.error('Failed to parse or validate app settings:', error)
		return null
	}
}
