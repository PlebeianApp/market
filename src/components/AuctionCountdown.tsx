import { cn } from '@/lib/utils'
import { useEffect, useMemo, useState } from 'react'
import ProgressBar from './shared/ProgressBar'

type AuctionCountdownUrgency = 'calm' | 'hour' | 'minutes' | 'final' | 'ended'

export interface AuctionCountdownState {
	now: number
	secondsRemaining: number
	isEnded: boolean
	urgency: AuctionCountdownUrgency
	displayLabel: string
	absoluteLabel: string
	totalDuration: number // Added to help calculate progress
}

function getUrgency(secondsRemaining: number): AuctionCountdownUrgency {
	if (secondsRemaining <= 0) return 'ended'
	if (secondsRemaining <= 60) return 'final'
	if (secondsRemaining <= 600) return 'minutes'
	if (secondsRemaining <= 3600) return 'hour'
	return 'calm'
}

// Helper to get the specific color based on urgency
function getProgressColor(urgency: AuctionCountdownUrgency): string {
	switch (urgency) {
		case 'calm':
			return '#18b9fe' // Light Blue (>24h)
		case 'hour':
			return '#ffd53d' // Yellow (>6h)
		case 'minutes':
			return '#ff9f43' // Orange (>1h)
		case 'final':
			return '#bf4040' // Red (15m - 0m)
		case 'ended':
			return '#e7e3e8' // White/Light Grey (Finished)
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
		const secondsRemaining = endAt > 0 ? Math.max(0, endAt - now) : 0
		const totalDuration = endAt > 0 ? endAt - (Math.floor(Date.now() / 1000) - secondsRemaining) : 0

		// Fallback for totalDuration if start time is unknown, assume a large number or 0
		const safeTotalDuration = totalDuration > 0 ? totalDuration : 86400 * 30 // Default to 30 days if unknown

		return {
			now,
			secondsRemaining,
			isEnded: endAt > 0 ? secondsRemaining <= 0 : false,
			urgency: endAt > 0 ? getUrgency(secondsRemaining) : 'ended',
			displayLabel: endAt > 0 ? 'Ended' : 'No end date', // Simplified label
			absoluteLabel: endAt > 0 ? new Date(endAt * 1000).toLocaleString() : 'No end date',
			totalDuration: safeTotalDuration,
		}
	}, [endAt, now, showSeconds])
}

export function AuctionCountdown({
	endAt,
	countdown,
	className,
}: {
	endAt: number
	countdown?: AuctionCountdownState
	className?: string
}) {
	const state = countdown ?? useAuctionCountdown(endAt)

	// 1. Calculate Inverse Progress (0 = empty, 1 = full)
	// If ended, force to 1 (full) to show the "finished" color
	let progress = 0
	if (state.totalDuration > 0) {
		const elapsed = state.totalDuration - state.secondsRemaining
		progress = Math.min(Math.max(elapsed / state.totalDuration, 0), 1)
	}

	if (state.isEnded) {
		progress = 1 // Ensure bar is full when ended
	}

	// 2. Get Dynamic Color
	const color = getProgressColor(state.urgency)

	return (
		<div className={cn('inline-flex items-center justify-center', className)}>
			<ProgressBar progress={progress} color={color} height={12} maxWidth={120} fillDuration={1} />
		</div>
	)
}
