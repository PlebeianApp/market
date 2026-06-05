import { useStore } from '@tanstack/react-store'
import { useMemo } from 'react'
import { ndkActions, ndkStore, type ConnectionHealth } from '@/lib/stores/ndk'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * Small pill in the header that surfaces the current relay-connection
 * health. Stays invisible in the happy path (`connected`) so it doesn't
 * add visual noise; only renders when something is wrong or in flight.
 *
 * Backed by `ndkStore.health` which the connection watchdog
 * (`startConnectionWatchdog` in `src/lib/stores/ndk.ts`) keeps in sync
 * via pool events + a 30s tick + visibilitychange. Clicking the pill
 * fires `ndkActions.connect()` so the user can manually kick a
 * reconnect if they get impatient.
 */
export function ConnectionStatusPill() {
	const { health, connectedRelayCount, explicitRelayUrls } = useStore(ndkStore)

	const meta = useMemo(
		() => describeHealth(health, connectedRelayCount, explicitRelayUrls.length),
		[health, connectedRelayCount, explicitRelayUrls.length],
	)

	if (!meta) return null

	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						data-testid="connection-status-pill"
						data-health={health}
						onClick={() => void ndkActions.connect()}
						className={cn(
							'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
							'border focus:outline-none focus:ring-1 focus:ring-white/40',
							meta.colors,
						)}
					>
						<span className={cn('h-2 w-2 rounded-full', meta.dot, meta.pulse && 'animate-pulse')} />
						<span className="hidden sm:inline">{meta.label}</span>
					</button>
				</TooltipTrigger>
				<TooltipContent side="bottom" align="end">
					<div className="text-xs">
						<div>{meta.tooltip}</div>
						<div className="opacity-60 mt-1">
							{connectedRelayCount}/{explicitRelayUrls.length} relays connected
						</div>
						<div className="opacity-60 mt-1">Click to retry</div>
					</div>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	)
}

interface PillMeta {
	label: string
	tooltip: string
	colors: string
	dot: string
	pulse: boolean
}

function describeHealth(health: ConnectionHealth, connectedCount: number, totalCount: number): PillMeta | null {
	switch (health) {
		case 'connected':
			// Happy path — render nothing.
			return null
		case 'connecting':
			return {
				label: 'Connecting',
				tooltip: 'Establishing connection to relays…',
				colors: 'bg-yellow-500/10 border-yellow-500/40 text-yellow-200',
				dot: 'bg-yellow-400',
				pulse: true,
			}
		case 'reconnecting':
			return {
				label: 'Reconnecting',
				tooltip:
					connectedCount === 0
						? 'Lost connection to all relays — attempting to reconnect.'
						: `Reconnecting (${connectedCount}/${totalCount} relays up).`,
				colors: 'bg-orange-500/10 border-orange-500/40 text-orange-200',
				dot: 'bg-orange-400',
				pulse: true,
			}
		case 'offline':
			return {
				label: 'Offline',
				tooltip: 'Cannot reach any relays. Check your network connection.',
				colors: 'bg-red-500/10 border-red-500/50 text-red-200',
				dot: 'bg-red-500',
				pulse: false,
			}
		case 'unknown':
		default:
			// Pre-boot — render nothing rather than showing a misleading state.
			return null
	}
}
