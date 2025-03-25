import type { ServerWebSocket } from 'bun'
import { serve } from 'bun'
import { config } from 'dotenv'
import { Relay } from 'nostr-tools'
import { getPublicKey, verifyEvent, type Event } from 'nostr-tools/pure'
import index from './index.html'
import { fetchAppSettings } from './lib/appSettings'
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
		async message(ws, message) {
			try {
				const messageStr = String(message)
				const data = JSON.parse(messageStr)

				if (Array.isArray(data) && data[0] === 'EVENT' && data[1].sig) {
					console.log('Processing EVENT message')

					if (!verifyEvent(data[1] as Event)) throw Error('Unable to verify event')

					const resignedEvent = eventHandler.handleEvent(data[1])

					if (resignedEvent) {
						// If event was from admin and successfully resigned
						const relay = await Relay.connect(RELAY_URL as string)
						await relay.publish(resignedEvent as Event)
						const okResponse = ['OK', data[1].id, true, '']
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

console.log(`🚀 Server running at ${server.url}`)
