import type { NDKFilter, NostrEvent } from '@nostr-dev-kit/ndk'
import { Relay, type Event } from 'nostr-tools'
import { AppSettingsSchema, type AppSettings } from './schemas/app'
import { ndkActions } from './stores/ndk'

export async function fetchAppSettings(relayUrl: string, appPubkey: string): Promise<AppSettings | null> {
	console.log(`Fetching app settings from relay: ${relayUrl} for pubkey: ${appPubkey}`)

	try {
		const ndk = ndkActions.initialize([relayUrl])
		await ndk.connect()

		// NIP-33 parameterized replaceable events (kind 31990) are indexed by pubkey+kind+d tag.
		// Without the "#d" filter many relays will return no results even if such events exist.
		const filter: NDKFilter = {
			kinds: [31990],
			authors: [appPubkey],
			limit: 1,
		}

		// Add a soft timeout so we don't hang forever if the relay is slow.
		const fetchWithTimeout = <T>(p: Promise<T>, ms: number) =>
			new Promise<T>((resolve, reject) => {
				const id = setTimeout(() => reject(new Error(`fetchEvents timeout after ${ms}ms`)), ms)
				p.then((v) => {
					clearTimeout(id)
					resolve(v)
				}).catch((e) => {
					clearTimeout(id)
					reject(e)
				})
			})

		const events = (await fetchWithTimeout(ndk.fetchEvents(filter), 10000)) as Set<any>
		const eventArray = Array.from(events)

		if (eventArray.length === 0) {
			console.log(`No app settings events found for pubkey: ${appPubkey} with dTag: ${dTag}`)
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
	} catch (err) {
		console.error('Failed to fetch app settings due to connection or relay error:', err)
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

// export async function submitAppSettings(data: NostrEvent): Promise<void> {
// 	try {
// 		const wsUrl = `${window.location.protocol === 'https:' ? `wss://${window.location.hostname}` : `ws://${window.location.hostname}:3000`}`
// 		console.log(`Connecting to WebSocket at ${wsUrl}`)
// 		const relay = await Relay.connect(wsUrl as string)
// 		await relay.publish(data as Event)
// 	} catch (error) {
// 		console.error('Failed to submit app settings:', error)
// 		throw error
// 	}
// }

// relay publishing does not resolve the promise, so we need to use a websocket to publish the event

export async function submitAppSettings(data: NostrEvent): Promise<void> {
	return new Promise((resolve, reject) => {
		const wsUrl = `${window.location.protocol === 'https:' ? `wss://${window.location.hostname}` : `ws://${window.location.hostname}:3000`}`
		console.log(`Connecting to WebSocket at ${wsUrl}`)

		const ws = new WebSocket(wsUrl)

		// Set up timeout
		const timeoutId = setTimeout(() => {
			ws.close()
			reject(new Error('WebSocket timeout after 10 seconds'))
		}, 10000)

		ws.onopen = () => {
			console.log('WebSocket connected, sending event...')
			// Send the event in Nostr protocol format
			const message = ['EVENT', data]
			ws.send(JSON.stringify(message))
		}

		ws.onmessage = (event) => {
			try {
				const response = JSON.parse(event.data)
				console.log('WebSocket response:', response)

				// Check for OK response
				if (Array.isArray(response) && response[0] === 'OK') {
					const [, eventId, success, message] = response
					if (success) {
						console.log('Event published successfully:', eventId)
						clearTimeout(timeoutId)
						ws.close()
						resolve()
					} else {
						console.error('Event rejected:', message)
						clearTimeout(timeoutId)
						ws.close()
						reject(new Error(`Event rejected: ${message}`))
					}
				}
			} catch (err) {
				console.error('Failed to parse WebSocket response:', err)
			}
		}

		ws.onerror = (error) => {
			console.error('WebSocket error:', error)
			clearTimeout(timeoutId)
			reject(new Error('WebSocket connection failed'))
		}

		ws.onclose = (event) => {
			clearTimeout(timeoutId)
			if (event.code !== 1000) {
				// 1000 is normal closure
				reject(new Error(`WebSocket closed unexpectedly: ${event.code}`))
			}
		}
	})
}
