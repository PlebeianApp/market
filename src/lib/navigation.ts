/**
 * Navigation utility functions
 */

/**
 * Go back in browser history with a time limit
 * This prevents navigating back further than the specified time limit
 * @param maxDaysBack Maximum number of days to go back (default: 14 days)
 */
export function goBackWithTimeLimit(maxDaysBack: number = 14): void {
	if (typeof window === 'undefined') {
		return
	}

	// Get current timestamp
	const now = new Date()

	// Calculate the timestamp for the limit (2 weeks ago)
	const limitTime = new Date()
	limitTime.setDate(now.getDate() - maxDaysBack)

	// Check if we have session history entries
	if (window.history.state && window.history.state.timestamp) {
		const previousTimestamp = new Date(window.history.state.timestamp)

		// If the previous entry is older than our limit, don't go back
		if (previousTimestamp < limitTime) {
			console.log('Reached navigation time limit, not going back further')
			return
		}
	}

	// Store current timestamp in history state before navigating
	const currentState = window.history.state || {}
	window.history.replaceState({ ...currentState, timestamp: now.toISOString() }, document.title)

	// Navigate back
	window.history.back()
}
