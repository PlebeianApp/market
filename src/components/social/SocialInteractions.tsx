import React, { useEffect, useState } from 'react'
import { ZapButton } from './ZapButton'
import NDK, { NDKEvent } from '@nostr-dev-kit/ndk'
import { ShareButton } from './ShareButton'
import { ReactionButton } from './ReactionButton'
import { CommentButton } from './CommentButton'
import { useEventReactions } from '@/queries/reactions'
import { ndkActions } from '@/lib/stores/ndk'
import type { Reaction } from '@/queries/reactions'
import { ReactionsList } from './ReactionsList'
import { ZapsList } from './ZapsList'
import { Reply } from 'lucide-react'
import type { ButtonVariant } from '../shared/ButtonProps'

interface SocialInteractionsProps extends React.ComponentProps<'div'> {
	event: NDKEvent
	onCommentButtonPressed?: () => void
	showCommentAsReplyIcon?: boolean
	hideShareButton?: boolean
	buttonVariant?: ButtonVariant
	combineZapsAndReactions?: boolean
}

const SocialInteractions = ({
	event,
	onCommentButtonPressed,
	showCommentAsReplyIcon = false,
	hideShareButton = false,
	buttonVariant,
	combineZapsAndReactions = false,
	className,
	...props
}: SocialInteractionsProps) => {
	return (
		<div className={'flex flex-col gap-2 my-2 ' + className} data-testid="social-interactions" {...props}>
			<div className={'max-w-md flex gap-1 justify-start'}>
				<ReactionButton event={event} variant={buttonVariant} />
				<ZapButton event={event} variant={buttonVariant} />
				<CommentButton
					event={event}
					onClick={onCommentButtonPressed}
					icon={showCommentAsReplyIcon ? <Reply className="w-6 h-6" /> : undefined}
					tooltip={showCommentAsReplyIcon ? 'Reply' : undefined}
					variant={buttonVariant}
				/>
				{!hideShareButton && <ShareButton event={event} variant={buttonVariant} />}
			</div>
			{combineZapsAndReactions ? (
				<div className="flex flex-wrap gap-2">
					<ZapsList event={event} asChildren />
					<ReactionsList event={event} asChildren />
				</div>
			) : (
				<>
					<ZapsList event={event} />
					<ReactionsList event={event} />
				</>
			)}
		</div>
	)
}

export default SocialInteractions
