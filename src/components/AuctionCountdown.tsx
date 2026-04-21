import { cn } from '@/lib/utils'
import { useEffect, useMemo, useState } from 'react'
import ProgressBar from './shared/ProgressBar'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import {
	getAuctionEffectiveEndAt,
	getAuctionEndAt,
	getAuctionId,
	getAuctionRootEventId,
	getAuctionStartAt,
	useAuctionBids,
} from '@/queries/auctions'
import { Badge } from './ui/badge'

type AuctionCountdownUrgency = 'calm' | 'lastDay' | 'lastHour' | 'endingSoon' | 'finalBids' | 'ended'

export interface AuctionCountdownState {
	now: number
	secondsRemaining: number
	isEnded: boolean
	urgency: AuctionCountdownUrgency
	displayLabel: string
	absoluteLabel: string
	totalDuration: number
}

function getUrgency(secondsRemaining: number): AuctionCountdownUrgency {
	if (secondsRemaining <= 0) return 'ended'
	if (secondsRemaining < 15) return 'finalBids' // < 15s - Final bids
	if (secondsRemaining <= 900) return 'endingSoon' // 15s - 15m (900s)
	if (secondsRemaining <= 3600) return 'lastHour' // 15m - 1h
	if (secondsRemaining <= 86400) return 'lastDay' // 1h - 24h
	return 'calm' // 24h+
}

// Helper to get the specific color based on urgency
function getProgressColor(urgency: AuctionCountdownUrgency): string {
	switch (urgency) {
		case 'calm':
			return '#18b9fe' // Light Blue
		case 'lastDay':
			return '#ffd53d' // Yellow
		case 'lastHour':
			return '#ff9f43' // Orange
		case 'endingSoon':
			return '#bf4040' // Red
		case 'finalBids':
			return '#ff3eb5' // Pink
		case 'ended':
			return '#e7e3e8' // White/Light Grey
		default:
			return '#18b9fe'
	}
}

/**
 * Formats seconds into a simple, human-readable string (e.g., "2 days left", "45 minutes left").
 * Prioritizes the largest unit of time.
 */
function formatTimeLeftSimple(seconds: number): string {
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
	// Fallback for very short times
	return `${secs} second${secs !== 1 ? 's' : ''} left`
}

/**
 * Formats seconds into a detailed countdown: DDd HH:MM:SS or HH:MM:SS or MM:SS.
 * - Always shows Minutes and Seconds (MM:SS).
 * - Shows Hours conditionally if > 1 hour.
 * - Shows Days conditionally if > 1 day.
 */
function formatCountdownDetailed(seconds: number): string {
	if (seconds <= 0) return '--:--'

	const days = Math.floor(seconds / 86400)
	const hours = Math.floor((seconds % 86400) / 3600)
	const minutes = Math.floor((seconds % 3600) / 60)
	const secs = seconds % 60

	// Format the core MM:SS part
	const mm = minutes.toString().padStart(2, '0')
	const ss = Math.round(secs).toString().padStart(2, '0')
	const coreTime = `${mm}:${ss}`

	// Add Hours if > 0 (but we only show HH if days are 0, otherwise we show days)
	// Actually, the prompt says: "hours and days should show conditionally if the time is larger than one hour and one day"
	// Usually, if days > 0, we show days. If days == 0 but hours > 0, we show hours.

	if (days > 0) {
		const hh = hours.toString().padStart(2, '0')
		return `${days}d ${hh}:${mm}:${ss}`
	}

	if (hours > 0) {
		const hh = hours.toString().padStart(2, '0')
		return `${hh}:${mm}:${ss}`
	}

	// If less than an hour, just MM:SS
	return coreTime
}

// Helper to format the End Time label (Today/Tomorrow/Date)
function formatEndTimeLabel(endTimestamp: number, isEnded: boolean): string {
	const endDate = new Date(endTimestamp * 1000)
	const now = new Date()

	// Normalize to start of day for comparison
	const endDateStr = endDate.toDateString()
	const todayStr = now.toDateString()

	// Check for tomorrow
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

// Map urgency to the new CSS class names
function getBadgeClassName(urgency: AuctionCountdownUrgency): string {
	switch (urgency) {
		case 'calm':
			return 'badge-info'
		case 'lastDay':
			return 'badge-warn'
		case 'lastHour':
			return 'badge-amber'
		case 'endingSoon':
			return 'badge-error'
		case 'finalBids':
			return 'badge-pink'
		default:
			return 'badge-neutral'
	}
}

export function useAuctionCountdown(endAt: number, options?: { showSeconds?: boolean }): AuctionCountdownState {
	const showSeconds = options?.showSeconds ?? false
	const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))

	useEffect(() => {
		if (!endAt) return

		const timer = window.setInterval(() => {
			setNow(Math.floor(Date.now() / 1000))
		}, 1000)

		return () => window.clearInterval(timer)
	}, [endAt])

	return useMemo(() => {
		const secondsRemaining = endAt > 0 ? Math.max(0, endAt - now) : 0
		const totalDuration = endAt > 0 ? endAt - (Math.floor(Date.now() / 1000) - secondsRemaining) : 0
		const safeTotalDuration = totalDuration > 0 ? totalDuration : 86400 * 30

		return {
			now,
			secondsRemaining,
			isEnded: endAt > 0 ? secondsRemaining <= 0 : false,
			urgency: endAt > 0 ? getUrgency(secondsRemaining) : 'ended',
			displayLabel: endAt > 0 ? 'Ended' : 'No end date',
			absoluteLabel: endAt > 0 ? new Date(endAt * 1000).toLocaleString() : 'No end date',
			totalDuration: safeTotalDuration,
		}
	}, [endAt, now, showSeconds])
}

