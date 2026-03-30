import { cn } from '@/lib/utils'
import { Clock3 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

type AuctionCountdownUrgency = 'calm' | 'hour' | 'minutes' | 'final' | 'ended'

type AuctionCountdownVariant = 'inline' | 'panel'

export interface AuctionCountdownState {
	now: number
	secondsRemaining: number
	isEnded: boolean
	urgency: AuctionCountdownUrgency
	displayLabel: string
	absoluteLabel: string
}

function getUrgency(secondsRemaining: number): AuctionCountdownUrgency {
	if (secondsRemaining <= 0) return 'ended'
	if (secondsRemaining <= 60) return 'final'
	if (secondsRemaining <= 600) return 'minutes'
	if (secondsRemaining <= 3600) return 'hour'
	return 'calm'
}

function formatAuctionCountdown(secondsRemaining: number, showSeconds: boolean): string {
	if (secondsRemaining <= 0) return 'Ended'

	const days = Math.floor(secondsRemaining / 86400)
	const hours = Math.floor((secondsRemaining % 86400) / 3600)
	const minutes = Math.floor((secondsRemaining % 3600) / 60)
	const seconds = secondsRemaining % 60

	const parts: string[] = []
	if (days > 0) parts.push(`${days}d`)
	if (hours > 0 || days > 0) parts.push(`${hours.toString().padStart(days > 0 ? 2 : 1, '0')}h`)
	if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes.toString().padStart(hours > 0 || days > 0 ? 2 : 1, '0')}m`)
	if (showSeconds || parts.length === 0) parts.push(`${seconds.toString().padStart(parts.length > 0 ? 2 : 1, '0')}s`)

	return parts.join(' ')
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
		return {
			now,
			secondsRemaining,
			isEnded: endAt > 0 ? secondsRemaining <= 0 : false,
			urgency: endAt > 0 ? getUrgency(secondsRemaining) : 'calm',
			displayLabel: endAt > 0 ? formatAuctionCountdown(secondsRemaining, showSeconds) : 'No end date',
			absoluteLabel: endAt > 0 ? new Date(endAt * 1000).toLocaleString() : 'No end date',
		}
	}, [endAt, now, showSeconds])
}

const urgencyClasses: Record<AuctionCountdownUrgency, { shell: string; dot: string; text: string }> = {
	calm: {
		shell: 'border-zinc-200 bg-zinc-50 text-zinc-700',
		dot: 'bg-zinc-400',
		text: 'text-zinc-900',
	},
	hour: {
		shell: 'border-amber-200 bg-amber-50 text-amber-800',
		dot: 'bg-amber-500',
		text: 'text-amber-950',
	},
	minutes: {
		shell: 'border-orange-300 bg-orange-50 text-orange-900',
		dot: 'bg-orange-500',
		text: 'text-orange-950',
	},
	final: {
		shell: 'border-rose-300 bg-rose-50 text-rose-900 shadow-[0_0_0_1px_rgba(244,63,94,0.08)]',
		dot: 'bg-rose-500',
		text: 'text-rose-950',
	},
	ended: {
		shell: 'border-rose-300 bg-rose-100 text-rose-900',
		dot: 'bg-rose-700',
		text: 'text-rose-950',
	},
}

export function AuctionCountdown({
	endAt,
	countdown,
	showSeconds = false,
	variant = 'inline',
	label = 'Ends in',
	endedLabel = 'Auction ended',
	showAbsoluteTime = false,
	className,
}: {
	endAt: number
	countdown?: AuctionCountdownState
	showSeconds?: boolean
	variant?: AuctionCountdownVariant
	label?: string
	endedLabel?: string
	showAbsoluteTime?: boolean
	className?: string
}) {
	const state = countdown ?? useAuctionCountdown(endAt, { showSeconds })
	const urgency = urgencyClasses[state.urgency]
	const displayTitle = state.isEnded ? endedLabel : label

	if (variant === 'panel') {
		return (
			<div className={cn('rounded-xl border p-4', urgency.shell, className)} title={state.absoluteLabel}>
				<div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em]">
					<span className={cn('h-2.5 w-2.5 rounded-full', urgency.dot)} />
					<Clock3 className="h-3.5 w-3.5" />
					<span>{displayTitle}</span>
				</div>
				<div className={cn('mt-3 font-mono text-2xl font-semibold tabular-nums tracking-tight', urgency.text)}>{state.displayLabel}</div>
				{showAbsoluteTime && <div className="mt-2 text-xs opacity-75">Closes {state.absoluteLabel}</div>}
			</div>
		)
	}

	return (
		<div
			className={cn('inline-flex min-w-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium', urgency.shell, className)}
			title={state.absoluteLabel}
		>
			<span className={cn('h-2 w-2 shrink-0 rounded-full', urgency.dot)} />
			<Clock3 className="h-3.5 w-3.5 shrink-0" />
			<span className="truncate uppercase tracking-[0.14em]">{displayTitle}</span>
			<span className={cn('font-mono text-sm font-semibold tabular-nums tracking-tight', urgency.text)}>{state.displayLabel}</span>
		</div>
	)
}
