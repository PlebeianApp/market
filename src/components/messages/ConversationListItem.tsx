import { useBreakpoint } from '@/hooks/useBreakpoint'
import { UserWithAvatar } from '@/components/UserWithAvatar'
import { Link } from '@tanstack/react-router'
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
			<Card className="p-4 hover:bg-muted/50 transition-colors">
				<div className="flex items-center gap-4">
					{/* Icon */}
					<div className="flex items-center justify-center w-10 h-10 border-2 border-black bg-transparent rounded-full shadow-md">
						<MessageSquareText className="h-5 w-5 text-black" />
					</div>

					{/* Content Block */}
					<div className="flex-1 flex flex-col gap-1">
						{/* Top Row: Avatar and Date */}
						<div className="flex items-center justify-between">
							<UserWithAvatar pubkey={pubkey} size="md" disableLink={true} showBadge={false} />
							{!isMobile && dateElement}
						</div>
						{/* Bottom Row: Snippet */}
						<div>
							<p className="text-sm text-muted-foreground break-words">{lastMessageSnippet}</p>
						</div>
						{isMobile && <div className="self-end mt-1">{dateElement}</div>}
					</div>
				</div>
			</Card>
		</Link>
	)
}
