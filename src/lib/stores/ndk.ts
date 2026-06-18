import { defaultRelaysUrls, ZAP_RELAYS, type Stage } from '@/lib/constants'
import { computeNdkConfig, resolveMainRelay, resolveZapRelays } from '@/lib/relay-policy'
import { fetchNwcWalletBalance, fetchUserNwcWallets } from '@/queries/wallet'
import { fetchUserRelayListWithPreferences } from '@/queries/relay-list'
import type { NDKFilter, NDKSigner, NDKSubscriptionOptions, NDKUser } from '@nostr-dev-kit/ndk'
import NDK, { NDKEvent, NDKKind, NDKRelaySet } from '@nostr-dev-kit/ndk'
import { Store } from '@tanstack/store'
import { configStore } from './config'
import { nip60Actions } from './nip60'
import { walletActions, walletStore, type Wallet } from './wallet'

/**
 * Connection health, derived from pool events + the watchdog.
 *  - `unknown`: pre-boot, NDK not initialized yet.
 *  - `connecting`: connect() in flight, no relay has fired `relay:connect` yet.
 *  - `connected`: at least one relay is currently connected.
 *  - `reconnecting`: we were connected, then dropped to zero, and the watchdog
 *    or NDK's own retry logic is trying to bring relays back.
 *  - `offline`: we've been at zero connected relays for long enough that we
 *    consider the connection severed (UI surface for the status pill).
 */
export type ConnectionHealth = 'unknown' | 'connecting' | 'connected' | 'reconnecting' | 'offline'

export interface NDKState {
	ndk: NDK | null
	zapNdk: NDK | null
	isConnecting: boolean
	isConnected: boolean
	isZapNdkConnected: boolean
	explicitRelayUrls: string[]
	writeRelayUrls: string[] // Relays we're allowed to write to (staging restriction)
	activeNwcWalletUri: string | null
	signer?: NDKSigner
	/** Last known connection health — updated by pool events + watchdog. */
	health: ConnectionHealth
	/** Number of relays the pool currently reports as connected. */
	connectedRelayCount: number
	/** Timestamp (ms) of the last watchdog health check, for debugging. */
	lastHealthCheckAt: number | null
}

const initialState: NDKState = {
	ndk: null,
	zapNdk: null,
	isConnecting: false,
	isConnected: false,
	isZapNdkConnected: false,
	explicitRelayUrls: [],
	writeRelayUrls: [],
	activeNwcWalletUri: null,
	signer: undefined,
	health: 'unknown',
	connectedRelayCount: 0,
	lastHealthCheckAt: null,
}

export const ndkStore = new Store<NDKState>(initialState)

// Connect-promise singletons — guard against re-entrant connect() calls
// during boot (config subscriber + watchdog + manual triggers could all
// race otherwise). The store's `isConnecting` flag mirrors this for
// callers that only need to read state; the module refs are how the
// in-flight promise itself is shared.
let connectPromise: Promise<void> | null = null
let connectZapPromise: Promise<void> | null = null

// Watchdog singletons. Kept at module level so `startConnectionWatchdog`
// is idempotent (boot orchestrator + tests can call it without piling up
// duplicate intervals/listeners). The pool-event listeners run alongside
// the periodic check — events catch state changes immediately, the
// interval is the safety net for missed events or stuck reconnects.
let watchdogInterval: ReturnType<typeof setInterval> | null = null
let watchdogVisibilityHandler: (() => void) | null = null
let watchdogPoolListeners: Array<() => void> = []
/** Timestamp (ms) of the last moment we observed zero connected relays. */
let firstSawZeroConnectedAt: number | null = null

/** Interval between watchdog health checks (ms). */
const WATCHDOG_INTERVAL_MS = 30_000
/**
 * How long the pool can sit at 0 connected relays before we declare the
 * connection offline. NDK's own per-relay retry runs faster than this, so
 * a brief blip won't flip us into `offline` — only a sustained outage.
 */
const WATCHDOG_OFFLINE_THRESHOLD_MS = 15_000

/**
 * Helper to connect an NDK instance with timeout.
 * Returns true if at least one relay connected.
 *
 * If `ndk.connect()` doesn't resolve within `timeoutMs` we still count
 * the call a success when any relay actually came up — partial-connect
 * is the normal happy path on a slow network. We only warn when zero
 * relays connected, and we never dump the timeout Error's stack trace
 * (it's expected, not a bug).
 */
