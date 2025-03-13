import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { routeTree } from './routeTree.gen'
import { NostrService } from './lib/nostr'
import './index.css'
import { useConfigQuery } from './queries/config'

export const nostrService = NostrService.getInstance()

const queryClient = new QueryClient({
	// defaultOptions: {
	//   queries: {
	//     staleTime: 1000 * 60 * 5, // Consider data stale after 5 minutes
	//     gcTime: 1000 * 60 * 30, // Keep unused data in cache for 30 minutes
	//   },
	// },
})

// Create a new router instance
const router = createRouter({
	routeTree,
	context: {
		queryClient,
		nostr: nostrService,
	},
	defaultPreload: 'intent',
	// Since we're using React Query, we don't want loader calls to ever be stale
	// This will ensure that the loader is always called when the route is preloaded or visited
	defaultPreloadStaleTime: 0,
})

// Register the router instance for type safety
declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router
	}
}

const elem = document.getElementById('root')!
const App = () => {
	// Fetch config and add relay when component mounts
	// TODO: use react query to keep the app relay across the app
	useEffect(() => {
		const fetchConfigAndConnect = async () => {
			try {
				// Fetch config from the API
				const response = await fetch('/api/config')
				if (!response.ok) {
					throw new Error(`Failed to fetch config: ${response.status} ${response.statusText}`)
				}
				const config = await response.json()

				// Add the relay URL from config
				if (config.appRelay) {
					console.log(`Adding relay from config: ${config.appRelay}`)
					nostrService.addExplicitRelay([config.appRelay, 'wss://relay.nostr.net'])
					await nostrService.connect()
				}

				// Connect to relays
				nostrService.connect().catch(console.error)
			} catch (error) {
				console.error('Failed to fetch config or connect to relay:', error)
			}
		}

		fetchConfigAndConnect()
	}, [])

	return (
		<StrictMode>
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />
			</QueryClientProvider>
		</StrictMode>
	)
}

if (import.meta.hot) {
	// With hot module reloading, `import.meta.hot.data` is persisted.
	const root = (import.meta.hot.data.root ??= createRoot(elem))
	root.render(<App />)
} else {
	// The hot module reloading API is not available in production.
	createRoot(elem).render(<App />)
}
