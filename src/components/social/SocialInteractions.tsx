import React, { useEffect, useState } from 'react'
import { ZapButton } from './ZapButton'
import NDK, { NDKEvent } from '@nostr-dev-kit/ndk'
import { Button } from '../ui/button'
import { ShareButton } from './ShareButton'
import { ReactionButton } from './ReactionButton'
import { CommentButton } from './CommentButton'
import { useEventReactions } from '@/queries/reactions'
import { ndkActions } from '@/lib/stores/ndk'

interface SocialInteractionsProps {
	event: NDKEvent
}

const SocialInteractions = ({ event }: SocialInteractionsProps) => {
	const { data: reactions, error } = useEventReactions(event)

	return (
		<>
			<div className="max-w-md py-2 flex gap-2 justify-start">
				<ReactionButton event={event} />
				<ZapButton event={event} />
				<CommentButton event={event} />
				<ShareButton event={event} />
			</div>
			<div className="flex flex-wrap gap-1">
				{reactions &&
					Array.from(reactions).map(([content, values]) => (
						<div className="bg-primary-foreground rounded-full py-1 px-2 text-black">
							<span className="text-lg">{content}</span>
							<span className="ml-1">{values.length}</span>
						</div>
					))}
			</div>
		</>
	)
}

export default SocialInteractions
