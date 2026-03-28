import { serve } from 'bun'
import { config } from 'dotenv'
import { Relay } from 'nostr-tools'
import { getPublicKey, verifyEvent, type Event } from 'nostr-tools/pure'
import NDK from '@nostr-dev-kit/ndk'
import { bech32 } from '@scure/base'
import index from './index.html'
import { fetchAppSettings } from './lib/appSettings'
import { AppSettingsSchema } from './lib/schemas/app'
import { getEventHandler } from './server'
import { ZapInvoiceError } from './server/ZapPurchaseManager'
import type { ZapPurchaseInvoiceRequestBody } from './server/ZapPurchaseManager'
import { join } from 'path'
import { file } from 'bun'

import.meta.hot.accept()

config()

const RELAY_URL = process.env.APP_RELAY_URL
const NIP46_RELAY_URL = process.env.NIP46_RELAY_URL || 'wss://relay.nsec.app'
const APP_PRIVATE_KEY = process.env.APP_PRIVATE_KEY

let appSettings: Awaited<ReturnType<typeof fetchAppSettings>> = null
let APP_PUBLIC_KEY: string

let invoiceNdk: NDK | null = null
let invoiceNdkConnectPromise: Promise<void> | null = null
let cachedAppLightningIdentifier: { value: string; fetchedAtMs: number } | null = null

function jsonError(message: string, status = 400) {
	return Response.json({ error: message }, { status })
}

function getAppPublicKeyOrThrow(): string {
	if (APP_PUBLIC_KEY) return APP_PUBLIC_KEY
	if (!APP_PRIVATE_KEY) throw new Error('Missing APP_PRIVATE_KEY')

	const privateKeyBytes = new Uint8Array(Buffer.from(APP_PRIVATE_KEY, 'hex'))
	APP_PUBLIC_KEY = getPublicKey(privateKeyBytes)
	return APP_PUBLIC_KEY
}

function decodeLnurlBech32(lnurl: string): string | null {
	try {
		const decoded = bech32.decode(lnurl.toLowerCase(), 1500)
		const bytes = bech32.fromWords(decoded.words)
		return new TextDecoder().decode(Uint8Array.from(bytes))
	} catch {
		return null
	}
}

function toLnurlpEndpoint(lightningIdentifier: string): string {
	const trimmed = lightningIdentifier.trim()

	// LUD16: name@domain
	if (trimmed.includes('@')) {
		const [name, domain] = trimmed.split('@')
		if (!name || !domain) throw new Error('Invalid Lightning Address format')
		return `https://${domain}/.well-known/lnurlp/${name}`
	}

	// LUD06: bech32 lnurl
	if (trimmed.toLowerCase().startsWith('lnurl')) {
		const decoded = decodeLnurlBech32(trimmed)
		if (!decoded) throw new Error('Invalid LNURL (lud06)')
		return decoded
	}

	// Some profiles put the LNURL-pay endpoint directly in lud06
	if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
		return trimmed
	}

	throw new Error('Unsupported Lightning identifier (expected lud16 or lud06)')
}

async function ensureInvoiceNdkConnected(): Promise<NDK> {
	if (!RELAY_URL) {
		throw new Error('Missing APP_RELAY_URL')
	}
	if (!invoiceNdk) {
		invoiceNdk = new NDK({ explicitRelayUrls: [RELAY_URL] })
	}
	if (!invoiceNdkConnectPromise) {
		invoiceNdkConnectPromise = invoiceNdk.connect().catch((error) => {
			invoiceNdkConnectPromise = null
			throw error
		})
	}
	await invoiceNdkConnectPromise
	return invoiceNdk
}

async function getAppLightningIdentifier(): Promise<string> {
	const envValue =
		process.env.APP_LIGHTNING_ADDRESS || process.env.APP_LUD16 || process.env.APP_LN_ADDRESS || process.env.APP_LIGHTNING_IDENTIFIER
	if (envValue && envValue.trim()) return envValue.trim()

	if (!APP_PUBLIC_KEY) {
		throw new Error('App public key not initialized')
	}

	const now = Date.now()
	if (cachedAppLightningIdentifier && now - cachedAppLightningIdentifier.fetchedAtMs < 5 * 60 * 1000) {
		return cachedAppLightningIdentifier.value
	}

	const ndk = await ensureInvoiceNdkConnected()
	const user = ndk.getUser({ pubkey: getAppPublicKeyOrThrow() })
	await user.fetchProfile()

	const identifier = user.profile?.lud16 || user.profile?.lud06
	if (!identifier) {
		throw new Error('App does not have a Lightning Address configured (missing lud16/lud06 on app profile)')
	}

	cachedAppLightningIdentifier = { value: identifier, fetchedAtMs: now }
	return identifier
}

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

// Track initialization state
let eventHandlerReady = false

