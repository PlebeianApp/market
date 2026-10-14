import type { EventTemplate } from 'nostr-tools/pure'
import { isAddressableKind } from 'nostr-tools/kinds'
import type { Event } from '../../core/nostr-io/ts'
import { createReplaceableAddress, getReplaceableIdentifier } from '../../core/event-store/ts'

/** NIP-22 comment kind. */
export const COMMENT_KIND = 1111

export interface CommentParentInput {
	id: string
	authorPubkey: string
}

export interface CreateCommentTemplateInput {
	content: string
	targetEvent: Event
	parentComment?: CommentParentInput
	createdAt: number
}

/**
 * Build an unsigned NIP-22 comment template on a target event (product, comment, etc).
 * Handles both addressable (A/a tags) and regular (E/e tags) targets, and roots
 * a reply's parent scope on the parent comment rather than the thread root.
 */
export function createCommentTemplate(input: CreateCommentTemplateInput): EventTemplate {
	const { content, targetEvent, parentComment, createdAt } = input
	const tags: string[][] = []

	// === ROOT SCOPE (uppercase) ===
	if (isAddressableKind(targetEvent.kind)) {
		tags.push(['A', createReplaceableAddress(targetEvent.kind, targetEvent.pubkey, getReplaceableIdentifier(targetEvent))])
	} else {
		tags.push(['E', targetEvent.id])
	}
	tags.push(['K', targetEvent.kind.toString()])
	tags.push(['P', targetEvent.pubkey])

	// === PARENT SCOPE (lowercase) ===
	if (parentComment) {
		// Reply to another comment: parent scope is the parent comment, not the thread root.
		tags.push(['e', parentComment.id])
		tags.push(['k', String(COMMENT_KIND)])
		tags.push(['p', parentComment.authorPubkey])
	} else if (isAddressableKind(targetEvent.kind)) {
		tags.push(['a', createReplaceableAddress(targetEvent.kind, targetEvent.pubkey, getReplaceableIdentifier(targetEvent))])
		tags.push(['k', targetEvent.kind.toString()])
		tags.push(['p', targetEvent.pubkey])
	} else {
		tags.push(['e', targetEvent.id])
		tags.push(['k', targetEvent.kind.toString()])
		tags.push(['p', targetEvent.pubkey])
	}

	return { kind: COMMENT_KIND, created_at: createdAt, content, tags }
}
