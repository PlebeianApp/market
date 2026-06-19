import { useState } from 'react'
import type { LiveChatMessage } from '@/lib/nip53'
import { UserCard } from '@/components/UserCard'
import { configStore } from '@/lib/stores/config'
import { Button } from './ui/button'
import { cn } from '@/lib/utils'

function formatRelativeTime(timestamp: number): string {
	const seconds = Math.floor(Date.now() / 1000) - timestamp
	if (seconds < 60) return 'just now'
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
	return `${Math.floor(seconds / 86400)}d`
}

interface LiveChatMessageProps {
	message: LiveChatMessage
	reactions?: Record<string, number>
	onReact?: (messageId: string, emoji: string) => void
}

const QUICK_REACTIONS = ['👍', '🔥', '❤️']

export function LiveChatMessageBubble({ message, reactions, onReact }: LiveChatMessageProps) {
	const [showReactions, setShowReactions] = useState(false)
	const cvmPubkey = configStore.state.config.cvmServerPubkey
	const isSystemMessage = message.authorPubkey === cvmPubkey

	return (
		<div
			className={cn('group flex gap-2 px-3 py-2 hover:bg-zinc-50', isSystemMessage && 'bg-blue-50/50')}
			onMouseEnter={() => setShowReactions(true)}
			onMouseLeave={() => setShowReactions(false)}
		>
			<div className="min-w-0 flex-1">
				<div className="flex items-baseline justify-between gap-2">
					<div className="flex items-center gap-1.5">
						{isSystemMessage && (
							<span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-blue-600">System</span>
						)}
						<UserCard pubkey={message.authorPubkey} size="xs" />
					</div>
					<span className="text-[10px] text-muted-foreground">{formatRelativeTime(message.createdAt)}</span>
				</div>
				<p className={cn('text-sm mt-2 break-words', isSystemMessage ? 'text-blue-700 font-medium' : 'text-muted-foreground')}>
					{message.content}
				</p>

				{/* Reaction display + quick reaction bar */}
				<div className="mt-1 flex items-center gap-1">
					{reactions &&
						Object.entries(reactions).map(([emoji, count]) => (
							<span key={emoji} className="inline-flex items-center gap-0.5 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-600">
								{emoji} {count}
							</span>
						))}

					{showReactions && onReact && !isSystemMessage && (
						<div className="flex gap-0.5">
							{QUICK_REACTIONS.map((emoji) => (
								<button
									key={emoji}
									onClick={() => onReact(message.id, emoji)}
									className="rounded p-1 text-xs hover:bg-zinc-200 transition-colors"
								>
									{emoji}
								</button>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	)
}
