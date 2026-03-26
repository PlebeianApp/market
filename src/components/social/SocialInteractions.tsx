import React, { useEffect, useState } from 'react'
import { ZapButton } from './ZapButton'
import NDK, { NDKEvent } from '@nostr-dev-kit/ndk'
import { Button } from '../ui/button'
import { ShareButton } from './ShareButton'
import { ReactionButton } from './ReactionButton'
import { CommentButton } from './CommentButton'
import { useEventReactions } from '@/queries/reactions'
import { ndkActions } from '@/lib/stores/ndk'
import type { Reaction } from '@/queries/reactions'
import { ReactionsDialog } from '../dialogs/ReactionsDialog'

interface SocialInteractionsProps {
	event: NDKEvent
}

const SocialInteractions = ({ event }: SocialInteractionsProps) => {
	const { data: reactions, error } = useEventReactions(event)

	const [openReactionDialog, setOpenReactionDialog] = useState(false)
	const [selectedReaction, setSelectedReaction] = useState<Map<string, Reaction[]> | null>(null)

	const handleReactionClick = (reactionMap: Map<string, Reaction[]>) => {
		setSelectedReaction(reactionMap)
		setOpenReactionDialog(true)
	}

	return (
		<>
			<div className="max-w-md py-2 flex gap-2 justify-start">
				<ReactionButton event={event} />
				<ZapButton event={event} />
				<CommentButton event={event} />
				<ShareButton event={event} />
			</div>
			<div className="flex flex-wrap gap-1">
				{reactions && reactions.size > 0
					? Array.from(reactions.entries()).map(([content, values]) => (
							<Button
								key={content}
								variant="outline"
								size="sm"
								className="bg-primary-foreground rounded-full py-1 px-2 text-black hover:bg-secondary hover:text-white"
								onClick={() => handleReactionClick(reactions)}
							>
								<span className="text-lg">{content}</span>
								<span className="ml-1">{values.length}</span>
							</Button>
						))
					: null}
			</div>
			{selectedReaction && <ReactionsDialog event={event} reactions={selectedReaction} onOpenChange={setOpenReactionDialog} />}
		</>
	)
}

export default SocialInteractions
