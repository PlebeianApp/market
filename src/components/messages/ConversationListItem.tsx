import { UserWithAvatar } from '@/components/UserWithAvatar'
import { formatDistanceToNow } from 'date-fns'
import { Link } from '@tanstack/react-router'

export interface ConversationItemData {
	pubkey: string
	profile: { displayName?: string; name?: string; avatar?: string } | undefined
	lastMessageAt: number | undefined
	lastMessageSnippet: string
	lastMessageKind: number | undefined
}

interface ConversationListItemProps {
	conversation: ConversationItemData
}

export function ConversationListItem({ conversation }: ConversationListItemProps) {
	const { pubkey, profile, lastMessageAt, lastMessageSnippet } = conversation
	const displayName = profile?.displayName || profile?.name || pubkey.substring(0, 10) + '...'

	return (
		<Link
			to="/dashboard/sales/messages/$pubkey"
			params={{ pubkey }}
			className="flex flex-col p-3 hover:bg-muted/50 rounded-lg transition-colors duration-150 ease-in-out w-full border bg-card shadow-sm mb-2"
			activeProps={{
				className: 'bg-muted font-semibold',
			}}
		>
			<div className="flex items-start gap-3 w-full">
				<div className="flex-shrink-0">
					<UserWithAvatar pubkey={pubkey} size="md" disableLink={true} />
				</div>
				<div className="flex-1 min-w-0 overflow-hidden">
					<div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1 sm:gap-2">
						<h3 className="text-sm font-medium truncate">{displayName}</h3>
						{lastMessageAt && (
							<span className="text-xs text-gray-500 whitespace-nowrap">
								{formatDistanceToNow(new Date(lastMessageAt * 1000), { addSuffix: true })}
							</span>
						)}
					</div>
					<p className="text-xs text-gray-600 break-words line-clamp-2 mt-0.5">{lastMessageSnippet}</p>
				</div>
			</div>
		</Link>
	)
}