async function connectNdkWithTimeout(ndk: NDK, timeoutMs: number, label: string): Promise<boolean> {
	let timedOut = false
	try {
		await Promise.race([
			ndk.connect(),
			new Promise<never>((_, reject) =>
				setTimeout(() => {
					timedOut = true
					reject(new Error(`${label} connection timeout`))
				}, timeoutMs),
			),
		])
		return true
	} catch (error) {
		let connectedCount = 0
		try {
			connectedCount = ndk.pool?.connectedRelays().length ?? 0
		} catch {
			// Ignore pool access errors — we'll fall through to the
			// connected-zero branch below.
		}

		if (connectedCount > 0) {
			// At least one relay made it. Treat as success and log
			// informationally — no stack trace, no "warn" prefix.
			if (timedOut) {
				console.log(`✅ ${label} partially connected to ${connectedCount} relays (slow handshake)`)
			} else {
				console.log(`✅ ${label} connected to ${connectedCount} relays (with non-fatal errors)`)
			}
			return true
		}

		const message = error instanceof Error ? error.message : String(error)
		console.warn(`${label} connection failed: ${message}`)
		return false
	}
}

/**
 * Read the current stage from the loaded config. Returns `undefined`
 * when config hasn't loaded yet — callers should treat that as
 * "boot incomplete" rather than defaulting to a stage. Boot
 * orchestrator (`src/lib/boot.ts`) gates NDK initialization on
 * config being loaded, so during normal flow this only returns
 * `undefined` at the very start of app startup.
 */
function getCurrentStage(): Stage | undefined {
	if (!configStore.state.isLoaded) return undefined
	return configStore.state.config.stage || 'development'
}

/** Re-exports for backwards compatibility — actual logic lives in `lib/relay-policy.ts`. */
export function getMainRelay(): string | undefined {
	return resolveMainRelay(getCurrentStage(), configStore.state.config.appRelay)
}

/**
 * Get the write relay(s) for the current stage. Thin wrapper around
 * `computeNdkConfig` for callers that only need the write set.
 * Staging/development → main relay only; production → all connected.
 */
export function getWriteRelays(): string[] {
	const stage = getCurrentStage()
	if (stage === 'staging' || stage === 'development') {
		const mainRelay = getMainRelay()
		return mainRelay ? [mainRelay] : []
	}
	return ndkStore.state.explicitRelayUrls
}

/**
 * Get an NDKRelaySet configured for write operations.
 * Staging: only the main relay
 * Development: only the main relay (prevents leaking to public relays)
 * Production: undefined (NDK default = all connected relays)
 */
export function getWriteRelaySet(): NDKRelaySet | undefined {
	const ndk = ndkStore.state.ndk
	if (!ndk) return undefined

	const stage = getCurrentStage()
	if (stage === 'staging') {
		const writeRelays = getWriteRelays()
		console.log(`📝 Staging mode: restricting writes to ${writeRelays.join(', ')}`)
		return NDKRelaySet.fromRelayUrls(writeRelays, ndk)
	}
	if (stage === 'development') {
		const writeRelays = getWriteRelays()
		console.log(`📝 Development mode: restricting writes to ${writeRelays.join(', ')}`)
		return NDKRelaySet.fromRelayUrls(writeRelays, ndk)
	}

	// Production: return undefined to use default behavior (all relays)
	return undefined
}

/**
 * Get an NDKRelaySet pinned to ONLY the app's main relay.
 * Use for reads of app-config events (kind 31990 handler info, kind 30000 d=admins/editors,
 * kind 10000 mute list, NIP-51 featured lists). Prevents stale copies on user-added
 * NIP-65 relays or public relays from racing the canonical answer.
 *
 * Returns undefined if NDK or the app relay isn't ready yet — callers should treat
 * that as "config not available yet" rather than falling back to all relays.
 */
export function getAppRelaySet(): NDKRelaySet | undefined {
	const ndk = ndkStore.state.ndk
	const mainRelay = getMainRelay()
	if (!ndk || !mainRelay) return undefined
	return NDKRelaySet.fromRelayUrls([mainRelay], ndk)
}

/**
 * Filter shape accepted by fetchLatestAppEvent. Kinds is widened to plain number[]
 * so call sites can use literal kinds (e.g. NIP-99 30402, featured-products 30405)
 * that aren't members of NDK's NDKKind enum.
 */
export type AppEventFilter = Omit<NDKFilter, 'kinds'> & { kinds?: number[] }

/**
 * Fetch the latest event (highest created_at) matching the filter from the app relay only.
 * Returns null if NDK isn't ready, the app relay isn't known yet, or no event was found.
 */
export async function fetchLatestAppEvent(filter: AppEventFilter): Promise<NDKEvent | null> {
	const ndk = ndkStore.state.ndk
	const relaySet = getAppRelaySet()
	if (!ndk || !relaySet) return null
	const events = await ndk.fetchEvents(filter as NDKFilter, undefined, relaySet)
	const arr = Array.from(events)
	if (arr.length === 0) return null
	return arr.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
}