export function AuctionCountdown({ auction, className, compact = false }: { auction: NDKEvent; className?: string; compact?: boolean }) {
	const auctionDTag = getAuctionId(auction)
	const auctionRootEventId = getAuctionRootEventId(auction)
	const auctionCoordinates = auctionDTag ? `30408:${auction.pubkey}:${auctionDTag}` : ''

	const bidsQuery = useAuctionBids(auctionRootEventId || auction.id, 500, auctionCoordinates)
	const bids = bidsQuery.data ?? []
	const endTime = getAuctionEndAt(auction)
	const endTimeEffective = getAuctionEffectiveEndAt(auction, bids) || endTime
	const currentTime = Date.now() / 1000
	const startTime = getAuctionStartAt(auction)

	const totalDuration = endTimeEffective - startTime
	const remaining = endTimeEffective - currentTime

	const urgency = getUrgency(remaining)
	const color = getProgressColor(urgency)

	// 1. Calculate Inverse Progress
	let progress = 0
	if (totalDuration > 0) {
		const elapsed = totalDuration - remaining
		progress = 1 - Math.min(Math.max(elapsed / totalDuration, 0), 1)
	}
	if (remaining < 0) progress = 1

	// 2. Configure ProgressBar Props based on Urgency
	const progressConfig = useMemo(() => {
		switch (urgency) {
			case 'calm':
				return { glow: false, stripeWidth: 20, stripeGap: 20, stripeOpacity: 0.15, stripeSpeed: 2.5, stripeAngle: 45 }
			case 'lastDay':
				return { glow: true, stripeWidth: 3, stripeGap: 10, stripeOpacity: 0.4, stripeSpeed: 1.5, stripeAngle: 45 }
			case 'lastHour':
				return { glow: true, stripeWidth: 3, stripeGap: 6, stripeOpacity: 0.6, stripeSpeed: 0.8, stripeAngle: 45 }
			case 'endingSoon':
				return { glow: true, stripeWidth: 3, stripeGap: 4, stripeOpacity: 0.8, stripeSpeed: 0.4, stripeAngle: 45 }
			case 'finalBids':
				return { glow: true, stripeWidth: 2, stripeGap: 2, stripeOpacity: 0.8, stripeSpeed: 0.2, stripeAngle: 45 }
			case 'ended':
				return { glow: false, stripeWidth: 0, stripeGap: 10, stripeOpacity: 0, stripeSpeed: 0, stripeAngle: 0 }
			default:
				return { glow: false, stripeWidth: 2, stripeGap: 8, stripeOpacity: 0.3, stripeSpeed: 1, stripeAngle: 45 }
		}
	}, [urgency])

	const badgeClass = getBadgeClassName(urgency)

	const contentTimeLeftDetailed = (
		<span className="text-foreground whitespace-nowrap text-base font-semibold">{formatCountdownDetailed(remaining)}</span>
	)

	return (
		<div className={cn('flex flex-col items-start gap-2', className)}>
			<div className="flex flex-row justify-between items-center w-full">
				<div className="flex flex-row gap-4 items-center">
					{/* Shadcn Badge Component */}
					<Badge
						variant="outline"
						className={cn(
							'px-3 py-1.5 text-xs font-semibold tracking-wide shadow-sm border-2',
							badgeClass,
							// Overrides for badge class (bg -> primary, fg -> primary fg, border -> primary border. No hover state)
							' bg-primary hover:bg-primary text-primary-foreground hover:text-primary-foreground border-primary-border hover:border-primary-border',
						)}
					>
						{formatTimeLeftSimple(remaining)}
					</Badge>
					{!compact && contentTimeLeftDetailed}
				</div>

				{/* Rightmost Element: "Absolute" end time */}
				{compact ? contentTimeLeftDetailed : <span className="text-foreground/80">{formatEndTimeLabel(endTime, remaining <= 0)}</span>}
			</div>

			{/* Progress Bar */}
			<div className="w-full">
				<ProgressBar progress={progress} color={color} fillDuration={1} height={16} {...progressConfig} />
			</div>
		</div>
	)
}
