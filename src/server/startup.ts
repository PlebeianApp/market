import { getPublicKey } from 'nostr-tools/pure'
import { fetchAppSettings } from '../lib/appSettings'
import { getEventHandler } from './EventHandler'
import { APP_PRIVATE_KEY, RELAY_URL, setAppPublicKey, setAppSettings, setEventHandlerReady } from './runtime'

/**
 * Initialise process-level state required by every other server module.
 * Must run before `buildServer(...)` returns its `serve(...)` instance —
 * `getAppPublicKeyOrThrow()`, `getAppSettings()`, etc. all read from the
 * runtime singletons populated here.
 */
export async function initializeAppSettings(): Promise<void> {
	if (!RELAY_URL || !APP_PRIVATE_KEY) {
		console.error('Missing required environment variables: APP_RELAY_URL, APP_PRIVATE_KEY')
		process.exit(1)
	}

	try {
		const privateKeyBytes = new Uint8Array(Buffer.from(APP_PRIVATE_KEY, 'hex'))
		const publicKey = getPublicKey(privateKeyBytes)
		setAppPublicKey(publicKey)
		const settings = await fetchAppSettings(RELAY_URL as string, publicKey)
		setAppSettings(settings)
		if (settings) {
			console.log('App settings loaded successfully')
		} else {
			console.log('No app settings found - setup required')
		}
	} catch (error) {
		console.error('Failed to initialize app settings:', error)
		process.exit(1)
	}

	// Path-issuer functionality (kind-14 bid-token listener, registry
	// writes, etc.) used to live in this process. It now lives in the
	// ContextVM server (`contextvm/server.ts`) — see AUCTIONS.md §11.
	// The bun web server is a SPA + config + nip05 host; auction-issuer
	// concerns are entirely on the CVM side.
}

/**
 * Kick off the EventHandler initialisation in parallel with HTTP serving.
 * Core components are ready synchronously in the constructor; only relay-
 * dependent features (zap settings, blacklist sync) may be delayed. We mark
 * the handler ready after a short timeout regardless so setup forms work
 * even if relays are slow.
 */
export function startEventHandlerInitialization(): Promise<void> {
	const initPromise = getEventHandler()
		.initialize({
			appPrivateKey: APP_PRIVATE_KEY || '',
			adminPubkeys: [],
			relayUrl: RELAY_URL,
		})
		.then(() => {
			setEventHandlerReady(true)
			console.log('✅ EventHandler initialized successfully')
		})
		.catch((error) => {
			console.error('EventHandler initialization failed:', error)
			// Still mark as ready - core components are initialized, relay features may be degraded
			setEventHandlerReady(true)
		})

	// Setup-form fallback: mark ready after short delay since core
	// components are ready immediately. This allows setup events to be
	// processed even if relay connections are slow.
	setTimeout(() => {
		// `isEventHandlerReady` is captured by the closure inside runtime.ts;
		// once `setEventHandlerReady(true)` has been called from either path
		// this is a no-op.
		setEventHandlerReady(true)
	}, 2000)

	return initPromise
}
