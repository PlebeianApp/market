import { Store } from '@tanstack/store'
import type { QueryClient } from '@tanstack/react-query'
import { configActions } from '@/lib/stores/config'
import { ndkActions, ndkStore } from '@/lib/stores/ndk'
import { authActions } from '@/lib/stores/auth'
import { walletActions } from '@/lib/stores/wallet'
import { configKeys } from '@/queries/queryKeyFactory'
import type { PublicAppConfig } from '@/lib/instance-config'

/**
 * Web host bootstrap: loads this instance's runtime config, initializes its
 * relay client, and restores browser auth and wallet state.
 *
 * This module is Platform composition, not part of the reusable SDK or UI.
 * Dependencies on the legacy `src/` application modules are transitional and
 * will be removed as those services are extracted behind SDK/platform ports.
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

/** Idempotently initialize runtime configuration and browser-side services. */
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

			ndkActions.initialize()
			ndkActions.ensureAppRelayFromConfig()

			const relayUrls = ndkStore.state.explicitRelayUrls
			console.log(`NDK initialized with ${relayUrls.length} relay(s):`, relayUrls)

			ndkActions.connect().catch((err) => {
				console.warn('Background NDK connection issue:', err)
			})
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
			bootPromise = null
			throw err
		}
	})()

	return bootPromise
}

const CONFIG_FETCH_TIMEOUT_MS = 10_000
const CONFIG_FETCH_MAX_ATTEMPTS = 3
const CONFIG_FETCH_BACKOFF_MS = [500, 1_500] as const

async function fetchConfig(): Promise<PublicAppConfig> {
	let lastError: unknown

	for (let attempt = 1; attempt <= CONFIG_FETCH_MAX_ATTEMPTS; attempt++) {
		try {
			return await fetchConfigOnce()
		} catch (err) {
			lastError = err

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

async function fetchConfigOnce(): Promise<PublicAppConfig> {
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

/** Reset process bootstrap state, primarily for tests. */
export function resetBoot(): void {
	bootPromise = null
	bootStore.setState(() => initialState)
}
