/**
 * Browser relay — a real nostr relay (SQLite-backed) running in a Web Worker.
 *
 * This module implements issue #1081: "Every Plebeian instance runs its own relay."
 * Uses @snort/worker-relay to run a full SQLite nostr relay inside a Web Worker,
 * keeping all relay I/O off the main thread.
 *
 * STATUS: NOT YET CONNECTED to the app. This is a standalone module that will be
 * wired in once the applesauce migration (Wave 0 #1075, Wave A1b #1068) provides
 * a real applesauce EventStore as the app's primary data layer.
 *
 * See: src/lib/cache/setup.ts for the wiring entry point.
 */

import { WorkerRelayInterface } from '@snort/worker-relay'
import type { NostrEvent } from 'nostr-tools'

// Vite worker imports — production uses the bundled worker, dev uses ESM
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — Vite ?worker import is handled at build time
import WorkerVite from '@snort/worker-relay/src/worker?worker'

let workerRelay: WorkerRelayInterface | null = null

/**
 * Initialize the browser relay (full SQLite relay in a Web Worker).
 *
 * This IS the "every instance runs its own relay" — a real nostr relay
 * backed by SQLite WASM, running off the main thread.
 *
 * Safe to call multiple times — returns the cached instance after first init.
 */
export async function initBrowserRelay(): Promise<WorkerRelayInterface> {
	if (workerRelay) return workerRelay

	workerRelay = new WorkerRelayInterface(workerScript())
	await workerRelay.init({
		databasePath: 'plebeian-cache.db',
		insertBatchSize: 500,
	})

	console.log('✅ Browser relay initialized (worker-relay + SQLite)')
	return workerRelay
}

/** Resolve the correct worker script for dev vs production */
function workerScript(): Worker | URL {
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore — import.meta.env is injected by Vite
	if (import.meta.env?.DEV) {
		return new URL('@snort/worker-relay/dist/esm/worker.mjs', import.meta.url)
	}
	return new WorkerVite()
}

/**
 * Create a cacheRequest function for applesauce loaders.
 *
 * Applesauce loaders call this BEFORE hitting network relays, giving
 * users instant reads from local storage.
 *
 * @example
 * const relay = await initBrowserRelay()
 * createEventLoaderForStore(eventStore, pool, {
 *   cacheRequest: createCacheRequest(relay),
 * })
 */
export function createCacheRequest(relay: WorkerRelayInterface) {
	let reqId = 0
	return function cacheRequest(filters: unknown[]): Promise<NostrEvent[]> {
		return relay.query(['REQ', `cache-${reqId++}`, ...filters])
	}
}

/**
 * Create a persist function for applesauce's persistEventsToCache.
 *
 * Every event entering the applesauce EventStore gets saved to the
 * browser relay automatically.
 *
 * @example
 * const relay = await initBrowserRelay()
 * persistEventsToCache(eventStore, createPersistFn(relay))
 */
export function createPersistFn(relay: WorkerRelayInterface) {
	return async function persist(events: NostrEvent[]): Promise<void> {
		await Promise.allSettled(events.map((event) => relay.event(event)))
	}
}

/**
 * Get relay stats for UI/diagnostics.
 * Returns total event count and per-kind breakdown.
 */
export async function getCacheStats(
	relay: WorkerRelayInterface,
): Promise<{ total_events: number; kinds?: Record<string, number> }> {
	const summary = await relay.summary()
	return summary as { total_events: number; kinds?: Record<string, number> }
}

/**
 * Clear the browser relay cache by re-initializing the database.
 */
export async function clearCache(relay: WorkerRelayInterface): Promise<void> {
	await relay.init({
		databasePath: 'plebeian-cache.db',
		insertBatchSize: 500,
	})
}

/** Check if the browser relay is available (browser environment only) */
export function isBrowserCacheAvailable(): boolean {
	return typeof window !== 'undefined'
}
