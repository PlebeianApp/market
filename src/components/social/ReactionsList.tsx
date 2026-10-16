import { groupReactionsByContent, useEventReactions, type Reaction } from '@/queries/reactions'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useAuth } from '@/lib/stores/auth'
import { usePublishDeletionMutation, usePublishReactionMutation } from '@/publish/reactions'
import { ReactionsListView } from '@ui/components/SocialLists'

interface ReactionsListProps {
	event: NDKEvent
	asChildren?: boolean
}

export const ReactionsList = ({ event, asChildren = false }: ReactionsListProps) => {
	const { user, isAuthenticated } = useAuth()
	const { data: reactions } = useEventReactions(event)
	const reactionsGrouped = reactions && groupReactionsByContent(reactions)
	const reactionsOwnUser = reactions?.filter((reaction) => reaction.authorPubkey == user?.pubkey)

	const mutationPublish = usePublishReactionMutation()
	const mutationDelete = usePublishDeletionMutation()

	const handlePublishReaction = async (emoji: string) => {
		if (!isAuthenticated || !emoji || !event.id || !event.pubkey) return
		await mutationPublish.mutateAsync({ emoji, event })
	}

	const handleDeleteReaction = async (reaction: Reaction) => {
		if (!isAuthenticated || !reaction.id || !reaction.authorPubkey) return
		await mutationDelete.mutateAsync({ reactionEvent: reaction })
	}

	const handleToggle = (emoji: string) => {
		const own = reactionsOwnUser?.find((reaction) => reaction.emoji === emoji)
		void (own ? handleDeleteReaction(own) : handlePublishReaction(emoji))
	}

	const groups = Array.from(reactionsGrouped?.entries() ?? []).map(([emoji, values]) => ({
		emoji,
		count: values.length,
		isOwn: !!reactionsOwnUser?.some((reaction) => reaction.emoji == emoji),
	}))

	return <ReactionsListView groups={groups} onToggle={handleToggle} asChildren={asChildren} />
}
