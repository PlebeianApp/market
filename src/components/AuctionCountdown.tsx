import { cn } from '@/lib/utils'
import { formatAuctionCountdownDetailed, formatAuctionEndTimeLabel, getAuctionCountdownLabels } from '@/lib/auctionCountdownLabels'
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
		const countdownLabels = getAuctionCountdownLabels(endAt, now, { showSeconds })
		const secondsRemaining = countdownLabels.secondsRemaining
		const totalDuration = endAt > 0 ? endAt - (Math.floor(Date.now() / 1000) - secondsRemaining) : 0
		const safeTotalDuration = totalDuration > 0 ? totalDuration : 86400 * 30

		return {
			now,
			secondsRemaining,
			isEnded: countdownLabels.isEnded,
			urgency: endAt > 0 ? getUrgency(secondsRemaining) : 'ended',
			displayLabel: countdownLabels.displayLabel,
			absoluteLabel: countdownLabels.absoluteLabel,
			totalDuration: safeTotalDuration,
		}
	}, [endAt, now, showSeconds])
}

export function AuctionCountdown({
	auction,
	bids: bidsProp,
	className,
	compact = false,
}: {
	auction: NDKEvent
	/** Pre-fetched bids from a parent. Skip the internal bid subscription when provided. */
	bids?: NDKEvent[]
	className?: string
	compact?: boolean
}) {
	const auctionDTag = getAuctionId(auction)
	const auctionRootEventId = getAuctionRootEventId(auction)
	const auctionCoordinates = auctionDTag ? `30408:${auction.pubkey}:${auctionDTag}` : ''

	const shouldFetchBids = bidsProp === undefined
	const bidsQuery = useAuctionBids(
		shouldFetchBids ? auctionRootEventId || auction.id : '',
		500,
		shouldFetchBids ? auctionCoordinates : undefined,
	)
	const bids = bidsProp ?? bidsQuery.data ?? []
	const endTime = getAuctionEndAt(auction)
	const endTimeEffective = getAuctionEffectiveEndAt(auction, bids) || endTime
	const currentTime = Date.now() / 1000
	const startTime = getAuctionStartAt(auction)

	const totalDuration = endTimeEffective - startTime
	const remaining = endTimeEffective - currentTime

	const urgency = getUrgency(remaining)
	const color = getProgressColor(urgency)
	const isEnded = remaining <= 0
	const centerLabel = isEnded ? formatAuctionEndTimeLabel(endTimeEffective, true) : `${formatAuctionCountdownDetailed(remaining)} left`

	// 1. Calculate forward progress so the bar fills from left to right as time runs out.
	let progress = 0
	if (totalDuration > 0) {
		const elapsed = totalDuration - remaining
		progress = Math.min(Math.max(elapsed / totalDuration, 0), 1)
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

	return (
		<div className={cn('flex flex-col items-start gap-2', className)}>
			<div className="w-full">
				<div className="relative overflow-hidden rounded-md w-full">
					<ProgressBar progress={progress} color={color} fillDuration={1} height={28} badgeStyle {...progressConfig} />
					<div className="absolute inset-0 flex items-center justify-center px-2 pointer-events-none">
						<span className={cn('text-foreground font-semibold max-w-full truncate', isEnded ? 'text-xs' : 'text-sm whitespace-nowrap')}>
							{centerLabel}
						</span>
					</div>
				</div>
			</div>

			{/* Non-compact metadata line sits below the badge to avoid squeezing the bar. */}
			{compact || isEnded ? null : (
				<span className="text-foreground/80 text-end w-full">{formatAuctionEndTimeLabel(endTimeEffective, false)}</span>
			)}
		</div>
	)
}
