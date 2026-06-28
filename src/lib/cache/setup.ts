/**
 * Browser cache setup — wiring entry point.
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  ⚠️  STATUS: NOT YET CONNECTED TO THE APP                        ║
 * ║                                                                  ║
 * ║  This module is ready but NOT wired into app initialization.     ║
 * ║  Once Wave 0 (#1075) and Wave A1b (#1068) are merged and the    ║
 * ║  app uses an applesauce EventStore as its primary data layer,    ║
 * ║  call setupBrowserCache() during app initialization.             ║
 * ║                                                                  ║
 * ║  Until then, this is experimental code on branch:                ║
 * ║  experiment/browser-relay-applesauce                             ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * WHEN READY TO WIRE IN:
 *
 * In the applesauce setup module (created by Wave 0/A1b), after creating
 * the EventStore and RelayPool:
 *
 * ```typescript
 * import { setupBrowserCache } from '@/lib/cache/setup'
 *
 * const { eventStore, pool } = createApplesauceStores()
 *
 * // Wire in the browser relay
 * if (isBrowserCacheAvailable()) {
 *   await setupBrowserCache(eventStore, pool)
 * }
 * ```
 */

import type { EventStore } from 'applesauce-core'
import { persistEventsToCache } from 'applesauce-core/helpers'
import { createEventLoaderForStore } from 'applesauce-loaders/loaders'
import type { RelayPool } from 'applesauce-relay'

import { initBrowserRelay, createCacheRequest, createPersistFn, isBrowserCacheAvailable } from './browser-cache'
import { NegentropySyncManager } from './sync-manager'
import { requestPersistentStorage } from './persist'

export { isBrowserCacheAvailable }

/**
 * Wire the browser relay into the applesauce EventStore.
 *
 * This function:
 * 1. Initializes the worker relay (SQLite in a Web Worker)
 * 2. Wires cache-first loading (loaders check local cache before relays)
 * 3. Auto-persists all events entering the store
 * 4. Starts background negentropy sync
 * 5. Requests persistent storage to prevent eviction
 *
 * After calling this, every event that enters the EventStore (from relays
 * or user actions) is automatically cached locally. Subsequent reads hit
 * the local cache first, giving users instant load times.
 *
 * @param eventStore The applesauce EventStore
 * @param pool The applesauce RelayPool
 * @returns The sync manager instance (call .stop() to stop background sync)
 */
export async function setupBrowserCache(eventStore: EventStore, pool: RelayPool): Promise<NegentropySyncManager> {
	// 1. Initialize the browser relay
	const browserRelay = await initBrowserRelay()

	// 2. Wire cache-first loading
	//    Loaders check the browser relay BEFORE hitting network relays
	createEventLoaderForStore(eventStore, pool, {
		cacheRequest: createCacheRequest(browserRelay),
		lookupRelays: [
			'wss://market-agg.orangesync.tech', // Aggregator (negentropy-capable)
			'wss://relay.plebeian.market', // Main relay
		],
	})

	// 3. Auto-persist: every event entering the store → browser relay
	persistEventsToCache(eventStore, createPersistFn(browserRelay))

	// 4. Start background negentropy sync
	const syncManager = new NegentropySyncManager(pool)
	syncManager.start()

	// 5. Request persistent storage (prevents browser eviction)
	//    Non-blocking — browsers may require user gesture
	requestPersistentStorage().catch(() => {
		// Non-critical — cache works without persistence, just may be evicted
	})

	console.log('🎉 Browser relay fully wired into applesauce EventStore')

	return syncManager
}
