import type { LiveChatMessage } from '@/lib/nip53'
import { UserCard } from '@/components/UserCard'
import { ReactionsList } from '@/components/social/ReactionsList'
import { configStore } from '@/lib/stores/config'
import { useStore } from '@tanstack/react-store'
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
	const cvmPubkey = useStore(configStore, (state) => state.config.cvmServerPubkey)
	const isSystemMessage = message.authorPubkey === cvmPubkey

	return (
		<div className={cn('group flex gap-2 px-3 py-2 hover:bg-zinc-50', isSystemMessage && 'bg-blue-50/50')}>
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
				{!isSystemMessage && <ReactionsList event={message.event} showQuickAdd />}
			</div>
		</div>
	)
}
