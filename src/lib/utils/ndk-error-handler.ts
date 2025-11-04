/**
 * Global error handler for NDK temporal dead zone issues
 * 
 * This catches ReferenceErrors from NDK's internal code that occur due to
 * JavaScript temporal dead zone issues with lexical declarations.
 * 
 * The errors typically occur in:
 * - NDK's subscription management (accessing 's' before initialization)
 * - NDK's aiGuardrails feature
 * - NDK's fetchEvent timeout handlers (t2)
 */

let isErrorHandlerInstalled = false
let originalErrorHandler: OnErrorEventHandlerNonNull | null = null

/**
 * Install a global error handler to suppress NDK temporal dead zone errors
 */
export function installNDKErrorHandler(): void {
	if (isErrorHandlerInstalled) {
		console.log('[NDK Error Handler] Already installed')
		return
	}

	// Store the original error handler
	originalErrorHandler = window.onerror

	// Install our custom error handler
	window.onerror = (event, source, lineno, colno, error) => {
		// Check if this is an NDK temporal dead zone error
		if (error instanceof ReferenceError) {
			const message = error.message || ''
			
			// Check for known NDK temporal dead zone patterns
			const isNDKTemporalDeadZone = 
				message.includes("Cannot access 's' before initialization") ||
				message.includes("can't access lexical declaration 's' before initialization") ||
				message.includes('aiGuardrails') ||
				message.includes("Cannot access lexical declaration") ||
				message.includes("can't access lexical declaration")

			// Check if error is from NDK (look at source/stack)
			const isFromNDK = 
				(source && source.includes('nostr-dev-kit')) ||
				(source && source.includes('ndk')) ||
				(error.stack && error.stack.includes('nostr-dev-kit')) ||
				(error.stack && error.stack.includes('fetchEvent')) ||
				(error.stack && error.stack.includes('node_modules'))

			if (isNDKTemporalDeadZone || isFromNDK) {
				// Log as warning instead of error
				console.warn(
					'[NDK Error Handler] Suppressed NDK temporal dead zone error:',
					{
						message: error.message,
						source,
						line: lineno,
						column: colno,
						stack: error.stack?.split('\n').slice(0, 3).join('\n')
					}
				)
				
				// Prevent the error from propagating
				return true
			}
		}

		// For all other errors, call the original handler if it exists
		if (originalErrorHandler) {
			return originalErrorHandler(event, source, lineno, colno, error)
		}

		// Allow error to propagate normally
		return false
	}

	// Also install an unhandledrejection handler for promise rejections
	window.addEventListener('unhandledrejection', (event) => {
		const error = event.reason
		
		if (error instanceof ReferenceError) {
			const message = error.message || ''
			
			const isNDKTemporalDeadZone = 
				message.includes("Cannot access 's' before initialization") ||
				message.includes("can't access lexical declaration 's' before initialization") ||
				message.includes('aiGuardrails') ||
				message.includes("Cannot access lexical declaration") ||
				message.includes("can't access lexical declaration")

			const isFromNDK = 
				(error.stack && error.stack.includes('nostr-dev-kit')) ||
				(error.stack && error.stack.includes('fetchEvent')) ||
				(error.stack && error.stack.includes('node_modules'))

			if (isNDKTemporalDeadZone || isFromNDK) {
				console.warn(
					'[NDK Error Handler] Suppressed NDK temporal dead zone promise rejection:',
					{
						message: error.message,
						stack: error.stack?.split('\n').slice(0, 3).join('\n')
					}
				)
				
				// Prevent the unhandled rejection
				event.preventDefault()
			}
		}
	})

	isErrorHandlerInstalled = true
	console.log('[NDK Error Handler] Installed global error handler for NDK temporal dead zone issues')
}

/**
 * Uninstall the global error handler
 */
export function uninstallNDKErrorHandler(): void {
	if (!isErrorHandlerInstalled) {
		return
	}

	// Restore the original error handler
	window.onerror = originalErrorHandler
	originalErrorHandler = null
	isErrorHandlerInstalled = false
	
	console.log('[NDK Error Handler] Uninstalled global error handler')
}

/**
 * Check if the error handler is currently installed
 */
export function isNDKErrorHandlerInstalled(): boolean {
	return isErrorHandlerInstalled
}

