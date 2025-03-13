import { serve } from 'bun'
import index from './index.html'
import { fetchAppSettings } from './lib/appSettings'
import { config } from 'dotenv'

config()

const RELAY_URL = process.env.APP_RELAY_URL
const APP_PUBLIC_KEY = process.env.APP_PUBLIC_KEY

if (!RELAY_URL || !APP_PUBLIC_KEY) {
	console.error('Missing required environment variables: APP_RELAY_URL, APP_PUBLIC_KEY')
	process.exit(1)
}

// Fetch app settings on server startup
let appSettings: Awaited<ReturnType<typeof fetchAppSettings>> = null

async function initializeAppSettings() {
	try {
		appSettings = await fetchAppSettings(RELAY_URL, APP_PUBLIC_KEY)
		if (!appSettings) {
			console.error('Failed to fetch app settings')
			process.exit(1)
		}
		console.log('App settings loaded successfully')
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
				}),
		},
	},

	development: process.env.NODE_ENV !== 'production',
})

console.log(`🚀 Server running at ${server.url}`)
