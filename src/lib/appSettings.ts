import NDK, { type NDKFilter, type NDKEvent, type NostrEvent } from '@nostr-dev-kit/ndk'
import { AppSettingsSchema, type AppSettings } from './schemas/app'
import { isValidHexKey } from './utils'

/** Kind for NIP-89 handler information / app-config events. */
export const APP_SETTINGS_KIND = 31990
/** Exact d tag that identifies the Plebeian Market app-settings event. */
export const APP_SETTINGS_D_TAG = 'plebeian-market-handler'

/**
 * Structural shape needed to verify app-settings publisher authority. Kept
 * minimal (and independent of the NDKEvent class) so it is easy to construct
 * in tests.
 */
export interface AppSettingsEventLike {
	kind?: number
	pubkey: string
	tags: Array<string[]>
	created_at?: number
	content: string
}

/**
 * Select the latest app-settings event that matches the expected publisher
 * authority: the event must be kind 31990, authored by `appPubkey`, and carry
 * the exact d tag 'plebeian-market-handler'. Events from any other publisher
 * (or with a different kind / d tag) are rejected — the content schema
 * validates shape, not authority, so a spoofed event that passes the schema
 * must still be refused here.
 */
export function selectAuthoritativeAppSettingsEvent(
	events: ReadonlyArray<AppSettingsEventLike>,
	appPubkey: string,
): AppSettingsEventLike | undefined {
	return events
		.filter(
			(e) => e.kind === APP_SETTINGS_KIND && e.pubkey === appPubkey && e.tags.some((t) => t[0] === 'd' && t[1] === APP_SETTINGS_D_TAG),
		)
		.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
}

export async function fetchAppSettings(relayUrl: string, appPubkey: string): Promise<AppSettings | null> {
	console.log(`Fetching app settings from relay: ${relayUrl} for pubkey: ${appPubkey}`)

	// Reject a malformed app pubkey before creating an NDK instance or issuing
	// any relay request. NDK's strict filter validation would also fail closed,
	// but validating here gives a clear, early failure and guarantees the
	// authors constraint is never satisfied by an unrelated publisher.
	if (!isValidHexKey(appPubkey)) {
		console.error('Invalid app pubkey provided:', appPubkey)
		return null
	}

	try {
		// Create a fresh NDK instance for server-side initialization
		// to avoid shared store issues with ndkActions
		const ndk = new NDK({
			explicitRelayUrls: [relayUrl],
			// Server-side, one-off fetch of app-config events. AI guardrails are a
			// dev-time educational tool and have no place here. NDK's default strict
			// filter validation is retained (a malformed appPubkey fails closed
			// rather than broadening the query).
			aiGuardrails: false,
		})

		// Connect with timeout
		try {
			await Promise.race([
				ndk.connect(),
				new Promise<never>((_, reject) => setTimeout(() => reject(new Error('NDK connect timeout')), 5000)),
			])
		} catch (connectErr) {
			console.warn('NDK connect warning (may still work):', connectErr)
			// Check if we have any connected relays despite the timeout
			const connected = ndk.pool?.connectedRelays() || []
			if (connected.length === 0) {
				console.error('No relays connected, cannot fetch app settings')
				return null
			}
			console.log(`Connected to ${connected.length} relays despite timeout`)
		}

		// NIP-33 parameterized replaceable events (kind 31990) are indexed by pubkey+kind+d tag.
		// Include the d tag filter for better relay compatibility
		const filter: NDKFilter = {
			kinds: [31990],
			authors: [appPubkey],
			'#d': ['plebeian-market-handler'],
			limit: 1,
		}

		console.log('Fetching with filter:', JSON.stringify(filter))

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

		const events = (await fetchWithTimeout(ndk.fetchEvents(filter), 10000)) as Set<NDKEvent>
		const eventArray = Array.from(events)
		console.log(`Fetch returned ${eventArray.length} events`)

		if (eventArray.length === 0) {
			console.log(`No app settings events found for pubkey: ${appPubkey}`)
			return null
		}

		console.log(`Found ${eventArray.length} app settings events`)

		// Verify publisher authority before accepting content: select only the
		// event authored by the expected app pubkey, with kind 31990 and the exact
		// d tag 'plebeian-market-handler'. A relay could return an event from a
		// different publisher whose content passes the shape schema; reject it
		// here (see selectAuthoritativeAppSettingsEvent).
		const authoritativeEvent = selectAuthoritativeAppSettingsEvent(eventArray, appPubkey)
		if (!authoritativeEvent) {
			console.warn(`No app settings event from expected publisher: ${appPubkey}`)
			return null
		}

		try {
			const parsedContent = JSON.parse(authoritativeEvent.content)
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
		const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
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
