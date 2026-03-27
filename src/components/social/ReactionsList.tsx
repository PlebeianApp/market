import { groupReactionsByContent, useEventReactions, type Reaction } from '@/queries/reactions'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useState } from 'react'
import { Button } from '../ui/button'
import { useAuth } from '@/lib/stores/auth'
import { usePublishDeletionMutation, usePublishReactionMutation } from '@/publish/reactions'

// TODO: Add extends normal React Node/div properties
interface ReactionsListProps {
	event: NDKEvent
}

export const ReactionsList = ({ event }: ReactionsListProps) => {
	const { user, isAuthenticated } = useAuth()
	const { data: reactions } = useEventReactions(event)
	const reactionsGrouped = reactions && groupReactionsByContent(reactions)
	const reactionsOwnUser = reactions?.filter((reaction) => reaction.authorPubkey == user?.pubkey)

	const mutationPublish = usePublishReactionMutation()
	const mutationDelete = usePublishDeletionMutation()

	const handleReactionClick = (content: string) => {
		const reaction = reactionsOwnUser?.find((reaction) => reaction.emoji === content)

		if (reaction) {
			// If reaction has already been made by user, request deletion
			handleDeleteReaction(reaction)
		} else {
			// Else, add reaction to event
			handlePublishReaction(content)
		}
	}

	// Publish reaction when button is clicked
	const handlePublishReaction = async (emoji: string) => {
		if (!isAuthenticated) return

		if (!emoji || !event.id || !event.pubkey) return

		// Pass the event object directly to the mutation
		await mutationPublish.mutateAsync({
			emoji,
			event,
		})
	}

	// Delete the reaction selected
	const handleDeleteReaction = async (reaction: Reaction) => {
		if (!isAuthenticated) return

		if (!reaction.id || !reaction.authorPubkey) return

		// Pass the event object directly to the mutation
		await mutationDelete.mutateAsync({
			reactionEvent: reaction,
		})
	}

	return (
		<>
			<div className="flex flex-wrap gap-1" data-testid="reactions-list">
				{reactionsGrouped && reactionsGrouped.size > 0
					? Array.from(reactionsGrouped.entries()).map(([content, values]) => (
							<Button
								key={content}
								variant="outline"
								size="sm"
								className={
									'rounded-full py-1 px-2 ' +
									(reactionsOwnUser?.find((r) => r.emoji == content)
										? // If user had this reaction
											'bg-secondary hover:bg-secondary/80 text-white hover:text-white'
										: // Else
											'bg-primary-foreground hover:primary-foreground-hover text-black')
								}
								onClick={() => handleReactionClick(content)}
							>
								<span className="text-lg">{content}</span>
								<span className="ml-1">{values.length}</span>
							</Button>
						))
					: null}
			</div>
		</>
	)
}
