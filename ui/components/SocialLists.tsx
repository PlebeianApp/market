import type { ReactNode } from 'react'
import { Zap } from 'lucide-react'
import { Button } from '../primitives/button'

export interface ZapListItem {
	id: string
	senderPubkey: string
	amountMillisats: number
	message?: string
}

export interface ZapsListViewProps {
	zaps: readonly ZapListItem[]
	renderAvatar: (pubkey: string, className: string) => ReactNode
	/** Return the chips without the wrapper, for callers that lay them out themselves. */
	asChildren?: boolean
}

function truncateMessage(message: string): string {
	return message.length > 40 ? message.substring(0, 40) + '...' : message
}

export function ZapsListView({ zaps, renderAvatar, asChildren = false }: ZapsListViewProps) {
	if (zaps.length === 0) return null

	const children = zaps.map((zap) => {
		const displayMessage = truncateMessage(zap.message || '')
		return (
			<Button
				key={zap.id}
				size="sm"
				className="flex items-center gap-2 py-1 pr-4 pl-1 border-light-gray rounded-full h-auto min-h-[32px] transition-colors"
			>
				{renderAvatar(zap.senderPubkey, 'border-white w-1.1 h-1.1 shrink-0')}
				<div className="flex items-center gap-1 shrink-0">
					<Zap className="w-4 h-4" />
					<span className="font-medium tabular-nums text-xs">{(zap.amountMillisats / 1000).toLocaleString()}</span>
				</div>
				{displayMessage && (
					<div className="flex items-center gap-1 max-w-[150px] text-xs truncate">
						<span className="truncate">{displayMessage}</span>
					</div>
				)}
			</Button>
		)
	})

	if (asChildren) return <>{children}</>

	return (
		<div className="flex flex-wrap gap-2" data-testid="zaps-list">
			{children}
		</div>
	)
}

export interface ReactionGroup {
	emoji: string
	count: number
	/** The viewer has reacted with this emoji. */
	isOwn: boolean
}

export interface ReactionsListViewProps {
	groups: readonly ReactionGroup[]
	onToggle: (emoji: string) => void
	asChildren?: boolean
}

export function ReactionsListView({ groups, onToggle, asChildren = false }: ReactionsListViewProps) {
	const children = groups.map((group) => (
		<Button
			key={group.emoji}
			variant="outline"
			size="sm"
			className={
				'rounded-full py-1 px-2 ' +
				(group.isOwn
					? 'bg-neo-purple hover:bg-neo-purple/80 text-white hover:text-white'
					: 'bg-purple-50 text-black hover:bg-pink-100 hover:text-black')
			}
			onClick={() => onToggle(group.emoji)}
		>
			<span className="text-lg">{group.emoji}</span>
			<span className="ml-1">{group.count}</span>
		</Button>
	))

	if (asChildren) return <>{children}</>

	return (
		<div className="flex flex-wrap gap-1" data-testid="reactions-list">
			{children}
		</div>
	)
}
