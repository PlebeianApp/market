import { serve } from 'bun'
import { config } from 'dotenv'
import { Relay } from 'nostr-tools'
import { getPublicKey, verifyEvent, type Event } from 'nostr-tools/pure'
import NDK from '@nostr-dev-kit/ndk'
import { bech32 } from '@scure/base'
import index from './index.html'
import { fetchAppSettings } from './lib/appSettings'
import { getEventHandler } from './server'
import { join } from 'path'
import { file } from 'bun'

import.meta.hot.accept()

config()

const RELAY_URL = process.env.APP_RELAY_URL
const NIP46_RELAY_URL = process.env.NIP46_RELAY_URL || 'wss://relay.nsec.app'
const APP_PRIVATE_KEY = process.env.APP_PRIVATE_KEY

let appSettings: Awaited<ReturnType<typeof fetchAppSettings>> = null
let APP_PUBLIC_KEY: string

type VanityInvoiceRequestBody = {
	amountSats: number
	vanityName: string
	zapRequest: {
		pubkey: string
		sig?: string
		created_at?: number
		kind?: number
		content?: string
		tags: string[][]
	}
}

type LnurlPayData = {
	callback?: string
	maxSendable?: number
	minSendable?: number
	commentAllowed?: number
	allowsNostr?: boolean
	nostrPubkey?: string
	status?: 'ERROR'
	reason?: string
}

type LnurlInvoiceData = {
	pr?: string
	status?: 'ERROR'
	reason?: string
}

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
; (async () => await initializeAppSettings())()

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
		'/api/vanity/invoice': {
			POST: async (req) => {
				console.log('📨 /api/vanity/invoice request received')

				let body: VanityInvoiceRequestBody | null = null
				try {
					body = (await req.json()) as VanityInvoiceRequestBody
				} catch {
					return jsonError('Invalid JSON body', 400)
				}

				const amountSats = Number(body?.amountSats)
				const vanityName = String(body?.vanityName || '').toLowerCase()
				const zapRequest = body?.zapRequest

				if (!Number.isFinite(amountSats) || amountSats <= 0) {
					return jsonError('amountSats must be a positive number', 400)
				}
				if (!vanityName) {
					return jsonError('vanityName is required', 400)
				}
				if (!zapRequest || !Array.isArray(zapRequest.tags)) {
					return jsonError('zapRequest is required', 400)
				}
				if (!zapRequest.sig) {
					return jsonError('zapRequest must be signed', 400)
				}

				const hasTag = (k: string, v?: string) => zapRequest.tags.some((t) => t[0] === k && (v ? t[1] === v : true))
				if (!hasTag('L', 'vanity-register')) {
					return jsonError('zapRequest missing ["L","vanity-register"] tag', 400)
				}
				const appPubkey = getAppPublicKeyOrThrow()
				if (!hasTag('p', appPubkey)) {
					return jsonError('zapRequest must target app pubkey', 400)
				}

				const vanityTag = zapRequest.tags.find((t) => t[0] === 'vanity')?.[1]?.toLowerCase()
				if (vanityTag !== vanityName) {
					return jsonError('zapRequest vanity tag must match vanityName', 400)
				}

				const amountMsatsTag = zapRequest.tags.find((t) => t[0] === 'amount')?.[1]
				const amountMsats = amountMsatsTag ? Number(amountMsatsTag) : NaN
				if (!Number.isFinite(amountMsats) || amountMsats !== amountSats * 1000) {
					return jsonError('zapRequest amount must match amountSats', 400)
				}

				try {
					console.log('⚡ Creating vanity invoice:', { vanityName, amountSats })
					const lightningIdentifier = await getAppLightningIdentifier()
					const lnurlEndpoint = toLnurlpEndpoint(lightningIdentifier)

					const lnurlRes = await fetch(lnurlEndpoint, { headers: { accept: 'application/json' } })
					if (!lnurlRes.ok) {
						return jsonError(`Failed to fetch LNURL-pay data (${lnurlRes.status})`, 502)
					}

					const lnurlData = (await lnurlRes.json()) as LnurlPayData
					if (lnurlData.status === 'ERROR') {
						return jsonError(lnurlData.reason || 'LNURL-pay error', 502)
					}

					if (!lnurlData.callback) {
						return jsonError('LNURL-pay callback missing', 502)
					}
					if (!lnurlData.allowsNostr) {
						return jsonError('App Lightning address does not support Nostr zaps (allowsNostr=false)', 400)
					}

					const amountMsatsToSend = amountSats * 1000
					if (typeof lnurlData.minSendable === 'number' && amountMsatsToSend < lnurlData.minSendable) {
						return jsonError(`Amount below minimum (${Math.ceil(lnurlData.minSendable / 1000)} sats)`, 400)
					}
					if (typeof lnurlData.maxSendable === 'number' && amountMsatsToSend > lnurlData.maxSendable) {
						return jsonError(`Amount above maximum (${Math.floor(lnurlData.maxSendable / 1000)} sats)`, 400)
					}

					const callbackUrl = new URL(lnurlData.callback)
					callbackUrl.searchParams.set('amount', amountMsatsToSend.toString())
					callbackUrl.searchParams.set('nostr', JSON.stringify(zapRequest))
					if (lnurlData.commentAllowed && lnurlData.commentAllowed > 0) {
						callbackUrl.searchParams.set('comment', `Vanity URL: ${vanityName}`)
					}

					const invoiceRes = await fetch(callbackUrl.toString(), { headers: { accept: 'application/json' } })
					if (!invoiceRes.ok) {
						return jsonError(`Failed to fetch invoice (${invoiceRes.status})`, 502)
					}

					const invoiceData = (await invoiceRes.json()) as LnurlInvoiceData
					if (invoiceData.status === 'ERROR') {
						return jsonError(invoiceData.reason || 'Invoice error', 502)
					}

					if (!invoiceData.pr) {
						return jsonError('Invoice missing pr', 502)
					}

					console.log('✅ Vanity invoice created')
					return Response.json({ pr: invoiceData.pr })
				} catch (error) {
					console.error('Vanity invoice error:', error)
					return jsonError(error instanceof Error ? error.message : 'Failed to create invoice', 500)
				}
			},
		},
		'/images/:file': ({ params }) => serveStatic(`images/${params.file}`),
		'/logo.svg': () => serveStatic('images/logo.svg'),
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
