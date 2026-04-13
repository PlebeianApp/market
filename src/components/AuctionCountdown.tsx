import { cn } from '@/lib/utils'
import { useEffect, useMemo, useState } from 'react'
import ProgressBar from './shared/ProgressBar'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { getAuctionEndAt, getAuctionStartAt } from '@/queries/auctions'

type AuctionCountdownUrgency = 'calm' | 'hour' | 'minutes' | 'final' | 'ended'

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
	if (secondsRemaining <= 60) return 'final'
	if (secondsRemaining <= 600) return 'minutes'
	if (secondsRemaining <= 3600) return 'hour'
	return 'calm'
}

// Helper to get the specific color based on urgency
function getProgressColor(urgency: AuctionCountdownUrgency): string {
	switch (urgency) {
		case 'calm':
			return '#18b9fe' // Light Blue
		case 'hour':
			return '#ffd53d' // Yellow
		case 'minutes':
			return '#ff9f43' // Orange
		case 'final':
			return '#bf4040' // Red
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

export function AuctionCountdown({ auction, className }: { auction: NDKEvent; className?: string }) {
	const startTime = getAuctionStartAt(auction)
	const endTime = getAuctionEndAt(auction)
	const currentTime = Date.now() / 1000

	const totalDuration = endTime - startTime
	const remaining = endTime - currentTime

	const urgency = getUrgency(remaining)

	// 1. Calculate Inverse Progress
	let progress = 0
	if (totalDuration > 0) {
		const elapsed = totalDuration - remaining
		progress = Math.min(Math.max(elapsed / totalDuration, 0), 1)
	}
	if (remaining < 0) progress = 1

	// 2. Get Dynamic Color
	const color = getProgressColor(urgency)

	// 3. Configure ProgressBar Props based on Urgency
	const progressConfig = useMemo(() => {
		switch (urgency) {
			case 'calm':
				// Smooth gradient, slow, no glow
				return {
					glow: false,
					stripeWidth: 20, // Wide lines
					stripeGap: 20, // Same width = smooth gradient effect
					stripeOpacity: 0.15, // Very subtle
					stripeSpeed: 2.5, // Slow
					stripeAngle: 45,
				}
			case 'hour':
				// Yellow: Bars, medium speed, glow
				return {
					glow: true,
					stripeWidth: 3,
					stripeGap: 10,
					stripeOpacity: 0.4,
					stripeSpeed: 1.5,
					stripeAngle: 45,
				}
			case 'minutes':
				// Orange: Denser bars, faster, glow
				return {
					glow: true,
					stripeWidth: 3,
					stripeGap: 6,
					stripeOpacity: 0.6,
					stripeSpeed: 0.8,
					stripeAngle: 45,
				}
			case 'final':
				// Red: Dense bars, fast, strong glow
				return {
					glow: true,
					stripeWidth: 3,
					stripeGap: 4,
					stripeOpacity: 0.8,
					stripeSpeed: 0.4,
					stripeAngle: 45,
				}
			case 'ended':
				// White: No animation, solid
				return {
					glow: false,
					stripeWidth: 0, // No stripes
					stripeGap: 10,
					stripeOpacity: 0, // Transparent stripes = solid color
					stripeSpeed: 0, // No animation
					stripeAngle: 0,
				}
			default:
				return {
					glow: false,
					stripeWidth: 2,
					stripeGap: 8,
					stripeOpacity: 0.3,
					stripeSpeed: 1,
					stripeAngle: 45,
				}
		}
	}, [urgency])

	return (
		<div className={cn('inline-flex items-center justify-center', className)}>
			<ProgressBar
				progress={progress}
				color={color}
				fillDuration={1}
				height={16}
				// Spread the dynamic config
				{...progressConfig}
			/>
		</div>
	)
}
