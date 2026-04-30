import { getPublicKey } from 'nostr-tools/pure'
import { fetchAppSettings } from '../lib/appSettings'
import { startAuctionBidTokenListener } from './auction/bidTokenListener'
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

	// AUCTIONS.md §11: the path-issuer is expected to run a long-lived
	// listener for incoming kind-14 DMs. Failure here is non-fatal — the
	// settlement-time replay still validates everything before releasing
	// paths — but without it registry entries never advance to `locked`
	// in real time.
	try {
		await startAuctionBidTokenListener()
	} catch (error) {
		console.error('[auction] failed to start bid-token listener:', error)
	}
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
