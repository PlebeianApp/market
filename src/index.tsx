import { serve } from 'bun'
import { config } from 'dotenv'
import { Relay } from 'nostr-tools'
import { getPublicKey, verifyEvent, type Event } from 'nostr-tools/pure'
import index from './index.html'
import { fetchAppSettings } from './lib/appSettings'
import { getEventHandler } from './server'
import { join } from 'path'
import { file } from 'bun'
import { existsSync } from 'fs'

import.meta.hot.accept()

config()

const RELAY_URL = process.env.APP_RELAY_URL
const NIP46_RELAY_URL = process.env.NIP46_RELAY_URL || 'wss://relay.nsec.app'
const APP_PRIVATE_KEY = process.env.APP_PRIVATE_KEY
const STAGING = process.env.STAGING !== 'false' // Default to true
const isProduction = process.env.NODE_ENV === 'production'

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
		appSettings = await fetchAppSettings(RELAY_URL as string, APP_PUBLIC_KEY)
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

getEventHandler()
	.initialize({
		appPrivateKey: process.env.APP_PRIVATE_KEY || '',
		adminPubkeys: [],
		relayUrl: RELAY_URL,
	})
	.catch((error) => console.error(error))

// Helper function to determine content type based on file extension
const getContentType = (path: string): string => {
	if (path.endsWith('.svg')) return 'image/svg+xml'
	if (path.endsWith('.png')) return 'image/png'
	if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg'
	if (path.endsWith('.css')) return 'text/css'
	if (path.endsWith('.js')) return 'application/javascript'
	if (path.endsWith('.js.map')) return 'application/json'
	if (path.endsWith('.ttf')) return 'font/ttf'
	if (path.endsWith('.woff')) return 'font/woff'
	if (path.endsWith('.woff2')) return 'font/woff2'
	if (path.endsWith('.ico')) return 'image/x-icon'
	return 'application/octet-stream'
}

// Handle static files from the public directory
const serveStatic = async (path: string) => {
	const filePath = join(process.cwd(), 'public', path)
	try {
		const f = file(filePath)
		if (!f.exists()) {
			return new Response('File not found', { status: 404 })
		}

		return new Response(f, {
			headers: { 'Content-Type': getContentType(path) },
		})
	} catch (error) {
		console.error(`Error serving static file ${path}:`, error)
		return new Response('Internal server error', { status: 500 })
	}
}

// Handle built assets from the dist directory (production only)
const serveDist = async (path: string) => {
	const filePath = join(process.cwd(), 'dist', path)
	try {
		const f = file(filePath)
		if (!f.exists()) {
			return new Response('File not found', { status: 404 })
		}

		return new Response(f, {
			headers: { 'Content-Type': getContentType(path) },
		})
	} catch (error) {
		console.error(`Error serving dist file ${path}:`, error)
		return new Response('Internal server error', { status: 500 })
	}
}

// Get the index HTML handler (built in production, source in development)
const getIndexHandler = () => {
	if (isProduction) {
		const distIndexPath = join(process.cwd(), 'dist', 'index.html')
		if (existsSync(distIndexPath)) {
			return async () => {
				const f = file(distIndexPath)
				if (!f.exists()) {
					return new Response('Built index.html not found', { status: 500 })
				}
				return new Response(f, {
					headers: { 'Content-Type': 'text/html' },
				})
			}
		}
		console.warn('⚠️  Production mode but dist/index.html not found, falling back to source')
	}
	return index
}

export const server = serve({
	routes: {
		// API routes first
		'/api/config': {
			GET: async () => {
				// Always fetch fresh settings from relay
				const currentSettings = await fetchAppSettings(RELAY_URL as string, APP_PUBLIC_KEY)
				return Response.json({
					appRelay: RELAY_URL,
					nip46Relay: NIP46_RELAY_URL,
					appSettings: currentSettings,
					appPublicKey: APP_PUBLIC_KEY,
					needsSetup: !currentSettings,
				})
			},
		},
		// Serve public images
		'/images/:file': ({ params }) => serveStatic(`images/${params.file}`),
		// In production, serve built assets from dist/ directory
		...(isProduction
			? {
					'/chunk-:file': ({ params }) => serveDist(`chunk-${params.file}`),
					'/favicon-:file': ({ params }) => serveDist(`favicon-${params.file}`),
					'/logo-:file': ({ params }) => serveDist(`logo-${params.file}`),
					'/IBMPlexMono-:file': ({ params }) => serveDist(`IBMPlexMono-${params.file}`),
				}
			: {}),
		// Catch-all route for HTML (must be last)
		'/*': async (req) => {
			// In production, check if this is a request for a dist asset
			if (isProduction) {
				const url = new URL(req.url)
				const pathname = url.pathname
				if (pathname !== '/' && !pathname.startsWith('/api/') && !pathname.startsWith('/images/')) {
					const fileName = pathname.slice(1) // Remove leading slash
					const distPath = join(process.cwd(), 'dist', fileName)
					if (existsSync(distPath)) {
						return serveDist(fileName)
					}
				}
			}
			// Otherwise serve the index HTML
			return getIndexHandler()()
		},
	},
	development: !isProduction,
	fetch(req, server) {
		if (server.upgrade(req)) {
			return new Response()
		}
		// Let routes handle the request
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

					const resignedEvent = getEventHandler().handleEvent(data[1])

					if (resignedEvent) {
						const relay = await Relay.connect(RELAY_URL as string)
						await relay.publish(resignedEvent as Event)
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
	},
})

console.log(`🚀 Server running at ${server.url}`)
