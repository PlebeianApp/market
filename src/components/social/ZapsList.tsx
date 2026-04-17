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
				size="sm"
				className="flex items-center gap-2 py-1 pr-4 pl-1 border-light-gray rounded-full h-auto min-h-[32px] transition-colors"
				// Optional: Add click handler to view details or send a reply
				// onClick={() => handleZapClick(zap)}
			>
				{/* Avatar */}
				<AvatarUser pubkey={zap.senderPubkey} className="border-white w-1.1 h-1.1 shrink-0" />

				{/* Amount & Icon */}
				<div className="flex items-center gap-1 shrink-0">
					<Zap className={'w-4 h-4'} />
					<span className="font-medium tabular-nums text-xs">{formatAmount(zap.amountMillisats, 'lightning')}</span>
				</div>

				{/* Message (if any) */}
				{displayMessage && (
					<div className="flex items-center gap-1 max-w-[150px] text-xs truncate">
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
