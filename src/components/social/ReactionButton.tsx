import { NDKEvent } from '@nostr-dev-kit/ndk'
import { usePublishDeletionMutation, usePublishReactionMutation } from '@/publish/reactions'
import { useEventReactions } from '@/queries/reactions'
import { useAuth } from '@/lib/stores/auth'
import { toast } from 'sonner'
import type { ButtonProps } from '@ui/components/ButtonProps'
import { ReactionButtonView } from '@ui/components/SocialButtons'

interface ReactionButtonProps extends ButtonProps {
	event: NDKEvent
}

export function ReactionButton({ event, onClick: _onClick, ...props }: ReactionButtonProps) {
	const { user, isAuthenticated } = useAuth()
	const { data: reactionsAll } = useEventReactions(event)
	const mutationPublish = usePublishReactionMutation()
	const mutationDelete = usePublishDeletionMutation()

	const latestReaction = reactionsAll?.filter((reaction) => reaction.authorPubkey == user?.pubkey)?.[0]

	const handlePublishReaction = async (emoji: string) => {
		if (!isAuthenticated || !emoji || !event.id || !event.pubkey) return
		await mutationPublish.mutateAsync({ emoji, event })
	}

	const handleDeleteReaction = async () => {
		if (!isAuthenticated || !latestReaction?.id || !latestReaction.authorPubkey) return
		await mutationDelete.mutateAsync({ reactionEvent: latestReaction })
	}

	return (
		<ReactionButtonView
			{...props}
			latestEmoji={latestReaction?.emoji ?? null}
			canPickEmoji={isAuthenticated}
			onPress={() => {
				if (!isAuthenticated) {
					toast.error('You must be logged in to react.')
					return
				}
				void (latestReaction ? handleDeleteReaction() : handlePublishReaction('❤️'))
			}}
			onSelectEmoji={(emoji) => void handlePublishReaction(emoji)}
			disabled={!event.ndk}
			tooltip={isAuthenticated ? undefined : 'React'}
		/>
	)
}
