import { cn } from '@/lib/utils'
import {
	formatAuctionCountdownDetailed,
	formatAuctionEndTimeLabel,
	formatAuctionStartsIn,
	getAuctionCountdownLabels,
} from '@/lib/auctionCountdownLabels'
import { useEffect, useMemo, useState } from 'react'
import ProgressBar from './shared/ProgressBar'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { getAuctionBiddingCutoffAt, getAuctionStartAt } from '@/queries/auctions'

type AuctionCountdownUrgency = 'calm' | 'lastDay' | 'lastHour' | 'finalBids' | 'ended' | 'scheduled'

export interface AuctionCountdownState {
	now: number
	secondsRemaining: number
	isEnded: boolean
	isScheduled: boolean
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

/**
 * Calculates pre-start fill progress: 0 at publish time, 1 when auction opens.
 * Exported so it can be unit-tested in isolation.
 */
export function computePreStartProgress(now: number, startAt: number, createdAt: number): number {
	if (startAt <= 0 || createdAt <= 0) return 0
	const total = startAt - createdAt
	if (total <= 0) return 0
	return Math.min(Math.max((now - createdAt) / total, 0), 1)
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
		case 'scheduled':
			return '#e7e3e8' // Neutral grey
		default:
			return '#18b9fe'
	}
}

export function useAuctionCountdown(endAt: number, options?: { showSeconds?: boolean; startAt?: number }): AuctionCountdownState {
	const showSeconds = options?.showSeconds ?? false
	const startAt = options?.startAt ?? 0
	const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))

	useEffect(() => {
		// Keep ticking while the auction is active (end) or still counting down to open (start)
		if (!endAt && !startAt) return

		const timer = window.setInterval(() => {
			setNow(Math.floor(Date.now() / 1000))
		}, 1000)

		return () => window.clearInterval(timer)
	}, [endAt, startAt])

	return useMemo(() => {
		const isScheduled = startAt > 0 && now < startAt
		const countdownLabels = getAuctionCountdownLabels(endAt, now, { showSeconds })
		const secondsRemaining = countdownLabels.secondsRemaining
		const totalDuration = endAt > 0 ? endAt - (Math.floor(Date.now() / 1000) - secondsRemaining) : 0
		const safeTotalDuration = totalDuration > 0 ? totalDuration : 86400 * 30

		return {
			now,
			secondsRemaining,
			isEnded: countdownLabels.isEnded,
			isScheduled,
			urgency: isScheduled ? 'scheduled' : endAt > 0 ? getUrgency(secondsRemaining) : 'ended',
			displayLabel: countdownLabels.displayLabel,
			absoluteLabel: countdownLabels.absoluteLabel,
			totalDuration: safeTotalDuration,
		}
	}, [endAt, startAt, now, showSeconds])
}

export function AuctionCountdown({
	auction,
}: {
	auction: NDKEvent
	/** Retained for source compatibility; fixed-window v1 cutoff no longer depends on bids. */
	bids?: NDKEvent[]
}) {
	const biddingCutoffAt = getAuctionBiddingCutoffAt(auction)
	const startTime = getAuctionStartAt(auction)
	const createdAt = auction.created_at ?? 0
	const now = Math.floor(Date.now() / 1000)

	const isScheduled = startTime > 0 && now < startTime
	const remaining = biddingCutoffAt - now
	const totalDuration = biddingCutoffAt - startTime
	const isEnded = !isScheduled && remaining <= 0

	// Pre-start: fill toward 100% as publish→startAt window closes.
	// Live: fill left→right as biddingCutoffAt approaches.
	let progress = 0
	if (isScheduled) {
		progress = computePreStartProgress(now, startTime, createdAt)
	} else if (totalDuration > 0) {
		const elapsed = totalDuration - remaining
		progress = Math.min(Math.max(elapsed / totalDuration, 0), 1)
	}
	if (!isScheduled && remaining < 0) progress = 1

	const urgency: AuctionCountdownUrgency = isScheduled ? 'scheduled' : isEnded ? 'ended' : getUrgency(remaining)
	const color = getProgressColor(urgency)

	const centerLabel = isScheduled
		? formatAuctionStartsIn(startTime - now)
		: isEnded
			? formatAuctionEndTimeLabel(biddingCutoffAt, true)
			: `${formatAuctionCountdownDetailed(remaining)} left`

	// Configure ProgressBar props based on urgency
	const progressConfig = useMemo(() => {
		switch (urgency) {
			case 'scheduled':
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
