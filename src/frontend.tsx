import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { queryClient } from './lib/queryClient'
import { ndkActions } from './lib/stores/ndk'
import { useConfigQuery } from './queries/config'
import { routeTree } from './routeTree.gen'
import { authActions } from './lib/stores/auth'

declare global {
	interface ImportMeta {
		hot?: {
			data: Record<string, any>
		}
	}
}

// Create a new router instance
const router = createRouter({
	routeTree,
	context: {
		queryClient,
	},
	defaultPreload: 'intent',
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
				ndkActions.initialize([config.appRelay, 'wss://relay.nostr.net'])
				ndkActions.connect()
				authActions.getAuthFromLocalStorageAndLogin()
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
