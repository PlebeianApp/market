import type { NDKEvent, NDKFilter, NDKSigner, NostrEvent } from '@nostr-dev-kit/ndk'
import { nip19, Relay, type Event } from 'nostr-tools'
import { NostrService } from './nostr'
import { AppSettingsSchema, type AppSettings } from './schemas/app'

export async function fetchAppSettings(relayUrl: string, appPubkey: string): Promise<AppSettings | null> {
	console.log(`Fetching app settings from relay: ${relayUrl} for pubkey: ${appPubkey}`)

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
		console.log(`No app settings events found for pubkey: ${appPubkey}`)
		return null
	}

	console.log(`Found ${eventArray.length} app settings events`)
	const latestEvent = eventArray.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]

	try {
		const parsedContent = JSON.parse(latestEvent.content)
		const validatedSettings = AppSettingsSchema.parse(parsedContent)

		return validatedSettings
	} catch (error) {
		console.error('Failed to parse or validate app settings:', error)
		return null
	}
}

export interface AppSettingsSubmitData {
	instanceName: string
	ownerPk: string
	contactEmail?: string
	logoUrl?: string
	allowRegister: boolean
	defaultCurrency: string
	adminsList: string[]
	relayUrl?: string
}

export async function submitAppSettings(data: NostrEvent): Promise<void> {
	try {
		const wsUrl = window.location.protocol === 'https:' ? 'wss://localhost:3000' : 'ws://localhost:3000'
		console.log(`Connecting to WebSocket at ${wsUrl}`)
		const relay = await Relay.connect(wsUrl as string)
		await relay.publish(data as Event)
	} catch (error) {
		console.error('Failed to submit app settings:', error)
		throw error
	}
}
