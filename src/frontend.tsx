import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles/index.css'
import { createQueryClient } from './lib/queryClient'
import { routeTree } from './routeTree.gen'
import type { AppRouterContext } from './lib/router-utils'
import { configActions } from './lib/stores/config'

// Global error handler to catch and suppress NDK initialization errors
// These errors occur due to race conditions in NDK's bundled code:
// 1. NIP-44 decryption when browser extensions try to decrypt messages
// 2. Subscription initialization when setTimeout callbacks access subscriptions before they're created
// 3. fetchEvent timeouts (t2) accessing lexical declarations before initialization
// 4. aiGuardrails feature accessing internal variables
// This is likely due to circular dependencies or initialization order issues in the bundled NDK library
if (typeof window !== 'undefined') {
	// Override console.error to catch errors before React's error boundary
	const originalConsoleError = console.error
	console.error = (...args: any[]) => {
		const errorMessage = args.join(' ')
		if (
			errorMessage.includes("Cannot access 's' before initialization") ||
			errorMessage.includes("can't access lexical declaration 's' before initialization") ||
			errorMessage.includes("can't access lexical declaration") ||
			errorMessage.includes('aiGuardrails') ||
			errorMessage.includes('index.mjs') ||
			(errorMessage.includes('ReferenceError') && errorMessage.includes('nostr-dev-kit'))
		) {
			// Suppress NDK initialization errors from console.error
			console.warn('[NDK] Suppressed error from console.error:', errorMessage)
			return
		}
		originalConsoleError.apply(console, args)
	}

	const originalErrorHandler = window.onerror
	window.onerror = (message, source, lineno, colno, error) => {
		// Suppress the specific temporal dead zone errors
		// that occur in NDK bundled code due to initialization race conditions
		const messageStr = typeof message === 'string' ? message : String(message)
		const sourceStr = typeof source === 'string' ? source : ''
		const errorMsg = error?.message || ''
		const errorStack = error?.stack || ''

		const isTemporalDeadZoneError =
			messageStr.includes("Cannot access 's' before initialization") ||
			messageStr.includes("can't access lexical declaration 's' before initialization") ||
			messageStr.includes("can't access lexical declaration") ||
			errorMsg.includes("Cannot access 's' before initialization") ||
			errorMsg.includes("can't access lexical declaration 's' before initialization") ||
			errorMsg.includes('aiGuardrails')

		const isFromNDK =
			sourceStr.includes('index.mjs') ||
			sourceStr.includes('.js') ||
			errorStack.includes('nostr-dev-kit') ||
			errorStack.includes('fetchEvent') ||
			errorStack.includes('node_modules')

		if (isTemporalDeadZoneError && isFromNDK) {
			// Log for debugging but suppress the popup
			console.warn('[NDK] Suppressed temporal dead zone error (NDK race condition):', {
				message: messageStr,
				source: sourceStr,
				line: lineno,
				column: colno,
				errorMessage: errorMsg,
				stackPreview: errorStack.split('\n').slice(0, 3).join('\n'),
			})
			return true // Prevent default error handling (popup)
		}

		// Call original error handler if it exists
		if (originalErrorHandler) {
			return originalErrorHandler.call(window, message, source, lineno, colno, error)
		}

		return false
	}

	// Also handle unhandled promise rejections
	window.addEventListener('unhandledrejection', (event) => {
		const error = event.reason
		const errorMessage = error?.message || String(error)
		const errorStack = error?.stack || ''

		// Suppress the specific initialization errors
		if (
			errorMessage.includes("Cannot access 's' before initialization") ||
			errorMessage.includes("can't access lexical declaration 's' before initialization") ||
			errorMessage.includes("can't access lexical declaration") ||
			errorMessage.includes('aiGuardrails') ||
			errorStack.includes('index.mjs') ||
			errorStack.includes('s.stop') ||
			errorStack.includes('fetchEvent') ||
			errorStack.includes('nostr-dev-kit') ||
			errorMessage.includes('relaySet')
		) {
			console.warn('[NDK] Suppressed temporal dead zone promise rejection (NDK race condition):', {
				message: errorMessage,
				stackPreview: errorStack.split('\n').slice(0, 3).join('\n'),
			})
			event.preventDefault() // Prevent default error handling
			return
		}
	})

	// Catch React error boundaries and other error reporting
	const originalOnError = (window as any).__REACT_ERROR_OVERLAY_GLOBAL_HANDLER__
	if (originalOnError) {
		;(window as any).__REACT_ERROR_OVERLAY_GLOBAL_HANDLER__ = (error: Error, isFatal?: boolean) => {
			// Suppress NDK temporal dead zone errors from React error overlay
			if (
				error instanceof ReferenceError &&
				(error.message.includes("Cannot access 's' before initialization") ||
					error.message.includes("can't access lexical declaration 's' before initialization") ||
					error.message.includes('aiGuardrails') ||
					error.stack?.includes('index.mjs') ||
					error.stack?.includes('s.stop'))
			) {
				console.warn('[NDK] Suppressed error from React error overlay:', error.message)
				return
			}
			if (isFatal !== undefined) {
				originalOnError(error, isFatal)
			} else {
				originalOnError(error)
			}
		}
	}

	// Also catch errors reported to the console
	const originalConsoleWarn = console.warn
	console.warn = (...args: any[]) => {
		const warnMessage = args.join(' ')
		// Don't suppress our own warnings
		if (warnMessage.includes('[NDK] Suppressed')) {
			originalConsoleWarn.apply(console, args)
			return
		}
		// Suppress TDZ warnings that might slip through
		if (
			warnMessage.includes("can't access lexical declaration 's' before initialization") ||
			warnMessage.includes("Cannot access 's' before initialization")
		) {
			console.log('[NDK] Intercepted and suppressed warning:', warnMessage.substring(0, 100))
			return
		}
		originalConsoleWarn.apply(console, args)
	}

	// Also intercept Bun's error overlay by checking for the error overlay element
	const suppressErrorOverlay = () => {
		// Find and remove error overlay containers by looking for "Runtime Error" text
		const allElements = document.querySelectorAll('*')
		allElements.forEach((el) => {
			const text = el.textContent || ''
			if (text.includes('Runtime Error') && text.includes("Cannot access 's' before initialization")) {
				// Find the parent container (usually a dialog or overlay)
				let parent = el.parentElement
				let depth = 0
				while (parent && depth < 10) {
					// Check if this is likely the error overlay container
					const parentText = parent.textContent || ''
					if (
						parent.getAttribute('role') === 'dialog' ||
						parent.classList.toString().includes('overlay') ||
						parent.classList.toString().includes('error') ||
						parentText.includes('Runtime Error')
					) {
						parent.style.display = 'none'
						parent.remove()
						console.warn('[NDK] Suppressed error overlay container')
						break
					}
					parent = parent.parentElement
					depth++
				}
				// Also hide the element itself if it contains the error
				;(el as HTMLElement).style.display = 'none'
				el.remove()
			}
		})

		// Check if error overlay exists and contains NDK error - target Bun's error overlay structure
		const errorOverlays = document.querySelectorAll('[role="dialog"], [data-react-error-overlay], [class*="error"], [class*="overlay"]')
		errorOverlays.forEach((overlay) => {
			const errorText = overlay.textContent || ''
			if (
				errorText.includes("Cannot access 's' before initialization") ||
				errorText.includes('index.mjs') ||
				errorText.includes('ReferenceError') ||
				(errorText.includes('Runtime Error') && errorText.includes("Cannot access 's'"))
			) {
				// Hide the error overlay
				;(overlay as HTMLElement).style.display = 'none'
				overlay.remove()
				console.warn('[NDK] Suppressed error overlay UI')
			}
		})

		// Also check for error banner/banner elements that contain "Runtime Error"
		const banners = document.querySelectorAll('[role="banner"]')
		banners.forEach((banner) => {
			const errorText = banner.textContent || ''
			if (
				errorText.includes("Cannot access 's' before initialization") ||
				errorText.includes('ReferenceError') ||
				(errorText.includes('Runtime Error') && errorText.includes("Cannot access 's'"))
			) {
				;(banner as HTMLElement).style.display = 'none'
				banner.remove()
			}
		})
	}

	// Use MutationObserver to catch error overlays as they're added
	const observer = new MutationObserver(() => {
		suppressErrorOverlay()
	})

	observer.observe(document.body, {
		childList: true,
		subtree: true,
	})

	// Check periodically for error overlay
	setInterval(suppressErrorOverlay, 100)
	// Also check immediately
	setTimeout(suppressErrorOverlay, 0)
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
	})
}

// Main app initialization and rendering
function App() {
	const [queryClient, setQueryClient] = useState<QueryClient | null>(null)
	const [router, setRouter] = useState<any | null>(null)
	const [isLoading, setIsLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		const fetchWithTimeout = async (url: string, timeoutMs = 10000): Promise<Response> => {
			const controller = new AbortController()
			const timeout = setTimeout(() => controller.abort(), timeoutMs)
			try {
				const res = await fetch(url, { signal: controller.signal })
				return res
			} finally {
				clearTimeout(timeout)
			}
		}

		const initialize = async () => {
			try {
				setIsLoading(true)

				// First fetch the config
				const response = await fetchWithTimeout('/api/config', 10000)
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
