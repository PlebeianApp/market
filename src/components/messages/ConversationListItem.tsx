import { UserWithAvatar } from '@/components/UserWithAvatar'
import { Link } from '@tanstack/react-router'

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
	const { pubkey, profile, lastMessageAt, lastMessageSnippet } = conversation
	const displayName = profile?.displayName || profile?.name || ''

	return (
		<Link
			to="/dashboard/sales/messages/$pubkey"
			params={{ pubkey }}
			className="block p-3 hover:bg-muted/50 rounded-lg transition-colors duration-150 ease-in-out w-full border bg-card shadow-sm mb-2"
			activeProps={{
				className: 'bg-muted',
			}}
		>
			<div className="flex flex-col gap-2 w-full">
				<div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 w-full">
					<div className="flex-shrink-0">
						<UserWithAvatar pubkey={pubkey} size="md" disableLink={true} />
					</div>

					<h3 className="text-sm font-medium truncate">{displayName}</h3>

					{lastMessageAt && (
						<span className="text-xs text-gray-500 whitespace-nowrap">
							{new Date(lastMessageAt * 1000).toLocaleString()}
						</span>
					)}
				</div>
				{/* Second row: message preview spanning full width */}
				<div className="w-full pl-12">
					<p className="text-sm text-gray-600 break-words">{lastMessageSnippet}</p>
				</div>
			</div>
		</Link>
	)
}
