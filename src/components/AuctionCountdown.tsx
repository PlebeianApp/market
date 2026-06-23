import { cn } from '@/lib/utils'
import { formatAuctionCountdownDetailed, formatAuctionEndTimeLabel, getAuctionCountdownLabels } from '@/lib/auctionCountdownLabels'
import { useEffect, useMemo, useState } from 'react'
import ProgressBar from './shared/ProgressBar'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { getAuctionBiddingCutoffAt, getAuctionStartAt } from '@/queries/auctions'

type AuctionCountdownUrgency = 'calm' | 'lastDay' | 'lastHour' | 'finalBids' | 'ended'

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
	if (secondsRemaining < 60) return 'finalBids' // < 1m - Final bids
	if (secondsRemaining <= 3600) return 'lastHour' // 1m - 1h
	if (secondsRemaining <= 86400) return 'lastDay' // 1h - 24h
	return 'calm' // 24h+
}

// Helper to get the specific color based on urgency
function getProgressColor(urgency: AuctionCountdownUrgency): string {
	switch (urgency) {
		case 'calm':
			return '#18b9fe' // Light Blue
		case 'lastDay':
			return '#ffc200' // Orange
		case 'lastHour':
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
}: {
	auction: NDKEvent
	/** Retained for source compatibility; fixed-window v1 cutoff no longer depends on bids. */
	bids?: NDKEvent[]
}) {
	const biddingCutoffAt = getAuctionBiddingCutoffAt(auction)
	const currentTime = Date.now() / 1000
	const startTime = getAuctionStartAt(auction)

	const totalDuration = biddingCutoffAt - startTime
	const remaining = biddingCutoffAt - currentTime

	const urgency = getUrgency(remaining)
	const color = getProgressColor(urgency)
	const isEnded = remaining <= 0
	const centerLabel = isEnded ? formatAuctionEndTimeLabel(biddingCutoffAt, true) : `${formatAuctionCountdownDetailed(remaining)} left`

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
				return { glow: false, stripeWidth: 26, stripeGap: 18, stripeOpacity: 0.15, stripeSpeed: 2.5, stripeHeight: 38 }
			case 'lastDay':
				return {
					glow: true,
					stripeWidth: 26,
					stripeGap: 14,
					stripeOpacity: 0.3,
					stripeSpeed: 1.2,
					stripeHeight: 38,
					backgroundColor: '#EEEEEE',
					textOnDark: false,
				}
			case 'lastHour':
				return { glow: true, stripeWidth: 26, stripeGap: 8, stripeOpacity: 0.4, stripeSpeed: 0.8, stripeHeight: 38 }
			case 'finalBids':
				return { glow: true, stripeWidth: 26, stripeGap: 2, stripeOpacity: 0.8, stripeSpeed: 0.4, stripeHeight: 38 }
			case 'ended':
				return {
					glow: false,
					stripeWidth: 0,
					stripeGap: 10,
					stripeOpacity: 0,
					stripeSpeed: 0,
					stripeAngle: 0,
					backgroundColor: '#EEEEEE',
					textOnDark: false,
				}
			default:
				return { glow: false, stripeWidth: 2, stripeGap: 8, stripeOpacity: 0.3, stripeSpeed: 1 }
		}
	}, [urgency])

	return (
		<div className="w-full">
			<ProgressBar label={centerLabel} progress={progress} color={color} fillDuration={1} {...progressConfig} />
		</div>
	)
}
