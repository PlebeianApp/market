import type { NDKFilter } from '@nostr-dev-kit/ndk'
import { nip19 } from 'nostr-tools'
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

		const setupData = {
			type: 'APP_SETUP',
			appSettings,
			adminsList: data.adminsList,
			relayUrl: data.relayUrl,
		}

		const wsUrl = window.location.protocol === 'https:' ? 'wss://localhost:3000' : 'ws://localhost:3000'
		console.log(`Connecting to WebSocket at ${wsUrl}`)
		const socket = new WebSocket(wsUrl)

		console.log('Sending setup data', socket)

		return new Promise((resolve, reject) => {
			let hasResponded = false

			socket.onopen = () => {
				const message = JSON.stringify(['SETUP', setupData])
				socket.send(message)
			}

			socket.onmessage = (event) => {
				try {
					const message = JSON.parse(event.data)
					hasResponded = true

					if (Array.isArray(message) && message[0] === 'OK') {
						const [_, eventId, success, errorMessage] = message

						if (success) {
							console.log('Setup data successfully processed by server')
							socket.close()
							resolve()
						} else {
							socket.close()
							reject(new Error(errorMessage || 'Server rejected the setup data'))
						}
					} else {
						console.warn('Unexpected response format:', message)
						socket.close()
						reject(new Error('Received unrecognized response format from server'))
					}
				} catch (e) {
					console.error('Failed to process WebSocket message', e)
					socket.close()
					reject(e)
				}
			}

			socket.onerror = (error) => {
				console.error('WebSocket error:', error)
				reject(new Error('WebSocket connection failed'))
			}

			socket.onclose = (event) => {
				console.log(`WebSocket closed: ${event.code}`, event)
				if (!hasResponded) {
					reject(new Error(`WebSocket closed without response, code: ${event.code}`))
				}
			}

			setTimeout(() => {
				if (socket.readyState === WebSocket.OPEN) {
					console.error('WebSocket timeout after 30 seconds')
					socket.close()
					reject(new Error('WebSocket operation timed out'))
				}
			}, 30000)
		})
	} catch (error) {
		console.error('Failed to submit app settings:', error)
		throw error
	}
}
