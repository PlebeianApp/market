import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { routeTree } from './routeTree.gen'
import { NostrService } from './lib/nostr'
import { useConfigQuery } from './queries/config'
import { queryClient } from './lib/queryClient'
import './index.css'

declare global {
	interface ImportMeta {
		hot?: {
			data: Record<string, any>
		}
	}
}

export const nostrService = NostrService.getInstance()

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

declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router
	}
}

function AppContent() {
	const { data: config } = useConfigQuery()

	useEffect(() => {
		const connectToRelay = async () => {
			if (config?.appRelay) {
				console.log(`Adding relay from config: ${config.appRelay}`)
				nostrService.addExplicitRelay([config.appRelay, 'wss://relay.nostr.net'])
				await nostrService.connect()
			}
		}

		connectToRelay().catch(console.error)
	}, [config])

	return <RouterProvider router={router} />
}

function App() {
	return (
		<StrictMode>
			<QueryClientProvider client={queryClient}>
				<AppContent />
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
