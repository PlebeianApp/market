import { Store } from '@tanstack/store'
import type { QueryClient } from '@tanstack/react-query'
import { configActions, configStore } from './stores/config'
import { ndkActions, ndkStore } from './stores/ndk'
import { authActions } from './stores/auth'
import { walletActions } from './stores/wallet'
import { configKeys } from '@/queries/queryKeyFactory'

/**
 * App bootstrap orchestrator.
 *
 * Previously this logic lived inline inside `App` in `frontend.tsx` —
 * a 60-line `useEffect` that fetched config, initialized NDK, kicked
 * off auth + wallet, and tracked its own loading/error state. Pulling
 * it out lets the React layer stay declarative (just watch `bootStore`
 * and render accordingly) and makes the boot flow testable + reusable.
 *
 * The boot sequence is intentionally fixed and one-shot:
 *   1. fetch `/api/config` (server tells us stage + app relay)
 *   2. seed React Query cache with the config (so `useConfigQuery`
 *      doesn't re-fetch on first render)
 *   3. initialize NDK with stage-correct relay policy
 *   4. start NDK connect() in the background (non-blocking — pages can
 *      render before the WS handshake completes)
 *   5. kick off auth + wallet restoration in the background
 *
 * Steps 4/5 are fire-and-forget by design: rendering the router should
 * NOT wait on relay connectivity (UI shows the lazy spinner if a query
 * is pending) and should NOT wait on auto-login (anonymous browsing is
 * the default state until auth resolves).
 */

export type BootStatus = 'idle' | 'loading-config' | 'ready' | 'error'

interface BootState {
	status: BootStatus
	error: string | null
}

const initialState: BootState = {
	status: 'idle',
	error: null,
}

export const bootStore = new Store<BootState>(initialState)

let bootPromise: Promise<void> | null = null

/**
 * Idempotent: safe to call multiple times. Returns the same in-flight
 * promise if boot is already running, and resolves immediately if boot
 * already completed.
 */
export function bootApp(queryClient: QueryClient): Promise<void> {
	if (bootPromise) return bootPromise
	if (bootStore.state.status === 'ready') return Promise.resolve()

	bootPromise = (async () => {
		bootStore.setState(() => ({ status: 'loading-config', error: null }))

		try {
			const config = await fetchConfig()

			configActions.setConfig(config)
			queryClient.setQueryData(configKeys.all, config)
			console.log('Fetched config:', { stage: config.stage, appRelay: config.appRelay })

			// Initialize NDK AFTER config is loaded so stage-based relay
			// selection works. Previously this ran at module load (before
			// config), causing dev/test environments to connect to public
			// relays instead of only the local relay.
			ndkActions.initialize()
			ndkActions.ensureAppRelayFromConfig()

			const relayUrls = ndkStore.state.explicitRelayUrls
			console.log(`NDK initialized with ${relayUrls.length} relay(s):`, relayUrls)

			// Connect + restore auth + restore wallet are all non-blocking:
			// the router renders as soon as we mark ready, and these settle
			// in the background. Errors here surface in their own stores'
			// loading/auth state rather than failing the whole boot.
			ndkActions.connect().catch((err) => {
				console.warn('Background NDK connection issue:', err)
			})
			// Start the connection watchdog so a network blip / tab
			// throttling doesn't leave the app stuck on dead WebSockets.
			// Idempotent — safe under StrictMode double-mount and HMR.
			ndkActions.startConnectionWatchdog()
			void authActions.getAuthFromLocalStorageAndLogin()
			void walletActions.initialize()

			bootStore.setState(() => ({ status: 'ready', error: null }))
		} catch (err) {
			console.error('Boot failed:', err)
			bootStore.setState(() => ({
				status: 'error',
				error: err instanceof Error ? err.message : 'Failed to load configuration',
			}))
			bootPromise = null // allow retry by calling bootApp again
			throw err
		}
	})()

	return bootPromise
}

/**
 * Fetch `/api/config` with exponential backoff. Kept private to this
 * module so the rest of the boot pipeline doesn't need to know about
 * retry logic.
 *
 * Why retry boot-time config:
 *   - `/api/config` is served by the same Bun process as the app, but
 *     on a cold deploy the worker can still be warming up when the
 *     first request arrives. A single fetch failure used to brick the
 *     entire app (red error screen, manual reload required).
 *   - Network blips on mobile (cell-to-wifi handoff, etc.) hit the
 *     initial load too. One retry would fix most of these but two
 *     gives us cheap insurance.
 *
 * 3 attempts × 10s timeout each, 500ms / 1500ms backoff between them.
 * Worst case the user waits ~32s before seeing the error screen —
 * acceptable for a one-shot boot path. Aborts respect the timeout
 * controller so we don't pile up dangling fetches.
 *
 * 4xx errors are NOT retried — those are deterministic and retrying
 * a 401/403/404 just delays the inevitable error screen.
 */
const CONFIG_FETCH_TIMEOUT_MS = 10_000
const CONFIG_FETCH_MAX_ATTEMPTS = 3
const CONFIG_FETCH_BACKOFF_MS = [500, 1_500] as const

async function fetchConfig(): Promise<{
	appRelay?: string
	stage?: string
	[key: string]: any
}> {
	let lastError: unknown

	for (let attempt = 1; attempt <= CONFIG_FETCH_MAX_ATTEMPTS; attempt++) {
		try {
			return await fetchConfigOnce()
		} catch (err) {
			lastError = err

			// Don't retry 4xx — those are deterministic.
			if (err instanceof ConfigFetchError && err.status >= 400 && err.status < 500) {
				throw err
			}

			if (attempt < CONFIG_FETCH_MAX_ATTEMPTS) {
				const delay = CONFIG_FETCH_BACKOFF_MS[attempt - 1] ?? CONFIG_FETCH_BACKOFF_MS[CONFIG_FETCH_BACKOFF_MS.length - 1]
				console.warn(`Config fetch attempt ${attempt} failed; retrying in ${delay}ms`, err)
				await sleep(delay)
			}
		}
	}

	throw lastError instanceof Error ? lastError : new Error('Config fetch failed')
}

class ConfigFetchError extends Error {
	constructor(
		message: string,
		public readonly status: number,
	) {
		super(message)
		this.name = 'ConfigFetchError'
	}
}

async function fetchConfigOnce(): Promise<{
	appRelay?: string
	stage?: string
	[key: string]: any
}> {
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), CONFIG_FETCH_TIMEOUT_MS)

	try {
		const response = await fetch('/api/config', { signal: controller.signal })

		if (!response.ok) {
			throw new ConfigFetchError(`Failed to fetch config: ${response.status} ${response.statusText}`, response.status)
		}

		return await response.json()
	} finally {
		clearTimeout(timeout)
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Reset boot state — primarily for tests. Real code should treat boot
 * as a one-shot process and never need to reset it.
 */
export function resetBoot(): void {
	bootPromise = null
	bootStore.setState(() => initialState)
}
