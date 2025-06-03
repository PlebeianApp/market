import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles/index.css'
import { createQueryClient } from './lib/queryClient'
import { routeTree } from './routeTree.gen'
import type { AppRouterContext } from './lib/router-utils'
import { configActions } from './lib/stores/config'

// Function to create a router once we have a queryClient
function createAppRouter(queryClient: QueryClient) {
	return createRouter({
		routeTree,
		context: {
			queryClient,
		} as AppRouterContext,
		defaultPreload: 'intent',
		defaultPreloadStaleTime: 0,
	})
}

// Main app initialization and rendering
function App() {
	const [queryClient, setQueryClient] = useState<QueryClient | null>(null)
	const [router, setRouter] = useState<any | null>(null)
	const [isLoading, setIsLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		const initialize = async () => {
			try {
				setIsLoading(true)

				// First fetch the config
				const response = await fetch('/api/config')
				if (!response.ok) {
					throw new Error(`Failed to fetch config: ${response.status} ${response.statusText}`)
				}
				const config = await response.json()

				// Store the config in the configStore
				configActions.setConfig(config)
				console.log('Fetched config:', config)

				// Create queryClient with NDK initialization
				const client = await createQueryClient()
				setQueryClient(client)

				// Create router with the queryClient
				const appRouter = createAppRouter(client)

				setRouter(appRouter)
			} catch (err) {
				console.error('Initialization error:', err)
				setError(err instanceof Error ? err.message : 'Unknown error during initialization')
			} finally {
				setIsLoading(false)
			}
		}

		initialize()
	}, [])

	if (isLoading) {
		return <div className="flex justify-center items-center h-screen">Initializing application...</div>
	}

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

	if (!queryClient || !router) {
		return <div className="flex justify-center items-center h-screen">Failed to initialize application</div>
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
