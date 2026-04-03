import { useZapsViaProvider } from '@/queries/zaps'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { Zap, ZapOff, MessageSquare } from 'lucide-react' // Icons
import { Button } from '../ui/button'
import { cn } from '@/lib/utils' // Assuming you have a cn utility for class merging
import { AvatarUser } from '../AvatarUser'

interface ZapsListProps {
	event: NDKEvent
	asChildren?: boolean
}

export const ZapsList = ({ event, asChildren = false }: ZapsListProps) => {
	const { data: zaps } = useZapsViaProvider(event)

	if (!zaps || zaps.length === 0) {
		return null
	}

	// Format amount helper
	const formatAmount = (amount: number, type: 'lightning' | 'nutzap', unit?: string) => {
		if (type === 'lightning') {
			// Convert millisats to sats for display
			const sats = amount / 1000
			return sats.toLocaleString()
		}
		// Nutzap
		const val = unit === 'sat' ? amount : amount.toFixed(2)
		return val
	}

	const children = zaps.map((zap) => {
		// const isLightning = zap.type === 'lightning'
		// const data = zap.data as UnifiedZap['data'] // Type narrowing for cleaner access

		// Truncate message if too long
		const message = zap.message || ''
		const displayMessage = message.length > 40 ? message.substring(0, 40) + '...' : message

		return (
			<Button
				key={zap.id}
				variant="primary"
				size="sm"
				className="rounded-full py-1 pl-1 pr-4 flex items-center gap-2 h-auto min-h-[32px] border-light-gray transition-colors"
				// Optional: Add click handler to view details or send a reply
				// onClick={() => handleZapClick(zap)}
			>
				{/* Avatar */}
				<AvatarUser pubkey={zap.senderPubkey} className="w-1.1 h-1.1 shrink-0 border-white" />

				{/* Amount & Icon */}
				<div className="flex items-center gap-1 shrink-0">
					<Zap className={'w-4 h-4'} />
					<span className="font-medium text-xs tabular-nums">{formatAmount(zap.amountMillisats, 'lightning')}</span>
				</div>

				{/* Message (if any) */}
				{displayMessage && (
					<div className="flex items-center gap-1 text-xs max-w-[150px] truncate">
						<span className="truncate">{displayMessage}</span>
					</div>
				)}
			</Button>
		)
	})

	if (asChildren) {
		return children
	}

	return (
		<div className="flex flex-wrap gap-2" data-testid="zaps-list">
			{children}
		</div>
	)
}
