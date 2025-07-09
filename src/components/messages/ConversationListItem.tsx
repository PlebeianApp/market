import { useBreakpoint } from '@/hooks/useBreakpoint'
import { UserWithAvatar } from '@/components/UserWithAvatar'
import { Link } from '@tanstack/react-router'
import { DashboardListItem } from '../layout/DashboardListItem'
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

	const dateElement = lastMessageAt && (
		<span className="text-xs text-gray-500 whitespace-nowrap">{new Date(lastMessageAt * 1000).toLocaleString()}</span>
	)

	const triggerContent = <UserWithAvatar pubkey={pubkey} size="md" disableLink={true} showBadge={false} />
	const content = (
		<div className="w-full pl-10">
			<p className="text-sm text-gray-600 break-words">{lastMessageSnippet}</p>
		</div>
	)

	return (
		<Link
			to="/dashboard/sales/messages/$pubkey"
			params={{ pubkey }}
			className="block w-full"
			activeProps={{
				className: 'bg-muted/20',
			}}
		>
			<DashboardListItem
				isOpen={false}
				onOpenChange={() => {}}
				triggerContent={triggerContent}
				actions={dateElement}
				isCollapsible={false}
				icon={<MessageSquareText className="h-6 w-6 text-muted-foreground" />}
			>
				{content}
			</DashboardListItem>
		</Link>
	)
}
