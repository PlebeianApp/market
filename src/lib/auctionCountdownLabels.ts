export interface AuctionCountdownLabelOptions {
	showSeconds?: boolean
}

export interface AuctionCountdownLabels {
	secondsRemaining: number
	isEnded: boolean
	displayLabel: string
	detailedLabel: string
	absoluteLabel: string
}

/**
 * Formats seconds into a simple, human-readable string (e.g., "2 days left", "45 minutes left").
 * Prioritizes the largest unit of time.
 */
export function formatAuctionTimeLeft(seconds: number): string {
	if (seconds <= 0) return 'Ended'

	const days = Math.floor(seconds / 86400)
	const hours = Math.floor((seconds % 86400) / 3600)
	const minutes = Math.floor((seconds % 3600) / 60)
	const secs = Math.round(seconds % 60)

	if (days > 0) {
		return `${days} day${days > 1 ? 's' : ''} left`
	}
	if (hours > 0) {
		return `${hours} hour${hours > 1 ? 's' : ''} left`
	}

	if (minutes > 0) {
		return `${minutes} minute${minutes > 1 ? 's' : ''} left`
	}

	return `${secs} second${secs !== 1 ? 's' : ''} left`
}

/**
 * Formats seconds into a detailed countdown: DDd HH:MM:SS or HH:MM:SS or MM:SS.
 * Ended auctions return an explicit label so compact card views never render a placeholder.
 */
export function formatAuctionCountdownDetailed(seconds: number): string {
	if (seconds <= 0) return 'Ended'

	const days = Math.floor(seconds / 86400)
	const hours = Math.floor((seconds % 86400) / 3600)
	const minutes = Math.floor((seconds % 3600) / 60)
	const secs = seconds % 60

	const mm = minutes.toString().padStart(2, '0')
	const ss = Math.round(secs).toString().padStart(2, '0')
	const coreTime = `${mm}:${ss}`

	if (days > 0) {
		const hh = hours.toString().padStart(2, '0')
		return `${days}d ${hh}:${mm}:${ss}`
	}

	if (hours > 0) {
		const hh = hours.toString().padStart(2, '0')
		return `${hh}:${mm}:${ss}`
	}

	return coreTime
}

export function formatAuctionEndTimeLabel(endTimestamp: number, isEnded: boolean): string {
	if (endTimestamp <= 0) return 'No end date'

	const endDate = new Date(endTimestamp * 1000)
	const now = new Date()

	const endDateStr = endDate.toDateString()
	const todayStr = now.toDateString()

	const tomorrow = new Date(now)
	tomorrow.setDate(tomorrow.getDate() + 1)
	const tomorrowStr = tomorrow.toDateString()

	const timeStr = endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

	if (isEnded) {
		return `Ended on ${endDate.toLocaleDateString()} at ${timeStr}`
	}

	if (endDateStr === todayStr) {
		return `Ends today at ${timeStr}`
	}
	if (endDateStr === tomorrowStr) {
		return `Ends tomorrow at ${timeStr}`
	}

	return `Ends on ${endDate.toLocaleDateString()} at ${timeStr}`
}

export function getAuctionCountdownLabels(endAt: number, now: number, options?: AuctionCountdownLabelOptions): AuctionCountdownLabels {
	if (endAt <= 0) {
		return {
			secondsRemaining: 0,
			isEnded: false,
			displayLabel: 'No end date',
			detailedLabel: 'No end date',
			absoluteLabel: 'No end date',
		}
	}

	const secondsRemaining = Math.max(0, endAt - now)
	const isEnded = secondsRemaining <= 0
	const detailedLabel = formatAuctionCountdownDetailed(secondsRemaining)

	return {
		secondsRemaining,
		isEnded,
		displayLabel: options?.showSeconds ? detailedLabel : formatAuctionTimeLeft(secondsRemaining),
		detailedLabel,
		absoluteLabel: formatAuctionEndTimeLabel(endAt, isEnded),
	}
}
