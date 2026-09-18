import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { createQueryClient } from './lib/queryClient'
import { routeTree } from './routeTree.gen'
import type { AppRouterContext } from './lib/router-utils'
import { bootApp, bootStore } from './lib/boot'
import { UpdateAvailableDialog } from './components/UpdateAvailableDialog'
import { useServiceWorker } from './hooks/useServiceWorker'

if (process.env.NODE_ENV !== 'development') {
	console.log = () => {}
	console.debug = () => {}
	console.error = () => {}
	console.info = () => {}
}

// Create queryClient + router once at module level. Re-creating the
// router on every render would lose route state (TanStack Router stores
// match cache + pending nav on the instance).
const queryClient = createQueryClient()

function DefaultPending() {
	return (
		<div className="flex-1 flex items-center justify-center py-20">
			<div className="flex flex-col items-center gap-4">
				<div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
				<p className="text-sm text-muted-foreground">Loading...</p>
			</div>
		</div>
	)
}

function createAppRouter(queryClient: QueryClient) {
	return createRouter({
		routeTree,
		context: {
			queryClient,
		} as AppRouterContext,
		defaultPreload: 'intent',
		defaultPreloadStaleTime: 0,
		defaultPendingMs: 0,
		defaultPendingMinMs: 200,
		defaultPendingComponent: DefaultPending,
	})
}

const router = createAppRouter(queryClient)

/**
 * Root component. All of the boot heavy-lifting lives in `bootApp`
 * (see `src/lib/boot.ts`) — this component just kicks it off once on
 * mount and renders based on the resulting status.
 */
function App() {
	const { status, error } = useStore(bootStore)
	const { showUpdateDialog, dismissUpdate } = useServiceWorker()

	useEffect(() => {
		// bootApp is idempotent — safe under StrictMode double-mount.
		bootApp(queryClient).catch(() => {
			// Error already surfaced via bootStore; swallow here so React
			// doesn't see an unhandled promise rejection.
		})
	}, [])

	if (status === 'error') {
		return (
			<div className="flex justify-center items-center h-screen flex-col gap-2">
				<div className="text-red-500">Error: {error}</div>
				<button className="px-4 py-2 bg-blue-500 text-white rounded" onClick={() => window.location.reload()}>
					Retry
				</button>
			</div>
		)
	}

	if (status !== 'ready') {
		return <div className="flex justify-center items-center h-screen">Loading...</div>
	}

	return (
		<StrictMode>
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />
				<UpdateAvailableDialog open={showUpdateDialog} onDismiss={dismissUpdate} />
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
