import type { NostrEventLike } from '../../core/nostr/eventLike'
import type { EventPublishContext } from '../../core/ports/eventPublish'
import type { SignedEventLike } from '../../core/ports/signer'
import { signAndPublish } from '../../core/publishing'
import { createCommentTemplate, type CommentParentInput } from './commentEvents'
import { createLiveChatMessageTemplate } from './liveChatEvents'
import { createReactionDeletionTemplate, createReactionTemplate } from './reactionEvents'

/** NIP-22 comment on any target event; replies scope their parent to `parentComment`. */
export function publishCommentWorkflow<SignedEvent extends SignedEventLike>(
	context: EventPublishContext<SignedEvent>,
	input: { content: string; targetEvent: NostrEventLike; parentComment?: CommentParentInput },
): Promise<SignedEvent> {
	return signAndPublish(context, createCommentTemplate({ ...input, createdAt: context.now() }))
}

/** NIP-53 chat message rooted on a live activity coordinate. */
export function publishLiveChatMessageWorkflow<SignedEvent extends SignedEventLike>(
	context: EventPublishContext<SignedEvent>,
	input: { liveActivityCoord: string; content: string; relayHint?: string },
): Promise<SignedEvent> {
	return signAndPublish(context, createLiveChatMessageTemplate({ ...input, createdAt: context.now() }))
}

export function publishReactionWorkflow<SignedEvent extends SignedEventLike>(
	context: EventPublishContext<SignedEvent>,
	input: { content: string; targetEvent: NostrEventLike },
): Promise<SignedEvent> {
	return signAndPublish(context, createReactionTemplate({ ...input, createdAt: context.now() }))
}

export function publishReactionDeletionWorkflow<SignedEvent extends SignedEventLike>(
	context: EventPublishContext<SignedEvent>,
	input: { reactionId: string; reactionAuthorPubkey: string; emoji: string },
): Promise<SignedEvent> {
	return signAndPublish(context, createReactionDeletionTemplate({ ...input, createdAt: context.now() }))
}
