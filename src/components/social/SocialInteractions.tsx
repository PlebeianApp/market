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
import { ReactionsList } from './ReactionsList'

interface SocialInteractionsProps {
	event: NDKEvent
}

const SocialInteractions = ({ event }: SocialInteractionsProps) => {
	return (
		<>
			<div className="max-w-md py-2 flex gap-2 justify-start">
				<ReactionButton event={event} />
				<ZapButton event={event} />
				<CommentButton event={event} />
				<ShareButton event={event} />
			</div>
			<ReactionsList event={event} />
		</>
	)
}

export default SocialInteractions
