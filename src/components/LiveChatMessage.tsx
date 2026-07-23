import type { LiveChatMessage } from '@/lib/nip53'
import { UserCard } from '@/components/UserCard'
import { ReactionsList } from '@/components/social/ReactionsList'
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
}

export function LiveChatMessageBubble({ message }: LiveChatMessageProps) {
	return (
		<div className="group flex gap-2 px-3 py-2 hover:bg-zinc-50">
			<div className="min-w-0 flex-1">
				<div className="flex items-baseline justify-between gap-2">
					<UserCard pubkey={message.authorPubkey} size="xs" />
					<span className="text-[10px] text-muted-foreground">{formatRelativeTime(message.createdAt)}</span>
				</div>
				<p className={cn('text-sm mt-2 break-words', 'text-muted-foreground')}>
					{message.content}
				</p>
				<ReactionsList event={message.event} showQuickAdd />
			</div>
		</div>
	)
}