/**
 * Bun runtime sniff used by the Node-only `LOCAL_RELAY_ONLY` flag.
 * Kept inside the store rather than the pure policy module so the
 * policy stays free of runtime-detection side effects.
 */
function isBunLocalRelayOnly(): boolean {
	// @ts-ignore - Bun.env is available in Bun runtime
	return typeof Bun !== 'undefined' && Bun.env?.LOCAL_RELAY_ONLY === 'true'
}

/**
 * Read the current pool state and reconcile `health` /
 * `connectedRelayCount` on the store. Called from pool events + the
 * watchdog tick + visibilitychange. Idempotent — only writes when the
 * derived health actually changes.
 */
function updateHealthFromPool(): void {
	const state = ndkStore.state
	const ndk = state.ndk
	if (!ndk) return

	let connectedCount = 0
	try {
		connectedCount = ndk.pool?.connectedRelays().length ?? 0
	} catch {
		connectedCount = 0
	}

	const now = Date.now()

	// Track the moment we first observed zero connected relays. Cleared
	// the instant we see at least one again. The "did we drop?" decision
	// in `maybeKickReconnect` reads this.
	if (connectedCount === 0) {
		if (firstSawZeroConnectedAt === null) firstSawZeroConnectedAt = now
	} else {
		firstSawZeroConnectedAt = null
	}

	let nextHealth: ConnectionHealth = state.health
	if (connectedCount > 0) {
		nextHealth = 'connected'
	} else if (state.isConnecting || state.health === 'unknown') {
		nextHealth = 'connecting'
	} else if (state.health === 'connected' || state.health === 'connecting') {
		nextHealth = 'reconnecting'
	} else if (
		state.health === 'reconnecting' &&
		firstSawZeroConnectedAt !== null &&
		now - firstSawZeroConnectedAt >= WATCHDOG_OFFLINE_THRESHOLD_MS
	) {
		nextHealth = 'offline'
	}

	if (nextHealth === state.health && connectedCount === state.connectedRelayCount && state.lastHealthCheckAt !== null) {
		// No change; skip the setState to avoid waking subscribers.
		return
	}

	ndkStore.setState((s) => ({
		...s,
		health: nextHealth,
		connectedRelayCount: connectedCount,
		lastHealthCheckAt: now,
		isConnected: connectedCount > 0,
	}))
}

/**
 * Kick `ndk.connect()` again if the pool has been at zero connected
 * relays past the offline threshold. Called from the watchdog tick and
 * the visibility handler.
 *
 * We don't kick on every zero observation — NDKRelay has its own retry
 * backoff and we'd just pile on. The threshold gives the built-in retry
 * a chance to recover first.
 */
function maybeKickReconnect(source: 'interval' | 'visibilitychange'): void {
	const state = ndkStore.state
	const ndk = state.ndk
	if (!ndk) return
	if (state.isConnecting) return // connect() already in flight

	const zeroFor = firstSawZeroConnectedAt === null ? 0 : Date.now() - firstSawZeroConnectedAt

	// `visibilitychange` is special: when the tab comes back into focus
	// and we're not connected, kick immediately — browser throttling may
	// have killed the WS handshake mid-retry while we were backgrounded.
	const shouldKick = state.connectedRelayCount === 0 && (source === 'visibilitychange' || zeroFor >= WATCHDOG_OFFLINE_THRESHOLD_MS)
	if (!shouldKick) return

	console.warn(`[watchdog] No connected relays (${Math.round(zeroFor / 1000)}s, source=${source}); kicking reconnect`)
	void ndkActions.connect().catch((err) => {
		console.warn('[watchdog] Reconnect kick failed:', err)
	})
}

