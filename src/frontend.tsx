import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { routeTree } from './routeTree.gen'
import { NostrService } from './lib/nostr'
import { appService } from './lib/services/appService'
import './index.css'

export const nostrService = NostrService.getInstance()

const queryClient = new QueryClient()

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

function App() {
	useEffect(() => {
		appService.initialize().catch(console.error)

		const fetchConfigAndConnect = async () => {
			const config = appService.getConfig()
			if (config?.appRelay) {
				console.log(`Adding relay from config: ${config.appRelay}`)
				nostrService.addExplicitRelay([config.appRelay])
				await nostrService.connect()
			}
		}

		fetchConfigAndConnect().catch(console.error)
	}, [])

	return (
		<StrictMode>
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />
			</QueryClientProvider>
		</StrictMode>
	)
}

const elem = document.getElementById('root')!
createRoot(elem).render(<App />)
