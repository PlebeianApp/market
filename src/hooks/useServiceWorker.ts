import { useEffect, useState } from 'react'

/**
 * Service-worker registration + update-detection hook.
 *
 * Pulled out of `frontend.tsx` so the root component stays focused on
 * rendering and the SW lifecycle (registration, periodic update poll,
 * controllerchange reload) lives in one place.
 *
 * Production-only: in development/test the SW's `skipWaiting +
 * clients.claim` cycle causes non-deterministic page reloads that
 * break Playwright navigation and HMR.
 *
 * Returns:
 *   - `showUpdateDialog`: true once a new SW is installed and waiting
 *     while a controller is already active (i.e. a real update, not
 *     the first install).
 *   - `dismissUpdate`: hides the dialog without forcing a reload. The
 *     new SW still takes over on the next navigation/reload.
 */
export function useServiceWorker(): {
	showUpdateDialog: boolean
	dismissUpdate: () => void
} {
	const [showUpdateDialog, setShowUpdateDialog] = useState(false)

	useEffect(() => {
		if (!('serviceWorker' in navigator)) return
		if (process.env.NODE_ENV !== 'production') return

		let cancelled = false
		let intervalId: ReturnType<typeof setInterval> | null = null

		navigator.serviceWorker
			.register('/sw.js')
			.then((registration) => {
				if (cancelled) return
				console.log('SW registered:', registration.scope)

				// Poll for updates hourly. Browsers also check on their own
				// schedule, but this guarantees we notice within an hour even
				// if the tab stays open.
				intervalId = setInterval(() => registration.update(), 60 * 60 * 1000)

				registration.addEventListener('updatefound', () => {
					const newWorker = registration.installing
					if (!newWorker) return

					newWorker.addEventListener('statechange', () => {
						// A new SW is installed and waiting AND we have an active
						// controller — that's a real update (not the first install).
						if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
							setShowUpdateDialog(true)
						}
					})
				})
			})
			.catch((err) => {
				console.error('SW registration failed:', err)
			})

		// When a new SW takes control (e.g. skipWaiting was called) reload
		// once so the page picks up the new assets. Guard with sessionStorage
		// to avoid an infinite reload loop if controllerchange fires repeatedly.
		const onControllerChange = () => {
			if (sessionStorage.getItem('sw-reload')) return
			sessionStorage.setItem('sw-reload', 'true')
			window.location.reload()
		}
		navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

		return () => {
			cancelled = true
			if (intervalId !== null) clearInterval(intervalId)
			navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
		}
	}, [])

	return {
		showUpdateDialog,
		dismissUpdate: () => setShowUpdateDialog(false),
	}
}
