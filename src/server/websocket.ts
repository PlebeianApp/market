import { Relay } from 'nostr-tools'
import { verifyEvent, type Event } from 'nostr-tools/pure'
import type { ServerWebSocket } from 'bun'
import { getEventHandler } from './EventHandler'
import { AppSettingsSchema } from '../lib/schemas/app'
import { isEventHandlerReady, RELAY_URL, setAppSettings } from './runtime'

/**
 * Bun WebSocket message handler — accepts incoming Nostr-style frames
 * (`['EVENT', ...]`) from connected clients, runs them through the
 * `EventHandler`, optionally re-publishes the resigned event back to
 * the configured relay, and ACKs over the same socket.
 */
export const websocketHandler = {
	async message(ws: ServerWebSocket<unknown>, message: string | Buffer) {
		try {
			const messageStr = String(message)
			const data = JSON.parse(messageStr)

			if (Array.isArray(data) && data[0] === 'EVENT' && data[1].sig) {
				console.log('Processing EVENT message')

				// Check if EventHandler is ready
				if (!isEventHandlerReady()) {
					const errorResponse = ['OK', data[1].id, false, 'error: Server initializing, please try again']
					ws.send(JSON.stringify(errorResponse))
					return
				}

				if (!verifyEvent(data[1] as Event)) {
					ws.send(JSON.stringify(['OK', data[1].id, false, 'error: Unable to verify event signature']))
					return
				}

				let resignedEvent
				try {
					resignedEvent = getEventHandler().handleEvent(data[1])
				} catch (handleError) {
					console.error('Error in handleEvent:', handleError)
					ws.send(JSON.stringify(['OK', data[1].id, false, `error: Handler error: ${handleError}`]))
					return
				}

				if (resignedEvent) {
					const relay = await Relay.connect(RELAY_URL as string)
					await relay.publish(resignedEvent as Event)

					// Update cached appSettings when a kind 31990 event is published
					if (resignedEvent.kind === 31990) {
						try {
							const parsed = AppSettingsSchema.parse(JSON.parse(resignedEvent.content))
							setAppSettings(parsed)
							console.log('App settings cache updated from new kind 31990 event')
						} catch (e) {
							console.warn('Failed to update app settings cache:', e)
						}
					}

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
}
