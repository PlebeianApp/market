import React from 'react'
import { ZapButton } from './ZapButton'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { Button } from '../ui/button'
import { ShareButton } from './ShareButton'
import { ReactionButton } from './ReactionButton'
import { CommentButton } from './CommentButton'

interface SocialInteractionsProps {
	event: NDKEvent
}

const SocialInteractions = ({ event }: SocialInteractionsProps) => {
	return (
		<div className="max-w-md py-2 flex gap-2 justify-start">
			<ReactionButton event={event} />
			<ZapButton event={event} />
			<CommentButton event={event} />
			<ShareButton event={event} />
		</div>
	)
}

export default SocialInteractions