export const ndkActions = {
	/**
	 * Idempotent helper that adds `config.appRelay` to NDK if not
	 * already present. Used by the boot orchestrator after config
	 * loads, and as a manual hook for callers that change the app
	 * relay at runtime (e.g. admin tools). `addSingleRelay` already
	 * dedupes against `explicitRelayUrls` so calling this repeatedly
	 * is safe.
	 */
	ensureAppRelayFromConfig: (): void => {
		const appRelay = configStore.state.config.appRelay
		if (!appRelay) return
		ndkActions.addSingleRelay(appRelay)
	},

	/**
	 * Fetch events, but guarantee resolution even if some relays never EOSE.
	 * This prevents UI loading states from hanging indefinitely.
	 */
	fetchEventsWithTimeout: async (
		filters: NDKFilter | NDKFilter[],
		opts?: NDKSubscriptionOptions & { timeoutMs?: number },
	): Promise<Set<NDKEvent>> => {
		const ndk = ndkStore.state.ndk
		if (!ndk) throw new Error('NDK not initialized')

		const { timeoutMs = 8000, ...subOpts } = opts ?? {}

		return await new Promise<Set<NDKEvent>>((resolve) => {
			const events = new Map<string, NDKEvent>()
			let settled = false
			let timer: ReturnType<typeof setTimeout> | undefined

			const finalize = (subscription?: { stop: () => void }) => {
				if (settled) return
				settled = true
				if (timer) clearTimeout(timer)
				subscription?.stop()
				resolve(new Set(events.values()))
			}

			const subscription = ndk.subscribe(filters, {
				...subOpts,
				closeOnEose: true,
				onEvent: (event) => {
					const key = event.deduplicationKey()
					const existing = events.get(key)
					if (!existing) {
						events.set(key, event)
						return
					}
					const existingCreatedAt = existing.created_at || 0
					const nextCreatedAt = event.created_at || 0
					if (nextCreatedAt >= existingCreatedAt) {
						events.set(key, event)
					}
				},
				onEose: () => finalize(subscription),
				onClose: () => finalize(subscription),
			})

			timer = setTimeout(() => finalize(subscription), timeoutMs)
		})
	},

	/**
	 * Construct the two NDK instances (main + zap) and stash them in
	 * the store. Idempotent — returns the existing instance if already
	 * initialized.
	 *
	 * Boot orchestrator (`src/lib/boot.ts`) calls this exactly once
	 * AFTER the /api/config fetch has resolved, so we're guaranteed
	 * to see the real stage. The earlier defensive plumbing
	 * (`ensureAppRelayFromConfig`, the module-level
	 * `configRelaySyncInitialized` subscription) is gone — the boot
	 * orchestrator is responsible for ordering, and live
	 * config-change handling moves to a single explicit subscription
	 * registered there.
	 */
	initialize: (relays?: string[]) => {
		if (ndkStore.state.ndk) return ndkStore.state.ndk

		const stage = getCurrentStage()
		const { explicitRelayUrls, writeRelayUrls, enableOutbox } = computeNdkConfig({
			stage,
			appRelay: configStore.state.config.appRelay,
			overrideRelays: relays,
			localRelayOnly: isBunLocalRelayOnly(),
		})

		const ndk = new NDK({
			explicitRelayUrls,
			enableOutboxModel: enableOutbox,
			aiGuardrails: {
				skip: new Set(['ndk-no-cache', 'fetch-events-usage']),
			},
		})

		// Zap NDK monitors zap receipts on public relays — LSPs broadcast
		// receipts to their own pools, not the app relay. Always uses the
		// union of ZAP_RELAYS + the main read set.
		const zapNdk = new NDK({ explicitRelayUrls: resolveZapRelays(explicitRelayUrls) })

		ndkStore.setState((s) => ({ ...s, ndk, zapNdk, explicitRelayUrls, writeRelayUrls }))

		return ndk
	},

	/**
	 * Connect NDK to relays (non-blocking, runs in background)
	 */
	connect: async (timeoutMs = 10000): Promise<void> => {
		const state = ndkStore.state
		if (!state.ndk) return
		if (state.isConnected) return
		if (state.isConnecting) {
			if (connectPromise) return await connectPromise
			return
		}

		connectPromise = (async () => {
			ndkStore.setState((s) => ({
				...s,
				isConnecting: true,
				// Only flip health to 'connecting' from a non-connected state —
				// if we're already connected and a reconnect kick fires, we
				// don't want the UI flickering to "connecting" on a healthy pool.
				health: s.health === 'connected' ? s.health : 'connecting',
			}))

			try {
				const connected = await connectNdkWithTimeout(state.ndk!, timeoutMs, 'NDK')
				ndkStore.setState((s) => ({ ...s, isConnected: connected }))
				if (connected) console.log('✅ NDK connected to relays')

				// Also connect zap NDK in background (if available - skipped in local-relay-only mode)
				if (state.zapNdk) {
					void ndkActions.connectZapNdk(5000)
				}
			} finally {
				ndkStore.setState((s) => ({ ...s, isConnecting: false }))
				connectPromise = null
			}
		})()

		return await connectPromise
	},

	/**
	 * Connect the dedicated zap monitoring NDK
	 */
	connectZapNdk: async (timeoutMs = 10000): Promise<void> => {
		const state = ndkStore.state
		if (!state.zapNdk) return
		if (state.isZapNdkConnected) return
		if (connectZapPromise) return await connectZapPromise

		connectZapPromise = (async () => {
			const connected = await connectNdkWithTimeout(state.zapNdk!, timeoutMs, 'Zap NDK')
			ndkStore.setState((s) => ({ ...s, isZapNdkConnected: connected }))

			if (connected) {
				console.log('✅ Zap NDK connected to relays:', ZAP_RELAYS)
			} else {
				console.warn('⚠️ Zap NDK could not connect. Zap monitoring will be unavailable.')
			}
		})().finally(() => {
			connectZapPromise = null
		})

		return await connectZapPromise
	},

	/**
	 * Start the connection watchdog: pool-event listeners + a periodic
	 * health check + a `visibilitychange` handler that kicks reconnects
	 * when the tab comes back into focus.
	 *
	 * Why this exists:
	 *   - NDKRelay has its own per-relay reconnect logic, but in
	 *     practice we still see all relays sitting in CLOSED/CLOSING
	 *     after a network blip — especially after a tab has been
	 *     backgrounded and the browser throttled the WS connections
	 *     into oblivion. The user has to reload to recover.
	 *   - Pool events (`relay:connect` / `relay:disconnect`) give us
	 *     fast feedback for the status pill in the nav.
	 *   - The 30s tick is a safety net for missed events or stuck
	 *     reconnects: if no relays are connected and that state has
	 *     persisted past WATCHDOG_OFFLINE_THRESHOLD_MS, we declare
	 *     `offline` and call `ndk.connect()` again to kick the pool.
	 *   - `visibilitychange` fires the same kick immediately on focus
	 *     so the user doesn't sit on a stale screen waiting for the
	 *     next tick.
	 *
	 * Idempotent: re-calling has no effect (boot orchestrator + manual
	 * triggers in tests can both call it without piling up handlers).
	 */
	startConnectionWatchdog: (): void => {
		if (watchdogInterval !== null) return

		const ndk = ndkStore.state.ndk
		if (!ndk) {
			console.warn('[watchdog] NDK not initialized; skipping watchdog start')
			return
		}

		// Pool events — drive the live count + health updates.
		const onRelayConnect = () => updateHealthFromPool()
		const onRelayDisconnect = () => updateHealthFromPool()
		const onPoolConnect = () => updateHealthFromPool()

		ndk.pool.on('relay:connect', onRelayConnect)
		ndk.pool.on('relay:disconnect', onRelayDisconnect)
		ndk.pool.on('connect', onPoolConnect)

		watchdogPoolListeners = [
			() => ndk.pool.off('relay:connect', onRelayConnect),
			() => ndk.pool.off('relay:disconnect', onRelayDisconnect),
			() => ndk.pool.off('connect', onPoolConnect),
		]

		// Initial reading so the store reflects the pool's current state
		// instead of staying on `unknown` until the first event fires.
		updateHealthFromPool()

		// Periodic tick — safety net + offline-detection.
		watchdogInterval = setInterval(() => {
			updateHealthFromPool()
			maybeKickReconnect('interval')
		}, WATCHDOG_INTERVAL_MS)

		// Visibility change — browsers throttle (or fully suspend) WS
		// reconnect attempts in background tabs. When the tab comes back
		// we want an immediate health check + kick, not a 30s wait.
		if (typeof document !== 'undefined') {
			watchdogVisibilityHandler = () => {
				if (document.visibilityState === 'visible') {
					updateHealthFromPool()
					maybeKickReconnect('visibilitychange')
				}
			}
			document.addEventListener('visibilitychange', watchdogVisibilityHandler)
		}

		console.log('[watchdog] Connection watchdog started')
	},

	/**
	 * Stop the watchdog and remove all listeners. Mainly for tests + HMR
	 * — production has no path that needs to stop the watchdog once
	 * started.
	 */
	stopConnectionWatchdog: (): void => {
		if (watchdogInterval !== null) {
			clearInterval(watchdogInterval)
			watchdogInterval = null
		}
		if (watchdogVisibilityHandler && typeof document !== 'undefined') {
			document.removeEventListener('visibilitychange', watchdogVisibilityHandler)
			watchdogVisibilityHandler = null
		}
		for (const off of watchdogPoolListeners) off()
		watchdogPoolListeners = []
		firstSawZeroConnectedAt = null
	},

	addExplicitRelay: (relayUrls: string[]): string[] => {
		const state = ndkStore.state
		if (!state.ndk) return []

		relayUrls.forEach((relayUrl) => {
			state.ndk!.addExplicitRelay(relayUrl)
		})

		const updatedUrls = Array.from(new Set([...state.explicitRelayUrls, ...relayUrls]))
		ndkStore.setState((state) => ({ ...state, explicitRelayUrls: updatedUrls }))
		return updatedUrls
	},

	addSingleRelay: (relayUrl: string): boolean => {
		const state = ndkStore.state
		if (!state.ndk) return false

		try {
			// Normalize the URL (add wss:// if missing)
			const normalizedUrl = relayUrl.startsWith('ws://') || relayUrl.startsWith('wss://') ? relayUrl : `wss://${relayUrl}`

			// Already present?
			if (state.explicitRelayUrls.includes(normalizedUrl)) return true

			state.ndk.addExplicitRelay(normalizedUrl)

			const updatedUrls = Array.from(new Set([...state.explicitRelayUrls, normalizedUrl]))
			ndkStore.setState((state) => ({ ...state, explicitRelayUrls: updatedUrls }))
			return true
		} catch (error) {
			console.error('Failed to add relay:', error)
			return false
		}
	},

	removeRelay: (relayUrl: string): boolean => {
		const state = ndkStore.state
		if (!state.ndk) return false

		try {
			// Remove from NDK pool
			const relay = state.ndk.pool.relays.get(relayUrl)
			if (relay) {
				state.ndk.pool.removeRelay(relayUrl)
			}

			// Update state
			const updatedUrls = state.explicitRelayUrls.filter((url) => url !== relayUrl)
			ndkStore.setState((state) => ({ ...state, explicitRelayUrls: updatedUrls }))
			return true
		} catch (error) {
			console.error('Failed to remove relay:', error)
			return false
		}
	},

	getRelays: () => {
		const state = ndkStore.state
		if (!state.ndk) return { explicit: [], outbox: [] }

		return {
			explicit: Array.from(state.ndk.pool.relays.values()),
			outbox: state.ndk.outboxPool ? Array.from(state.ndk.outboxPool.relays.values()) : [],
		}
	},

	connectToDefaultRelays: (): boolean => {
		try {
			ndkActions.addExplicitRelay(defaultRelaysUrls)
			return true
		} catch (error) {
			console.error('Failed to connect to default relays:', error)
			return false
		}
	},

	/**
	 * Assign the signer to both NDK instances and the store. NO side
	 * effects beyond the assignment — for the downstream "user is
	 * signed in" pipeline (relay-list load, NWC selection, NIP-60
	 * wallet bootstrap, etc.) the auth flow calls
	 * `runSignerOnboarding(signer)` explicitly. Decoupling those steps
	 * keeps `setSigner` readable and the auth flow's effects visible
	 * at the call site instead of buried inside a setter.
	 */
	setSigner: (signer: NDKSigner | undefined): void => {
		// Lazy-init NDK if a signer arrives before boot finished —
		// happens in tests and in re-login flows after a logout. Safe
		// because `initialize()` is idempotent.
		if (!ndkStore.state.ndk) {
			console.warn('Attempted to set signer before NDK was initialized. Initializing NDK now.')
			ndkActions.initialize()
			if (!ndkStore.state.ndk) {
				console.error('NDK initialization failed. Cannot set signer.')
				return
			}
		}

		const state = ndkStore.state
		if (state.ndk) state.ndk.signer = signer
		if (state.zapNdk) state.zapNdk.signer = signer
		ndkStore.setState((s) => ({ ...s, signer }))
	},

	/**
	 * Post-signer pipeline: load the user's NIP-65 relay list, select
	 * the best NWC wallet by balance, and bootstrap the NIP-60 Cashu
	 * wallet. The three are run concurrently — they only share `user`
	 * (derived once up front) and don't observe each other.
	 *
	 * The auth flow MUST call this after `setSigner(s)` for a fresh
	 * login. Logout calls `clearSignerOnboarding()` instead.
	 */
	runSignerOnboarding: async (signer: NDKSigner): Promise<void> => {
		let user: NDKUser | null = null
		try {
			user = await signer.user()
		} catch (error) {
			console.error('[ndk] Failed to resolve user from signer; skipping onboarding pipeline:', error)
			return
		}
		if (!user?.pubkey) {
			console.warn('[ndk] Signer returned no pubkey; skipping onboarding pipeline')
			return
		}

		// Run in parallel — each step handles its own failure (caller
		// just sees a warning) so a failed NWC lookup doesn't block
		// NIP-60 init and vice versa.
		const userPubkey = user.pubkey
		await Promise.all([
			ndkActions.loadRelaysFromNostr().catch((e) => console.error('[ndk] loadRelaysFromNostr failed:', e)),
			ndkActions.selectAndSetInitialNwcWallet().catch((e) => console.error('[ndk] selectAndSetInitialNwcWallet failed:', e)),
			(async () => {
				try {
					await nip60Actions.initialize(userPubkey)
				} catch (e) {
					console.error('[ndk] nip60Actions.initialize failed:', e)
				}
			})(),
		])
	},

	/**
	 * Tear-down counterpart to `runSignerOnboarding`. Auth logout calls
	 * this after `setSigner(undefined)` so the store doesn't carry
	 * stale NWC / NIP-60 state into the unauthenticated session.
	 */
	clearSignerOnboarding: (): void => {
		ndkActions.setActiveNwcWalletUri(null)
		nip60Actions.reset()
	},

	/**
	 * Load user's relay list from Nostr (kind 10002)
	 * This enables the outbox model to work properly by adding user's preferred relays
	 */
	loadRelaysFromNostr: async (): Promise<void> => {
		const ndk = ndkStore.state.ndk
		if (!ndk || !ndk.signer) {
			console.warn('NDK or signer not available for loading relays')
			return
		}

		let user: NDKUser | null = null
		try {
			user = await ndk.signer.user()
		} catch (e) {
			console.error('Error getting user from signer:', e)
			return
		}

		if (!user || !user.pubkey) {
			console.warn('User or user pubkey not available from signer')
			return
		}

		try {
			const relayPrefs = await fetchUserRelayListWithPreferences(user.pubkey)
			if (relayPrefs && relayPrefs.length > 0) {
				console.log(`📡 Loading ${relayPrefs.length} relays from user's Nostr relay list`)
				for (const relay of relayPrefs) {
					ndkActions.addSingleRelay(relay.url)
				}
			} else {
				console.log('📡 No relay list found on Nostr for user')
			}
		} catch (error) {
			console.error('Failed to load relays from Nostr:', error)
		}
	},

	removeSigner: () => {
		ndkActions.setSigner(undefined)
	},

	setActiveNwcWalletUri: (uri: string | null) => {
		ndkStore.setState((state) => ({ ...state, activeNwcWalletUri: uri }))
	},

	selectAndSetInitialNwcWallet: async () => {
		const ndk = ndkStore.state.ndk
		if (!ndk || !ndk.signer) {
			console.warn('NDK or signer not available for NWC wallet selection.')
			return
		}

		let user: NDKUser | null = null
		try {
			user = await ndk.signer.user()
		} catch (e) {
			console.error('Error getting user from signer:', e)
			return
		}

		if (!user || !user.pubkey) {
			console.warn('User or user pubkey not available from signer.')
			return
		}

		const userPubkey = user.pubkey

		// Set loading state for wallet operations
		walletStore.setState((state) => ({ ...state, isLoading: true }))

		await walletActions.initialize()

		try {
			const nostrWallets = await fetchUserNwcWallets(userPubkey)
			if (nostrWallets && nostrWallets.length > 0) {
				walletActions.setNostrWallets(nostrWallets as Wallet[])
			}
		} catch (error) {
			console.error('Failed to fetch or merge Nostr NWC wallets during initial setup:', error)
		}

		const allWallets = walletActions.getWallets()

		if (allWallets.length === 0) {
			ndkActions.setActiveNwcWalletUri(null)
			// Clear loading state when done
			walletStore.setState((state) => ({ ...state, isLoading: false }))
			return
		}

		let highestBalance = -1
		let bestWallet: Wallet | null = null

		const balancePromises = allWallets
			.filter((wallet) => wallet.nwcUri)
			.map(async (wallet) => {
				try {
					const balanceInfo = await fetchNwcWalletBalance(wallet.nwcUri)
					const currentBalance = balanceInfo?.balance ?? -1
					return { ...wallet, balance: currentBalance }
				} catch (error) {
					console.error(`Failed to fetch balance for wallet ${wallet.name} (ID: ${wallet.id}):`, error)
					return { ...wallet, balance: -1 }
				}
			})

		const walletsWithBalances = await Promise.all(balancePromises)

		for (const wallet of walletsWithBalances) {
			if (wallet.balance > highestBalance) {
				highestBalance = wallet.balance
				bestWallet = wallet
			}
		}

		if (bestWallet && bestWallet.nwcUri) {
			ndkActions.setActiveNwcWalletUri(bestWallet.nwcUri)
		} else {
			ndkActions.setActiveNwcWalletUri(null)
		}

		// Clear loading state when done
		walletStore.setState((state) => ({ ...state, isLoading: false }))
	},

	getNDK: () => {
		return ndkStore.state.ndk
	},

	getZapNdk: () => {
		return ndkStore.state.zapNdk
	},

	getUser: async (): Promise<NDKUser | null> => {
		const state = ndkStore.state
		if (!state.ndk || !state.ndk.signer) return null
		try {
			return await state.ndk.signer.user()
		} catch (e) {
			console.error('Error fetching user from signer in getUser:', e)
			return null
		}
	},

	getSigner: () => {
		return ndkStore.state.ndk?.signer
	},

	/**
	 * Publish an event respecting the current stage's write restrictions.
	 * In staging, events are only published to the staging relay.
	 * In production/development, events are published to all connected relays.
	 *
	 * @param event The NDKEvent to publish (must already be signed)
	 * @returns Promise resolving to the set of relays the event was published to
	 */
	publishEvent: async (event: NDKEvent): Promise<Set<any>> => {
		const relaySet = getWriteRelaySet()
		return event.publish(relaySet)
	},

	/**
	 * Creates a zap receipt subscription for monitoring zap payments
	 * @param onZapEvent Callback function to handle zap events
	 * @param bolt11 Optional specific invoice to monitor
	 * @returns Cleanup function to stop the subscription
	 */
	createZapReceiptSubscription: (onZapEvent: (event: NDKEvent) => void, bolt11?: string): (() => void) => {
		const state = ndkStore.state
		if (!state.zapNdk || !state.isZapNdkConnected) {
			console.warn('Zap NDK not connected. Cannot create zap subscription.')
			return () => {}
		}

		const filters: any = {
			kinds: [NDKKind.Zap],
			since: Math.floor(Date.now() / 1000) - 60, // Look back 1 minute for recent zaps
		}

		const subscription = state.zapNdk.subscribe(filters, { closeOnEose: false })

		subscription.on('event', (event: NDKEvent) => {
			// If we're monitoring a specific invoice, filter by bolt11
			if (bolt11) {
				const eventBolt11 = event.tagValue('bolt11')
				if (eventBolt11 === bolt11) {
					onZapEvent(event)
				}
			} else {
				// No specific invoice filter, pass all zaps
				onZapEvent(event)
			}
		})

		subscription.start()

		console.log('🔔 Started zap receipt subscription', bolt11 ? `for invoice: ${bolt11.substring(0, 20)}...` : '(all zaps)')

		return () => {
			subscription.stop()
			console.log('🔕 Stopped zap receipt subscription')
		}
	},

	/**
	 * Monitors a specific lightning invoice for zap receipts
	 * @param bolt11 Lightning invoice to monitor
	 * @param onZapReceived Callback when zap is detected (receives eventId and optional receipt preimage)
	 * @param timeoutMs Optional timeout in milliseconds (default: 30 seconds)
	 * @param onTimeout Optional callback when timeout is reached without receiving a zap receipt
	 * @returns Cleanup function
	 */
	monitorZapPayment: (
		bolt11: string,
		onZapReceived: (receipt: { eventId: string; receiptPreimage?: string }) => void,
		timeoutMs: number = 30000,
		onTimeout?: () => void,
	): (() => void) => {
		console.log('👀 Starting zap payment monitoring for invoice:', bolt11.substring(0, 20) + '...')

		let hasReceivedZap = false
		const cleanupFunctions: Array<() => void> = []

		// Create zap subscription
		const stopSubscription = ndkActions.createZapReceiptSubscription((event: NDKEvent) => {
			const eventBolt11 = event.tagValue('bolt11')
			if (eventBolt11 === bolt11 && !hasReceivedZap) {
				hasReceivedZap = true

				// Try to extract preimage from zap receipt per NIP-57
				// The preimage tag is optional (MAY contain), so we need fallbacks
				const receiptPreimage = event.tagValue('preimage')

				// Log all available tags for debugging
				console.log('📋 Zap receipt tags:', {
					bolt11: eventBolt11?.substring(0, 30) + '...',
					receiptPreimage: receiptPreimage || 'not included',
					eventId: event.id,
					pubkey: event.pubkey.substring(0, 16) + '...',
					allTags: event.tags.map((t) => t[0]),
				})

				console.log('⚡ Zap receipt detected!', {
					preimageSource: receiptPreimage ? 'receipt' : 'event-id',
					receiptPreimage: receiptPreimage ? receiptPreimage.substring(0, 30) + '...' : 'not included',
					eventId: event.id,
				})
				onZapReceived({ eventId: event.id, receiptPreimage: receiptPreimage || undefined })

				// Cleanup after successful detection
				setTimeout(() => {
					cleanupFunctions.forEach((fn) => fn())
				}, 100)
			}
		}, bolt11)

		cleanupFunctions.push(stopSubscription)

		// Set timeout for monitoring
		const timeout = setTimeout(() => {
			if (!hasReceivedZap) {
				console.log('⏰ Zap monitoring timeout reached for invoice:', bolt11.substring(0, 20) + '...')
				if (onTimeout) {
					console.log('🔄 Triggering timeout callback...')
					onTimeout()
				} else {
					console.log('💡 Tip: The zap may have succeeded but the receipt may not have propagated to relays yet')
				}
				// Cleanup on timeout
				cleanupFunctions.forEach((fn) => fn())
			}
		}, timeoutMs)

		cleanupFunctions.push(() => clearTimeout(timeout))

		// Return cleanup function
		return () => {
			console.log('🧹 Cleaning up zap monitoring for invoice:', bolt11.substring(0, 20) + '...')
			cleanupFunctions.forEach((fn) => fn())
		}
	},
}

export const useNDK = () => {
	return {
		...ndkStore.state,
		...ndkActions,
	}
}
