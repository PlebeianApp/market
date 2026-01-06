import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { StrictMode, useEffect, useState, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles/index.css'
import { createQueryClient } from './lib/queryClient'
import { routeTree } from './routeTree.gen'
import type { AppRouterContext } from './lib/router-utils'
import { configActions, configStore } from './lib/stores/config'
import { ndkActions } from './lib/stores/ndk'

// Create queryClient once at module level
const queryClient = createQueryClient()

function DefaultPending() {
	return (
		<div className="w-full">
			<div className="sticky top-0 z-50 h-1 bg-primary/10 overflow-hidden">
				<div className="h-full w-1/3 bg-primary animate-pulse" />
			</div>
		</div>
	)
}

// Function to create a router once we have a queryClient
function createAppRouter(queryClient: QueryClient) {
	return createRouter({
		routeTree,
		context: {
			queryClient,
		} as AppRouterContext,
		defaultPreload: 'intent',
		defaultPreloadStaleTime: 0,
		defaultPendingMs: 1500,
		defaultPendingMinMs: 0,
		defaultPendingComponent: DefaultPending,
	})
}

// Create router once at module level
const router = createAppRouter(queryClient)

// Main app initialization and rendering
function App() {
	const [configLoaded, setConfigLoaded] = useState(configStore.state.isLoaded)
	const [error, setError] = useState<string | null>(null)

	// Fetch config on mount if not already loaded
	useEffect(() => {
		if (configStore.state.isLoaded) {
			setConfigLoaded(true)
			return
		}

		const loadConfig = async () => {
			try {
				const controller = new AbortController()
				const timeout = setTimeout(() => controller.abort(), 10000)

				const response = await fetch('/api/config', { signal: controller.signal })
				clearTimeout(timeout)

				if (!response.ok) {
					throw new Error(`Failed to fetch config: ${response.status} ${response.statusText}`)
				}
				const config = await response.json()
				configActions.setConfig(config)
				// Ensure we always connect to the instance relay even without a signer
				ndkActions.ensureAppRelayFromConfig()
				setConfigLoaded(true)
				console.log('Fetched config:', config)
			} catch (err) {
				console.error('Config fetch error:', err)
				setError(err instanceof Error ? err.message : 'Failed to load configuration')
			}
		}

		loadConfig()
	}, [])

	if (error) {
		return (
			<div className="flex justify-center items-center h-screen flex-col gap-2">
				<div className="text-red-500">Error: {error}</div>
				<button className="px-4 py-2 bg-blue-500 text-white rounded" onClick={() => window.location.reload()}>
					Retry
				</button>
			</div>
		)
	}

	// Show minimal loading only if config isn't loaded yet
	// This should be very brief since config fetch is fast
	if (!configLoaded) {
		return <div className="flex justify-center items-center h-screen">Loading...</div>
	}

	return (
		<StrictMode>
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />
			</QueryClientProvider>
		</StrictMode>
	)
}

const elem = document.getElementById('root')!

if (import.meta.hot) {
	// With hot module reloading, `import.meta.hot.data` is persisted.
	const root = (import.meta.hot.data.root ??= createRoot(elem))
	root.render(<App />)
} else {
	// The hot module reloading API is not available in production.
	createRoot(elem).render(<App />)
}
