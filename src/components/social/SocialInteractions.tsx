import React from 'react'
import { ZapButton } from './ZapButton'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { Button } from '../ui/button'

interface SocialInteractionsProps {
	event: NDKEvent
}

const SocialInteractions = ({ event }: SocialInteractionsProps) => {
	return (
		<div className="max-w-md mx-auto p-4">
			<div className="grid grid-cols-1 gap-2">
				<ReactionButton />
				<CommentButton />
				<RepostButton />
				<ZapButton event={event} />
				{/** Share Button */}
				<Button
					variant="primary"
					size="icon"
					className="bg-white/10 hover:bg-white/20"
					icon={<span className="i-sharing w-6 h-6" />}
					tooltip="Share"
					onClick={() => setShareDialogOpen(true)}
				/>
			</div>
		</div>
	)
}

export default ButtonComponent
