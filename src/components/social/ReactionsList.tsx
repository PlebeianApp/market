import { useEventReactions, type Reaction } from '@/queries/reactions'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useState } from 'react'
import { Button } from '../ui/button'
import { ReactionsDialog } from '../dialogs/ReactionsDialog'

// TODO: Add extends normal React Node/div properties
interface ReactionsListProps {
	event: NDKEvent
}

export const ReactionsList = ({ event }: ReactionsListProps) => {
	// TODO: Would make sense for highlighting purposes to fetch all own-user's reactions as well.
	const { data: reactions, error } = useEventReactions(event)

	const [openReactionDialog, setOpenReactionDialog] = useState(false)
	const [selectedReaction, setSelectedReaction] = useState<Map<string, Reaction[]> | null>(null)

	const handleReactionClick = (reactionMap: Map<string, Reaction[]>) => {
		setSelectedReaction(reactionMap)
		setOpenReactionDialog(true)
	}

	// TODO:
	// Update such that pressing on a button either:
	// - publishes that reaction if the reaction hasn't been made by the user
	// - deletes that reaction if already published by the user

	return (
		<>
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
