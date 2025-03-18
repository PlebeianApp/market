import { serve } from 'bun'
import index from './index.html'
import { verifyEvent, type Event } from 'nostr-tools/pure'
import { eventHandler } from './lib/wsSignerEventHandler'

export type NostrMessage = ['EVENT', Event]

eventHandler.initialize(process.env.APP_PRIVATE_KEY || '', []).catch((error) => console.error(error))

export const server = serve({
	fetch(req, server) {
		if (server.upgrade(req)) {
			return
		}

		const url = new URL(req.url)

		if (url.pathname === '/api/config') {
			return Response.json({
				appRelay: process.env.APP_RELAY_URL,
			})
		}

		return new Response(index)
	},
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
		close(code, message) {
			console.log('WebSocket connection closed')
		},
	},

	development: process.env.NODE_ENV !== 'production',
})

console.log(`🚀 Server running at ${server.url}`)
