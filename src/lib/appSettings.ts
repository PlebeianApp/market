import type { NDKFilter } from '@nostr-dev-kit/ndk'
import { nip19 } from 'nostr-tools'
import { NostrService } from './nostr'
import { AppSettingsSchema, type AppSettings } from './schemas/app'

const DEFAULT_RELAY = 'ws://localhost:10547'

const RELAY_URL =
	typeof import.meta.env !== 'undefined' && import.meta.env.VITE_APP_RELAY_URL ? import.meta.env.VITE_APP_RELAY_URL : DEFAULT_RELAY

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
		console.log(`No app settings events found for pubkey: ${appPubkey}`)
		return null
	}

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

export async function submitAppSettings(data: AppSettingsSubmitData): Promise<void> {
	try {
		let ownerPubkey = data.ownerPk
		if (data.ownerPk.startsWith('npub')) {
			try {
				const { type, data: ownerData } = nip19.decode(data.ownerPk)
				if (type === 'npub') {
					ownerPubkey = ownerData.toString()
					console.log(`Decoded owner npub to pubkey: ${ownerPubkey}`)
				}
			} catch (error) {
				console.error('Failed to decode owner npub:', error)
			}
		}

		const appSettings = AppSettingsSchema.parse({
			name: data.instanceName,
			displayName: data.instanceName,
			picture: data.logoUrl || 'https://plebeian.market/logo.svg',
			banner: 'https://plebeian.market/banner.png',
			ownerPk: ownerPubkey,
			allowRegister: data.allowRegister,
			defaultCurrency: data.defaultCurrency,
			contactEmail: data.contactEmail,
		})

		const response = await fetch('/api/config', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				appSettings,
				adminsList: data.adminsList,
				relayUrl: data.relayUrl || RELAY_URL,
			}),
		})

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({ message: 'Failed to parse error response' }))
			throw new Error(errorData.message || `Server responded with status: ${response.status}`)
		}

		const result = await response.json()

		if (!result.success) {
			throw new Error(result.message || 'Unknown error occurred')
		}
	} catch (error) {
		console.error('Failed to submit app settings:', error)
		throw error
	}
}

export async function fetchAnyAppSettings(relayUrl: string): Promise<AppSettings | null> {
	const nostrService = NostrService.getInstance([relayUrl])
	await nostrService.connect()
	const filter: NDKFilter = {
		kinds: [31990],
		limit: 10,
	}

	const events = await nostrService.ndkInstance.fetchEvents(filter)
	const eventArray = Array.from(events)

	if (eventArray.length === 0) {
		console.log('No app settings events found at all')
		return null
	}

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
