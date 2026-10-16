import type { EventTemplate } from 'nostr-tools/pure'
import { isAddressableKind } from 'nostr-tools/kinds'
import { getEventAddress, type NostrEventLike } from '../../core/nostr/eventLike'

/** NIP-25 reaction kind. */
export const REACTION_KIND = 7

/** Unsigned NIP-25 reaction: `a` for addressable targets, `e` otherwise, plus `p` and `k`. */
export function createReactionTemplate(input: { content: string; targetEvent: NostrEventLike; createdAt: number }): EventTemplate {
	const { targetEvent } = input
	const target = isAddressableKind(targetEvent.kind) ? ['a', getEventAddress(targetEvent)] : ['e', targetEvent.id]
	return {
		kind: REACTION_KIND,
		created_at: input.createdAt,
		content: input.content,
		tags: [target, ['p', targetEvent.pubkey], ['k', targetEvent.kind.toString()]],
	}
}

/** Unsigned NIP-09 deletion request for one of the author's own reactions. */
export function createReactionDeletionTemplate(input: {
	reactionId: string
	reactionAuthorPubkey: string
	emoji: string
	createdAt: number
}): EventTemplate {
	return {
		kind: 5,
		created_at: input.createdAt,
		content: `Removed reaction: ${input.emoji}`,
		tags: [
			['e', input.reactionId],
			['p', input.reactionAuthorPubkey],
			['k', REACTION_KIND.toString()],
		],
	}
}
