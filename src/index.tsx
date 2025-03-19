import { NDKEvent, NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
import { serve } from 'bun'
import { config } from 'dotenv'
import { nip19 } from 'nostr-tools'
import { getPublicKey, verifyEvent, type Event } from 'nostr-tools/pure'
import index from './index.html'
import { fetchAnyAppSettings, fetchAppSettings } from './lib/appSettings'
import { NostrService } from './lib/nostr'
import { eventHandler } from './lib/wsSignerEventHandler'

// Define the NostrMessage type
export type NostrMessage = ['EVENT', Event]

// Use an immediately invoked async function to properly handle async initialization
;(async function initServer() {
	config()

	const RELAY_URL = process.env.APP_RELAY_URL
	const APP_PRIVATE_KEY = process.env.APP_PRIVATE_KEY

	const relay = RELAY_URL as string

	let appSettings: Awaited<ReturnType<typeof fetchAppSettings>> = null
	let APP_PUBLIC_KEY: string

	try {
		if (!RELAY_URL || !APP_PRIVATE_KEY) {
			console.error('Missing required environment variables: APP_RELAY_URL, APP_PRIVATE_KEY')
			process.exit(1)
		}

		const privateKeyBytes = new Uint8Array(Buffer.from(APP_PRIVATE_KEY, 'hex'))
		APP_PUBLIC_KEY = getPublicKey(privateKeyBytes)
		appSettings = await fetchAppSettings(relay, APP_PUBLIC_KEY)
		if (appSettings) {
			console.log('App settings loaded successfully')
		} else {
			console.log('No app settings found - setup required')
		}
	} catch (error) {
		console.error('Failed to initialize app settings:', error)
		process.exit(1)
	}

	// Initialize the event handler
	eventHandler.initialize(process.env.APP_PRIVATE_KEY || '', []).catch((error) => console.error(error))

	const server = serve({
		routes: {
			'/*': index,

			'/api/config': {
				GET: async () => {
					try {
						if (!APP_PRIVATE_KEY) {
							throw new Error('Missing APP_PRIVATE_KEY')
						}

						const privateKeyBytes = new Uint8Array(Buffer.from(APP_PRIVATE_KEY, 'hex'))
						const pubkey = getPublicKey(privateKeyBytes)

						console.log(`Fetching fresh app settings from relay: ${relay}`)
						console.log(`Using pubkey for fetch: ${pubkey}`)

						let freshAppSettings = await fetchAppSettings(relay, pubkey)

						if (!freshAppSettings) {
							console.log('No app settings found with server pubkey, checking for any app settings events...')
							freshAppSettings = await fetchAnyAppSettings(relay)

							if (freshAppSettings) {
								console.log('Found app settings with a different pubkey')
								console.log('IMPORTANT: App was set up with a different pubkey than the server is using.')
							} else {
								console.log('No app settings found at all. Setup required.')
							}
						}

						console.log(`Fresh app settings fetch result: ${JSON.stringify(freshAppSettings, null, 2)}`)

						appSettings = freshAppSettings

						const response = {
							appRelay: relay,
							appSettings: freshAppSettings,
							appPublicKey: pubkey,
							needsSetup: !freshAppSettings,
						}

						console.log(`Responding to /api/config: needsSetup=${response.needsSetup}`)
						return Response.json(response)
					} catch (error) {
						console.error('Error fetching fresh app settings:', error)
						// Fallback to cached data if fetch fails
						return Response.json({
							appRelay: relay,
							appSettings,
							appPublicKey: APP_PUBLIC_KEY,
							needsSetup: !appSettings,
						})
					}
				},
				POST: async (request: Request) => {
					try {
						if (!APP_PRIVATE_KEY) {
							throw new Error('Missing APP_PRIVATE_KEY')
						}

						const body = await request.json()
						const { appSettings: receivedSettings, adminsList, relayUrl } = body

						console.log('Received app settings setup request:', JSON.stringify(body, null, 2))

						// Convert hex string to Uint8Array
						const privateKeyBytes = new Uint8Array(Buffer.from(APP_PRIVATE_KEY, 'hex'))
						const publicKey = getPublicKey(privateKeyBytes)
						console.log(`Event will be authored by: ${publicKey}`)

						// Use the provided relay URL
						const setupRelay = relayUrl || relay
						console.log(`Connecting to relay: ${setupRelay}`)
						const nostrService = NostrService.getInstance([setupRelay])
						await nostrService.connect()

						const signer = new NDKPrivateKeySigner(privateKeyBytes)
						await signer.blockUntilReady()

						// Create and sign app settings event
						const appHandlerEvent = new NDKEvent(nostrService.ndkInstance)
						appHandlerEvent.kind = 31990
						appHandlerEvent.content = JSON.stringify(receivedSettings)
						appHandlerEvent.tags = [
							['d', 'app/settings'],
							['k', '30402'],
							['k', '30405'],
							['k', '30406'],
							['k', '30407'],
							['web', 'https://plebeian.market/a/', 'nevent'],
							['web', 'https://plebeian.market/p/', 'nprofile'],
							['r', setupRelay],
						]

						// Sign and publish the event
						await appHandlerEvent.sign(signer)
						await appHandlerEvent.publish()
						console.log('Published app settings event')

						// Create admin roles events
						if (adminsList && adminsList.length > 0) {
							const userRolesAdminsEvent = new NDKEvent(nostrService.ndkInstance)
							userRolesAdminsEvent.kind = 30000
							userRolesAdminsEvent.tags.push(['d', 'roles/admins'])

							for (const admin of adminsList) {
								try {
									// Extract the pubkey if this is an npub
									if (admin.startsWith('npub')) {
										const { type, data: pubkeyData } = nip19.decode(admin)
										if (type === 'npub') {
											userRolesAdminsEvent.tags.push(['p', pubkeyData.toString()])
										}
									} else {
										userRolesAdminsEvent.tags.push(['p', admin])
									}
								} catch (error) {
									console.error(`Invalid admin pubkey: ${admin}`, error)
								}
							}

							await userRolesAdminsEvent.sign(signer)
							await userRolesAdminsEvent.publish()
							console.log('Published admin roles event')
						}

						// Update our local app settings
						const updatedAppSettings = await fetchAppSettings(setupRelay, publicKey)
						if (updatedAppSettings) {
							// Update our cache reference without reassignment
							Object.assign(appSettings || {}, updatedAppSettings)
						}

						return Response.json({ success: true })
					} catch (error) {
						console.error('Error processing app settings setup:', error)
						return new Response(
							JSON.stringify({
								message: error instanceof Error ? error.message : 'An unknown error occurred',
							}),
							{
								status: 500,
								headers: {
									'Content-Type': 'application/json',
								},
							},
						)
					}
				},
			},
		},

		fetch(req, server) {
			if (server.upgrade(req)) {
				return new Response()
			}
			return new Response('Upgrade failed', { status: 500 })
		},
		// @ts-ignore
		websocket: {
			message(ws, message) {
				try {
					const data = JSON.parse(String(message)) as NostrMessage
					console.log('Received WebSocket message:', data)

					if (!verifyEvent(data[1] as Event)) throw Error('Unable to verify event')

					if (data[0] === 'EVENT' && data[1].sig) {
						const resignedEvent = eventHandler.handleEvent(data[1])

						if (resignedEvent) {
							// If event was from admin and successfully resigned
							const okResponse = ['OK', resignedEvent.id, true, '']
							ws.send(JSON.stringify(okResponse))
						} else {
							// If event was not from admin
							const okResponse = ['OK', data[1].id, false, 'Not authorized']
							ws.send(JSON.stringify(okResponse))
						}
					}
				} catch (error) {
					console.error('Error processing WebSocket message:', error)
					try {
						const failedData = JSON.parse(String(message)) as Event
						if (failedData.id) {
							const errorResponse = ['OK', failedData.id, false, `error: Invalid message format ${error}`]
							ws.send(JSON.stringify(errorResponse))
						}
					} catch {
						ws.send(JSON.stringify(['NOTICE', 'error: Invalid JSON']))
					}
				}
			},
			open() {
				console.log('WebSocket connection opened')
			},
			close() {
				console.log('WebSocket connection closed')
			},
		},

		development: process.env.NODE_ENV !== 'production',
	})

	console.log(`🚀 Server running at ${server.url}`)
})().catch((err) => {
	console.error('Failed to start server:', err)
	process.exit(1)
})
