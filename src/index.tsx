import { serve } from 'bun'
import index from './index.html'
import { fetchAppSettings } from './lib/appSettings'
import { config } from 'dotenv'
import { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'

config()

const RELAY_URL = process.env.APP_RELAY_URL
const APP_PRIVATE_KEY = process.env.APP_PRIVATE_KEY

if (!RELAY_URL || !APP_PRIVATE_KEY) {
	console.error('Missing required environment variables: APP_RELAY_URL, APP_PRIVATE_KEY')
	process.exit(1)
}

// Derive public key from private key
const signer = new NDKPrivateKeySigner(APP_PRIVATE_KEY)
let APP_PUBLIC_KEY: string

// Fetch app settings on server startup
let appSettings: Awaited<ReturnType<typeof fetchAppSettings>> = null

async function initializeAppSettings() {
	try {
		// Get public key
		await signer.blockUntilReady()
		const user = await signer.user()
		APP_PUBLIC_KEY = user.pubkey

		// Try to fetch app settings
		appSettings = await fetchAppSettings(RELAY_URL, APP_PUBLIC_KEY)
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

// Initialize app settings before starting the server
await initializeAppSettings()

const server = serve({
	routes: {
		// Serve index.html for all unmatched routes.
		'/*': index,

		'/api/config': {
			GET: () =>
				Response.json({
					appRelay: RELAY_URL,
					appSettings,
					appPublicKey: APP_PUBLIC_KEY,
					needsSetup: !appSettings,
				}),
		},
	},

	development: process.env.NODE_ENV !== 'production',
})

console.log(`🚀 Server running at ${server.url}`)
