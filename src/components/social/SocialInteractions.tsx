import React from 'react'
import { ZapButton } from './ZapButton'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { Button } from '../ui/button'
import { ShareButton } from './ShareButton'

interface SocialInteractionsProps {
	event: NDKEvent
}

const SocialInteractions = ({ event }: SocialInteractionsProps) => {
	return (
		<div className="max-w-md mx-auto p-4">
			<div className="grid grid-cols-1 gap-2">
				<ReactionButton />
				<CommentButton />
				<ZapButton event={event} />
				<ShareButton event={event} />
			</div>
		</div>
	)
}

export default ButtonComponent
