import type { NDKFilter, NostrEvent } from '@nostr-dev-kit/ndk'
import { Relay, type Event } from 'nostr-tools'
import { AppSettingsSchema, type AppSettings } from './schemas/app'
import { ndkActions } from './stores/ndk'

export async function fetchAppSettings(relayUrl: string, appPubkey: string): Promise<AppSettings | null> {
	console.log(`Fetching app settings from relay: ${relayUrl} for pubkey: ${appPubkey}`)
	const ndk = ndkActions.initialize([relayUrl])
	await ndk.connect()

	const filter: NDKFilter = {
		kinds: [31990],
		authors: [appPubkey],
		limit: 1,
	}

	const events = await ndk.fetchEvents(filter)
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
		const wsUrl = `${window.location.protocol === 'https:' ? `wss://${window.location.hostname}` : `ws://${window.location.hostname}:3000`}`
		console.log(`Connecting to WebSocket at ${wsUrl}`)
		const relay = await Relay.connect(wsUrl as string)
		await relay.publish(data as Event)
	} catch (error) {
		console.error('Failed to submit app settings:', error)
		throw error
	}
}
