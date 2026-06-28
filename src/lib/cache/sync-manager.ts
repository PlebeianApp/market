/**
 * Negentropy sync manager — keeps the browser relay in sync with upstream relays.
 *
 * Uses applesauce-relay's built-in NIP-77 negentropy support for efficient
 * set-reconciliation sync. Negentropy only transfers event IDs and diffs,
 * not full event data, minimizing bandwidth usage.
 *
 * STATUS: NOT YET CONNECTED to the app. Will be wired in once the applesauce
 * EventStore is the primary data layer (after Wave 0/A1b merge).
 *
 * See: src/lib/cache/setup.ts
 */

import type { RelayPool } from 'applesauce-relay'
import type { Filter } from 'nostr-tools'

/**
 * Marketplace event kinds to sync via negentropy.
 * These are the Plebeian-relevant kinds from the codebase analysis.
 */
const SYNC_FILTERS: Filter[] = [
	{ kinds: [30402], limit: 5000 }, // NIP-99 marketplace listings (products)
	{ kinds: [30405], limit: 500 }, // Featured products
	{ kinds: [31990], limit: 100 }, // Handler info
	{ kinds: [30000], limit: 100 }, // App config (admins/editors)
	{ kinds: [30078], limit: 100 }, // App data (relay preferences)
	{ kinds: [0], limit: 5000 }, // User profiles
	{ kinds: [10002], limit: 200 }, // Relay lists (NIP-65)
	{ kinds: [10000], limit: 100 }, // Mute lists
]

/**
 * Upstream relays to sync from.
 * Order matters — we try the fast aggregator relay first.
 */
const SYNC_RELAYS = [
	'wss://market-agg.orangesync.tech', // strfry aggregator (negentropy-capable)
	'wss://relay.plebeian.market', // Khatru main relay
]

const SYNC_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
const INITIAL_SYNC_DELAY_MS = 3000 // 3 seconds after start

export interface SyncStats {
	relay: string
	eventsReceived: number
	supported: boolean
	error?: string
}

/**
 * Manages background negentropy sync from upstream relays.
 *
 * Uses applesauce-relay's native NIP-77 support:
 * - relay.getSupported() checks if NIP-77 is available
 * - relay.negentropy() performs the set-reconciliation handshake
 * - Events received via negentropy flow into the EventStore → browser relay
 *
 * @example
 * const manager = new NegentropySyncManager(pool)
 * manager.start()
 */
export class NegentropySyncManager {
	private syncTimer: ReturnType<typeof setInterval> | undefined
	private isSyncing = false
	private lastSyncResults: SyncStats[] = []
	private lastSyncTime: Date | null = null

	constructor(private pool: RelayPool) {}

	/**
	 * Start periodic background sync.
	 * - Initial sync after 3 seconds (lets the app settle)
	 * - Periodic sync every 5 minutes
	 */
	start(): void {
		// Initial sync after delay
		setTimeout(() => {
			this.syncAll().catch((err) => console.warn('Initial browser relay sync failed:', err))
		}, INITIAL_SYNC_DELAY_MS)

		// Periodic sync
		this.syncTimer = setInterval(() => {
			this.syncAll().catch((err) => console.warn('Periodic browser relay sync failed:', err))
		}, SYNC_INTERVAL_MS)

		console.log('🔄 Browser relay sync manager started')
	}

	/** Stop background sync */
	stop(): void {
		if (this.syncTimer) {
			clearInterval(this.syncTimer)
			this.syncTimer = undefined
		}
	}

	/** Force an immediate sync cycle */
	async syncNow(): Promise<void> {
		await this.syncAll()
	}

	/** Get the results of the last sync cycle */
	getLastSyncResults(): SyncStats[] {
		return this.lastSyncResults
	}

	/** Get the timestamp of the last sync */
	getLastSyncTime(): Date | null {
		return this.lastSyncTime
	}

	/**
	 * Sync from all configured upstream relays.
	 * Skips relays that don't support NIP-77 negentropy.
	 */
	private async syncAll(): Promise<void> {
		if (this.isSyncing) return
		this.isSyncing = true

		const results: SyncStats[] = []

		try {
			for (const relayUrl of SYNC_RELAYS) {
				const result = await this.syncFromRelay(relayUrl)
				results.push(result)
			}

			this.lastSyncResults = results
			this.lastSyncTime = new Date()

			const totalReceived = results.reduce((sum, r) => sum + r.eventsReceived, 0)
			console.log(`✅ Browser relay sync complete: +${totalReceived} events from ${results.length} relays`)
		} finally {
			this.isSyncing = false
		}
	}

	/**
	 * Sync from a single relay using NIP-77 negentropy.
	 *
	 * Uses applesauce-relay's built-in negentropy method.
	 * Checks relay capabilities first — gracefully skips non-NIP-77 relays.
	 */
	private async syncFromRelay(relayUrl: string): Promise<SyncStats> {
		const relay = this.pool.relay(relayUrl)
		const stat: SyncStats = {
			relay: relayUrl,
			eventsReceived: 0,
			supported: false,
		}

		try {
			// Check if relay supports NIP-77 negentropy
			const supported = await relay.getSupported()
			if (!supported?.includes(77)) {
				stat.supported = false
				stat.error = 'NIP-77 not supported'
				console.log(`⚠️ ${relayUrl} doesn't support negentropy, skipping`)
				return stat
			}

			stat.supported = true

			// Sync each filter group
			for (const filter of SYNC_FILTERS) {
				let received = 0

				try {
					await relay.negentropy(
						[], // Empty local set — we want everything the relay has
						filter,
						async (_have: string[], need: string[]) => {
							// 'have' = events we have that relay doesn't (could send to relay)
							// 'need' = event IDs the relay has that we don't
							// Events are fetched automatically and flow into the EventStore
							received += need.length
						},
					)
				} catch (filterErr) {
					console.warn(`⚠️ Negentropy failed for ${relayUrl} kind filter:`, filterErr)
				}
			}

			stat.eventsReceived = received
			console.log(`✅ Synced from ${relayUrl}: +${received} events (NIP-77 supported)`)
		} catch (err) {
			stat.error = err instanceof Error ? err.message : String(err)
			console.warn(`⚠️ Sync failed for ${relayUrl}:`, err)
		}

		return stat
	}
}
