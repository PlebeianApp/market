import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { UserWithAvatar } from '@/components/UserWithAvatar'
import { format } from 'date-fns' // For formatting timestamp

interface ChatMessageBubbleProps {
	event: NDKEvent
	isCurrentUser: boolean
}

export function ChatMessageBubble({ event, isCurrentUser }: ChatMessageBubbleProps) {
	const alignment = isCurrentUser ? 'justify-end' : 'justify-start'
	const bubbleStyles = isCurrentUser ? 'bg-primary text-primary-foreground' : 'bg-muted'

	const authorPubkey = event.pubkey
	const showAvatar = !isCurrentUser

	return (
		<div className={`flex items-end gap-2 ${alignment} mb-4`}>
			{showAvatar && (
				<div className="flex-shrink-0">
					<UserWithAvatar pubkey={authorPubkey} size="sm" />
				</div>
			)}
			<div className={`flex flex-col max-w-xs md:max-w-md lg:max-w-lg`}>
				<div className={`px-4 py-2 rounded-lg shadow ${bubbleStyles}`}>
					<p className="text-sm">{event.content}</p>
				</div>
				{event.created_at && (
					<span className={`text-xs text-gray-500 mt-1 ${isCurrentUser ? 'text-right' : 'text-left'}`}>
						{format(new Date(event.created_at * 1000), 'p')}
					</span>
				)}
			</div>
			{!showAvatar && (
				<div className="flex-shrink-0">
					{/* Placeholder for current user avatar if needed, or keep empty for bubble tail effect */}
					{/* <UserWithAvatar pubkey={authorPubkey} size="sm" /> */}
				</div>
			)}
		</div>
	)
}
