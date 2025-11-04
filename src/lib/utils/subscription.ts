import React from 'react'
import type { NDK, NDKFilter, NDKSubscription, NDKEvent } from '@nostr-dev-kit/ndk'

export interface SafeSubscriptionOptions {
	closeOnEose?: boolean
	timeout?: number
	onEvent?: (event: NDKEvent) => void
	onEose?: () => void
	onClose?: () => void
}

export interface SafeSubscriptionResult {
	subscription: NDKSubscription | null
	cleanup: () => void
}

/**
 * Creates a safe NDK subscription with proper error handling for temporal dead zone issues
 * This wrapper handles the common NDK subscription race conditions and provides consistent cleanup
 */
export function createSafeSubscription(
	ndk: NDK,
	filter: NDKFilter | NDKFilter[],
	options: SafeSubscriptionOptions = {},
): SafeSubscriptionResult {
	const { closeOnEose = true, timeout = 30000, onEvent, onEose, onClose } = options

	// Verify NDK is ready before creating subscription
	if (!ndk || !ndk.pool) {
		console.warn('[SafeSubscription] NDK not ready for subscription')
		return {
			subscription: null,
			cleanup: () => {},
		}
	}

	let subscription: NDKSubscription | null = null
	let isCleanedUp = false
	let timeoutId: ReturnType<typeof setTimeout> | null = null

	try {
		// Create subscription with proper options
		subscription = ndk.subscribe(filter, { closeOnEose })

		// Set up event handlers if provided
		if (onEvent) {
			subscription.on('event', (event: NDKEvent) => {
				if (!isCleanedUp) {
					onEvent(event)
				}
			})
		}

		if (onEose) {
			subscription.on('eose', () => {
				if (!isCleanedUp) {
					onEose()
				}
			})
		}

		if (onClose) {
			subscription.on('close', () => {
				if (!isCleanedUp) {
					onClose()
				}
			})
		}

		// Set up timeout if specified
		if (timeout > 0) {
			timeoutId = setTimeout(() => {
				if (!isCleanedUp) {
					console.log('[SafeSubscription] Timeout reached, cleaning up subscription')
					cleanup()
				}
			}, timeout)
		}

		// Let NDK auto-start the subscription to avoid temporal dead zone issues
		// Do not call .start() explicitly
	} catch (error) {
		console.error('[SafeSubscription] Error creating subscription:', error)
		subscription = null
	}

	const cleanup = () => {
		if (isCleanedUp) return
		isCleanedUp = true

		// Clear timeout if set
		if (timeoutId) {
			clearTimeout(timeoutId)
			timeoutId = null
		}

		// Clean up subscription with proper error handling
		if (subscription) {
			try {
				// Add a delay to prevent race conditions with NDK's internal cleanup
				setTimeout(() => {
					try {
						// Guard against subscription not being initialized (NDK race condition fix)
						if (subscription && typeof subscription.stop === 'function') {
							subscription.stop()
						}
					} catch (error) {
						// Suppress "Cannot access 's' before initialization" errors from NDK
						if (error instanceof ReferenceError && error.message.includes("Cannot access 's' before initialization")) {
							console.warn('[SafeSubscription] Suppressed subscription cleanup race condition')
							return
						}
						// Also suppress aiGuardrails related errors
						if (error instanceof ReferenceError && error.message.includes('aiGuardrails')) {
							console.warn('[SafeSubscription] Suppressed aiGuardrails race condition')
							return
						}
						console.warn('[SafeSubscription] Error stopping subscription:', error)
					}
				}, 50) // Increased delay to ensure NDK initialization is complete
			} catch (error) {
				console.warn('[SafeSubscription] Error setting up subscription cleanup:', error)
			}
		}
	}

	return {
		subscription,
		cleanup,
	}
}

/**
 * Hook-style wrapper for safe subscriptions in React components
 */
export function useSafeSubscription(
	ndk: NDK | null,
	filter: NDKFilter | NDKFilter[],
	options: SafeSubscriptionOptions = {},
	dependencies: React.DependencyList = [],
): SafeSubscriptionResult {
	const [result, setResult] = React.useState<SafeSubscriptionResult>({
		subscription: null,
		cleanup: () => {},
	})

	React.useEffect(() => {
		if (!ndk) {
			setResult({
				subscription: null,
				cleanup: () => {},
			})
			return
		}

		const safeSubscription = createSafeSubscription(ndk, filter, options)
		setResult(safeSubscription)

		// Return cleanup function
		return () => {
			safeSubscription.cleanup()
		}
	}, [ndk, ...dependencies])

	return result
}

/**
 * Promise-based subscription that resolves when complete
 */
export function createSubscriptionPromise<T = NDKEvent[]>(
	ndk: NDK,
	filter: NDKFilter | NDKFilter[],
	options: SafeSubscriptionOptions & {
		collectEvents?: boolean
		maxEvents?: number
	} = {},
): Promise<T> {
	const { collectEvents = true, maxEvents = 1000, timeout = 30000 } = options

	return new Promise((resolve, reject) => {
		const events: NDKEvent[] = []
		let hasResolved = false

		const safeResolve = (result: T) => {
			if (!hasResolved) {
				hasResolved = true
				cleanup()
				resolve(result)
			}
		}

		const safeReject = (error: Error) => {
			if (!hasResolved) {
				hasResolved = true
				cleanup()
				reject(error)
			}
		}

		const { subscription, cleanup } = createSafeSubscription(ndk, filter, {
			...options,
			timeout,
			onEvent: (event: NDKEvent) => {
				if (collectEvents) {
					events.push(event)
					if (events.length >= maxEvents) {
						safeResolve(events as T)
					}
				}
				options.onEvent?.(event)
			},
			onEose: () => {
				if (collectEvents) {
					safeResolve(events as T)
				} else {
					safeResolve(undefined as T)
				}
				options.onEose?.()
			},
			onClose: () => {
				if (collectEvents) {
					safeResolve(events as T)
				} else {
					safeResolve(undefined as T)
				}
				options.onClose?.()
			},
		})

		if (!subscription) {
			safeReject(new Error('Failed to create subscription'))
		}

		// Set up timeout
		setTimeout(() => {
			if (collectEvents) {
				safeResolve(events as T)
			} else {
				safeResolve(undefined as T)
			}
		}, timeout)
	})
}