getEventHandler()
	.initialize({
		appPrivateKey: process.env.APP_PRIVATE_KEY || '',
		adminPubkeys: [],
		relayUrl: RELAY_URL,
	})
	.then(() => {
		eventHandlerReady = true
	})
	.catch((error) => console.error(error))

// Handle static files from the public directory
const serveStatic = async (path: string) => {
	const filePath = join(process.cwd(), 'public', path)
	try {
		const f = file(filePath)
		if (!f.exists()) {
			return new Response('File not found', { status: 404 })
		}
		// Determine content type based on file extension
		const contentType = path.endsWith('.svg')
			? 'image/svg+xml'
			: path.endsWith('.png')
				? 'image/png'
				: path.endsWith('.jpg') || path.endsWith('.jpeg')
					? 'image/jpeg'
					: path.endsWith('.css')
						? 'text/css'
						: path.endsWith('.js')
							? 'application/javascript'
							: path.endsWith('.json')
								? 'application/json'
								: path.endsWith('.ico')
									? 'image/x-icon'
									: 'application/octet-stream'

		return new Response(f, {
			headers: { 'Content-Type': contentType },
		})
	} catch (error) {
		console.error(`Error serving static file ${path}:`, error)
		return new Response('Internal server error', { status: 500 })
	}
}

/**
 * Determine the deployment stage from NODE_ENV
 */
function determineStage(): 'production' | 'staging' | 'development' {
	const explicitStage = process.env.APP_STAGE
	if (explicitStage === 'staging' || explicitStage === 'production' || explicitStage === 'development') {
		return explicitStage
	}

	const env = process.env.NODE_ENV
	if (env === 'staging') return 'staging'
	if (env === 'production') return 'production'
	return 'development'
}

export const server = serve({
	routes: {
		'/api/config': {
			GET: () => {
				const stage = determineStage()
				// Return cached settings loaded at startup
				return Response.json({
					appRelay: RELAY_URL,
					stage,
					nip46Relay: NIP46_RELAY_URL,
					appSettings: appSettings,
					appPublicKey: APP_PUBLIC_KEY,
					needsSetup: !appSettings,
				})
			},
		},
		//Generic zap purchase invoice endpoint.
		//Auto-resolves the correct `ZapPurchaseManager` from the zap request's `L` tag.
		'/api/zapPurchase': {
			POST: async (req) => {
				console.log('📨 /api/zapPurchase request received')

				let body: ZapPurchaseInvoiceRequestBody
				try {
					body = (await req.json()) as ZapPurchaseInvoiceRequestBody
				} catch {
					return jsonError('Invalid JSON body', 400)
				}

				// Auto-resolve the correct manager from the zap request's L (label) tag
				const { amountSats, registryKey, zapRequest } = body
				const zapLabel = zapRequest?.tags?.find((t) => t[0] === 'L')?.[1]
				if (!zapLabel) {
					return jsonError('zapRequest missing L tag', 400)
				}

				const manager = getEventHandler().getPurchaseManager(zapLabel)
				if (!manager) {
					return jsonError(`Unknown purchase type: ${zapLabel}`, 400)
				}

				try {
					const appPubkey = getAppPublicKeyOrThrow()
					const lightningIdentifier = await getAppLightningIdentifier()

					console.log(`⚡ Creating ${zapLabel} invoice:`, { registryKey, amountSats })

					const result = await manager.generateInvoice(
						{ amountSats, registryKey, zapRequest },
						appPubkey,
						lightningIdentifier,
						toLnurlpEndpoint,
					)

					console.log(`✅ ${zapLabel} invoice created`)
					return Response.json(result)
				} catch (error) {
					console.error(`${zapLabel} invoice error:`, error)
					if (error instanceof ZapInvoiceError) {
						return jsonError(error.message, error.status)
					}
					return jsonError(error instanceof Error ? error.message : 'Failed to create invoice', 500)
				}
			},
		},
		'/images/:file': ({ params }) => serveStatic(`images/${params.file}`),
		'/manifest.json': () => serveStatic('manifest.json'),
		'/sw.js': () => serveStatic('sw.js'),
		'/favicon.ico': () => serveStatic('favicon.ico'),
		'/*': index,
	},
	development: process.env.NODE_ENV !== 'production',
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

					// Check if EventHandler is ready
					if (!eventHandlerReady) {
						const errorResponse = ['OK', data[1].id, false, 'error: Server initializing, please try again']
						ws.send(JSON.stringify(errorResponse))
						return
					}

					if (!verifyEvent(data[1] as Event)) throw Error('Unable to verify event')

					const resignedEvent = getEventHandler().handleEvent(data[1])

					if (resignedEvent) {
						const relay = await Relay.connect(RELAY_URL as string)
						await relay.publish(resignedEvent as Event)

						// Update cached appSettings when a kind 31990 event is published
						if (resignedEvent.kind === 31990) {
							try {
								const parsed = AppSettingsSchema.parse(JSON.parse(resignedEvent.content))
								appSettings = parsed
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
	},
})

console.log(`🚀 Server running at ${server.url}`)
