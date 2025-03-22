import { NDKEvent, NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
import type { ServerWebSocket } from 'bun'
import { serve } from 'bun'
import { config } from 'dotenv'
import { nip19 } from 'nostr-tools'
import { getPublicKey, verifyEvent, type Event } from 'nostr-tools/pure'
import index from './index.html'
import { fetchAppSettings } from './lib/appSettings'
import { NostrService } from './lib/nostr'
import { eventHandler } from './lib/wsSignerEventHandler'

config()

const RELAY_URL = process.env.APP_RELAY_URL
const APP_PRIVATE_KEY = process.env.APP_PRIVATE_KEY

const relay = RELAY_URL as string

let appSettings: Awaited<ReturnType<typeof fetchAppSettings>> = null
let APP_PUBLIC_KEY: string

async function initializeAppSettings() {
	if (!RELAY_URL || !APP_PRIVATE_KEY) {
		console.error('Missing required environment variables: APP_RELAY_URL, APP_PRIVATE_KEY')
		process.exit(1)
	}

	try {
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
}
;(async () => await initializeAppSettings())()
export type NostrMessage = ['EVENT', Event]
export type SetupMessage = [
	'SETUP',
	{
		type: string
		appSettings: any
		adminsList: string[]
		relayUrl?: string
	},
]

eventHandler.initialize(process.env.APP_PRIVATE_KEY || '', []).catch((error) => console.error(error))

export const server = serve({
	routes: {
		'/*': index,
		'/api/config': {
			GET: () =>
				Response.json({
					appRelay: relay,
					appSettings,
					appPublicKey: APP_PUBLIC_KEY,
					needsSetup: !appSettings,
				}),
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
				const messageStr = String(message)
				const data = JSON.parse(messageStr)

				if (Array.isArray(data) && data[0] === 'SETUP') {
					handleSetupMessage(ws as ServerWebSocket<unknown>, data as SetupMessage)
					return
				}

				if (Array.isArray(data) && data[0] === 'EVENT' && data[1].sig) {
					console.log('Processing EVENT message')
					if (!verifyEvent(data[1] as Event)) throw Error('Unable to verify event')

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
						return
					}
				} catch {
					ws.send(JSON.stringify(['NOTICE', 'error: Invalid JSON']))
				}
			}
		},
		open(ws: ServerWebSocket<unknown>) {
			console.log('WebSocket connection opened')
		},
		close(ws: ServerWebSocket<unknown>) {
			console.log('WebSocket connection closed')
		},
	},
	development: process.env.NODE_ENV !== 'production',
})

async function handleSetupMessage(ws: ServerWebSocket<unknown>, data: SetupMessage) {
	try {
		if (!APP_PRIVATE_KEY) {
			console.error('Missing APP_PRIVATE_KEY environment variable')
			ws.send(JSON.stringify(['OK', '', false, 'Server configuration error: Missing private key']))
			return false
		}

		if (!Array.isArray(data) || data.length !== 2 || typeof data[1] !== 'object') {
			console.error('Invalid SETUP message format:', data)
			ws.send(JSON.stringify(['OK', '', false, 'Invalid message format']))
			return false
		}

		const [_, setupData] = data

		if (!setupData || typeof setupData !== 'object') {
			console.error('Invalid setup data:', setupData)
			ws.send(JSON.stringify(['OK', '', false, 'Invalid setup data']))
			return false
		}

		const { appSettings: receivedSettings, adminsList, relayUrl } = setupData

		if (!receivedSettings || typeof receivedSettings !== 'object') {
			console.error('Missing or invalid appSettings in setup data')
			ws.send(JSON.stringify(['OK', '', false, 'Missing or invalid app settings']))
			return false
		}

		console.log(
			'Received setup data:',
			JSON.stringify(
				{
					appSettings: {
						...receivedSettings,
						contactEmail: receivedSettings.contactEmail ? '[REDACTED]' : undefined,
					},
					adminsList: adminsList ? `[${adminsList.length} items]` : [],
					relayUrl: relayUrl || '[default]',
				},
				null,
				2,
			),
		)

		if (appSettings) {
			if (!receivedSettings.ownerPk || (appSettings.ownerPk && receivedSettings.ownerPk !== appSettings.ownerPk)) {
				console.error('Setup not allowed - app already configured and request not from owner')
				ws.send(JSON.stringify(['OK', '', false, 'Setup not allowed - app already configured and request not from owner']))
				return false
			}
		}

		const privateKeyBytes = new Uint8Array(Buffer.from(APP_PRIVATE_KEY, 'hex'))
		const publicKey = getPublicKey(privateKeyBytes)

		const setupRelay = relayUrl || relay
		console.log(`Connecting to relay: ${setupRelay}`)
		const nostrService = NostrService.getInstance([setupRelay])
		await nostrService.connect()

		const signer = new NDKPrivateKeySigner(privateKeyBytes)
		await signer.blockUntilReady()

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

		await appHandlerEvent.sign(signer)
		await appHandlerEvent.publish()

		if (adminsList && adminsList.length > 0) {
			const userRolesAdminsEvent = new NDKEvent(nostrService.ndkInstance)
			userRolesAdminsEvent.kind = 30000
			userRolesAdminsEvent.tags = []
			userRolesAdminsEvent.tags.push(['d', 'roles/admins'])

			for (const admin of adminsList) {
				try {
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
		} else {
			console.log('No admins specified, skipping admin roles event')
		}

		const updatedAppSettings = await fetchAppSettings(setupRelay, publicKey)
		if (updatedAppSettings) {
			Object.assign(appSettings || {}, updatedAppSettings)
		} else {
			console.log('Failed to fetch updated app settings')
		}

		const response = ['OK', appHandlerEvent.id, true, '']
		ws.send(JSON.stringify(response))
		return true
	} catch (error) {
		console.error('Error processing setup message:', error)
		try {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error'
			ws.send(JSON.stringify(['OK', '', false, errorMessage]))
		} catch (sendError) {
			console.error('Failed to send error response:', sendError)
		}
		return false
	}
}

console.log(`🚀 Server running at ${server.url}`)
