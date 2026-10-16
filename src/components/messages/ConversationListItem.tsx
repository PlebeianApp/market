import { useBreakpoint } from '@/hooks/useBreakpoint'
import { notificationStore } from '@/lib/stores/notifications'
import { useRouterState } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { ConversationListItemView } from '@ui/components/messages/MessagingViews'
import { UserCard } from '../UserCard'

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
	const { unseenByConversation } = useStore(notificationStore)
	const href = `/dashboard/sales/messages/${pubkey}`
	const isActive = useRouterState({ select: (state) => state.location.pathname === href })

	return (
		<ConversationListItemView
			href={href}
			userCard={<UserCard pubkey={pubkey} size="sm" onPress="none" />}
			lastMessageAt={lastMessageAt}
			lastMessageSnippet={lastMessageSnippet}
			unseenCount={unseenByConversation[pubkey] || 0}
			isMobile={breakpoint === 'sm'}
			isActive={isActive}
		/>
	)
}
