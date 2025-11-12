import { useBreakpoint } from '@/hooks/useBreakpoint'
import { UserWithAvatar } from '@/components/UserWithAvatar'
import { notificationStore } from '@/lib/stores/notifications'
import { Link } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { Card } from '@/components/ui/card'
import { MessageSquareText } from 'lucide-react'

export interface ConversationItemData {
	pubkey: string
	profile: { displayName?: string; name?: string; avatar?: string } | undefined
	lastMessageAt: number | undefined
	lastMessageSnippet: string
	lastMessageKind: number | undefined
	isUnread?: boolean
}

interface ConversationListItemProps {
	conversation: ConversationItemData
}

export function ConversationListItem({ conversation }: ConversationListItemProps) {
	const { pubkey, lastMessageAt, lastMessageSnippet } = conversation
	const breakpoint = useBreakpoint()
	const isMobile = breakpoint === 'sm'
	const { unseenByConversation } = useStore(notificationStore)

	// Get unseen count for this conversation
	const unseenCount = unseenByConversation[pubkey] || 0

	const dateElement = lastMessageAt && (
		<span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(lastMessageAt * 1000).toLocaleString()}</span>
	)

	return (
		<Link
			to={`/dashboard/sales/messages/${pubkey}`}
			className="block w-full"
			activeProps={{
				className: 'bg-muted/20 rounded-lg',
			}}
		>
			<Card className="p-4 hover:bg-muted/50 transition-colors relative">
				{/* Unseen indicator badge */}
				{unseenCount > 0 && (
					<div className="absolute top-2 right-2 inline-flex items-center justify-center min-w-[1.5rem] h-6 px-2 text-xs font-bold text-white bg-pink-500 rounded-full">
						{unseenCount > 99 ? '99+' : unseenCount}
					</div>
				)}

				<div className="flex items-center gap-4">
					{/* Icon */}
					<div className="p-2 bg-muted rounded-full">
						<MessageSquareText className="h-6 w-6 text-muted-foreground" />
					</div>

					{/* Content Block */}
					<div className="flex-1 flex flex-col gap-1">
						{/* Top Row: Avatar and Date */}
						<div className="flex items-center justify-between">
							<UserWithAvatar pubkey={pubkey} size="md" disableLink={true} showBadge={false} />
							{!isMobile && dateElement}
						</div>
						{/* Bottom Row: Snippet */}
						<div className="pr-12">
							<p className={`text-sm break-words ${unseenCount > 0 ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
								{lastMessageSnippet}
							</p>
						</div>
						{isMobile && <div className="self-end mt-1">{dateElement}</div>}
					</div>
				</div>
			</Card>
		</Link>
	)
}
