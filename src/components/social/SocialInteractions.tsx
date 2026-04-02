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
import { ReactionsList } from './ReactionsList'
import { ZapsList } from './ZapsList'
import { Reply } from 'lucide-react'

interface SocialInteractionsProps extends React.ComponentProps<'div'> {
	event: NDKEvent
	onCommentButtonPressed?: () => void
	showCommentAsReplyIcon?: boolean
}

const SocialInteractions = ({
	event,
	onCommentButtonPressed,
	showCommentAsReplyIcon = false,
	className,
	...props
}: SocialInteractionsProps) => {
	return (
		<div className={'flex flex-col gap-2 ' + className}>
			<div className="max-w-md flex gap-1 justify-start">
				<ReactionButton event={event} />
				<ZapButton event={event} />
				<CommentButton
					event={event}
					onClick={onCommentButtonPressed}
					icon={showCommentAsReplyIcon ? <Reply className="w-6 h-6" /> : undefined}
					tooltip={showCommentAsReplyIcon ? 'Reply' : undefined}
				/>
				<ShareButton event={event} />
			</div>
			<ZapsList event={event} />
			<ReactionsList event={event} />
		</div>
	)
}

export default SocialInteractions
