import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles/index.css'
import { queryClient } from './lib/queryClient'
import { routeTree } from './routeTree.gen'

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
