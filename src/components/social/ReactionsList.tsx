import { groupReactionsByContent, useEventReactions, type Reaction } from '@/queries/reactions'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useState } from 'react'
import { Button } from '../ui/button'
import { useAuth } from '@/lib/stores/auth'
import { usePublishDeletionMutation, usePublishReactionMutation } from '@/publish/reactions'

interface ReactionsListProps {
	event: NDKEvent
	asChildren?: boolean
	/** Show quick-add emoji buttons on hover (for live chat messages) */
	showQuickAdd?: boolean
	/** Quick-add emojis to preview (default: 👍 🔥 ❤️) */
	quickAddEmojis?: string[]
}

const DEFAULT_QUICK_ADD = ['👍', '🔥', '❤️']

export const ReactionsList = ({
	event,
	asChildren = false,
	showQuickAdd = false,
	quickAddEmojis = DEFAULT_QUICK_ADD,
}: ReactionsListProps) => {
	const { user, isAuthenticated } = useAuth()
	const { data: reactions } = useEventReactions(event)
	const reactionsGrouped = reactions && groupReactionsByContent(reactions)
	const reactionsOwnUser = reactions?.filter((reaction) => reaction.authorPubkey == user?.pubkey)
	const [showQuickButtons, setShowQuickButtons] = useState(false)

	const mutationPublish = usePublishReactionMutation()
	const mutationDelete = usePublishDeletionMutation()

	const handleReactionClick = (content: string) => {
		const reaction = reactionsOwnUser?.find((reaction) => reaction.emoji === content)

		if (reaction) {
			handleDeleteReaction(reaction)
		} else {
			handlePublishReaction(content)
		}
	}

	const handlePublishReaction = async (emoji: string) => {
		if (!isAuthenticated) return
		if (!emoji || !event.id || !event.pubkey) return
		await mutationPublish.mutateAsync({ emoji, event })
	}

	const handleDeleteReaction = async (reaction: Reaction) => {
		if (!isAuthenticated) return
		if (!reaction.id || !reaction.authorPubkey) return
		await mutationDelete.mutateAsync({ reactionEvent: reaction })
	}

	const reactionButtons =
		reactionsGrouped && reactionsGrouped.size > 0
			? Array.from(reactionsGrouped.entries()).map(([content, values]) => (
					<Button
						key={content}
						variant="outline"
						size="sm"
						className={
							'rounded-full py-1 px-2 ' +
							(reactionsOwnUser?.find((r) => r.emoji == content)
								? 'bg-neo-purple hover:bg-neo-purple/80 text-white hover:text-white'
								: 'bg-purple-50 text-black hover:bg-pink-100 hover:text-black')
						}
						onClick={() => handleReactionClick(content)}
					>
						<span className="text-lg">{content}</span>
						<span className="ml-1">{values.length}</span>
					</Button>
				))
			: []

	const quickAddButtons =
		showQuickAdd && isAuthenticated
			? quickAddEmojis.map((emoji) => (
					<button
						key={emoji}
						type="button"
						onClick={() => handleReactionClick(emoji)}
						className="rounded p-0.5 text-sm hover:bg-zinc-200 transition-colors"
					>
						{emoji}
					</button>
				))
			: []

	const children = [...reactionButtons, ...(showQuickButtons ? quickAddButtons : [])]

	if (asChildren) {
		return children
	}

	return (
		<div
			className="flex flex-wrap items-center gap-1"
			data-testid="reactions-list"
			tabIndex={0}
			onMouseEnter={() => setShowQuickButtons(true)}
			onMouseLeave={() => setShowQuickButtons(false)}
			onFocus={() => setShowQuickButtons(true)}
			onBlur={() => setShowQuickButtons(false)}
		>
			{children}
		</div>
	)
}
