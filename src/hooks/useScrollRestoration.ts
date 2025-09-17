import { useEffect, useRef } from 'react'
import { useLocation } from '@tanstack/react-router'

interface ScrollPosition {
	scrollTop: number
	timestamp: number
}

interface UseScrollRestorationOptions {
	/** Key to identify this scroll context */
	key: string
	/** How long to keep scroll positions in sessionStorage (ms) */
	ttl?: number
}

/**
 * Hook to save and restore scroll positions when navigating between pages
 * Uses sessionStorage to persist scroll positions across page navigations
 */
export function useScrollRestoration({ key, ttl = 30 * 60 * 1000 }: UseScrollRestorationOptions) {
	const location = useLocation()
	const scrollElementRef = useRef<HTMLElement | null>(null)
	const isRestoringRef = useRef(false)

	// Generate storage key based on the provided key and current pathname
	const storageKey = `scroll-${key}-${location.pathname}`

	// Save current scroll position
	const saveScrollPosition = () => {
		if (!scrollElementRef.current || isRestoringRef.current) return

		const scrollPosition: ScrollPosition = {
			scrollTop: scrollElementRef.current.scrollTop,
			timestamp: Date.now(),
		}

		try {
			sessionStorage.setItem(storageKey, JSON.stringify(scrollPosition))
		} catch (error) {
			console.warn('Failed to save scroll position:', error)
		}
	}

	// Restore scroll position
	const restoreScrollPosition = () => {
		if (!scrollElementRef.current) return

		try {
			const stored = sessionStorage.getItem(storageKey)
			if (!stored) return

			const scrollPosition: ScrollPosition = JSON.parse(stored)

			// Check if the stored position is still valid (within TTL)
			if (Date.now() - scrollPosition.timestamp > ttl) {
				sessionStorage.removeItem(storageKey)
				return
			}

			// Set flag to prevent saving during restoration
			isRestoringRef.current = true

			// Restore scroll position
			scrollElementRef.current.scrollTop = scrollPosition.scrollTop

			// Reset flag after a short delay
			setTimeout(() => {
				isRestoringRef.current = false
			}, 100)
		} catch (error) {
			console.warn('Failed to restore scroll position:', error)
		}
	}

	// Clear stored scroll position
	const clearScrollPosition = () => {
		try {
			sessionStorage.removeItem(storageKey)
		} catch (error) {
			console.warn('Failed to clear scroll position:', error)
		}
	}

	// Set up scroll element ref and restore position on mount
	useEffect(() => {
		// Try to restore scroll position when component mounts
		const timer = setTimeout(() => {
			restoreScrollPosition()
		}, 50) // Small delay to ensure DOM is ready

		return () => clearTimeout(timer)
	}, [storageKey])

	// Save scroll position before navigation
	useEffect(() => {
		const handleBeforeUnload = () => {
			saveScrollPosition()
		}

		// Save on page unload
		window.addEventListener('beforeunload', handleBeforeUnload)

		// Save on route change (cleanup function)
		return () => {
			window.removeEventListener('beforeunload', handleBeforeUnload)
			saveScrollPosition()
		}
	}, [storageKey])

	return {
		/** Ref to attach to the scrollable element */
		scrollElementRef,
		/** Manually save current scroll position */
		saveScrollPosition,
		/** Manually restore scroll position */
		restoreScrollPosition,
		/** Clear stored scroll position */
		clearScrollPosition,
	}
}
