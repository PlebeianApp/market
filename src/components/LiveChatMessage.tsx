import { AvatarUser } from '@/components/AvatarUser'
import type { LiveChatMessage } from '@/lib/nip53'

function shortenHex(value: string, left: number = 10, right: number = 8): string {
	if (!value) return 'N/A'
	if (value.length <= left + right + 1) return value
	return `${value.slice(0, left)}...${value.slice(-right)}`
}

function formatRelativeTime(timestamp: number): string {
	const seconds = Math.floor(Date.now() / 1000) - timestamp
	if (seconds < 60) return 'just now'
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
	return `${Math.floor(seconds / 86400)}d`
}

interface LiveChatMessageProps {
	message: LiveChatMessage
}

export function LiveChatMessageBubble({ message }: LiveChatMessageProps) {
	return (
		<div className="flex gap-2 px-3 py-2 hover:bg-zinc-50">
			<div className="shrink-0 pt-0.5">
				<AvatarUser pubkey={message.authorPubkey} className="h-6 w-6" />
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex items-baseline gap-2">
					<span className="text-xs font-medium text-zinc-700">{shortenHex(message.authorPubkey, 6, 4)}</span>
					<span className="text-[10px] text-zinc-400">{formatRelativeTime(message.createdAt)}</span>
				</div>
				<p className="text-sm text-zinc-800 break-words">{message.content}</p>
			</div>
		</div>
	)
}
