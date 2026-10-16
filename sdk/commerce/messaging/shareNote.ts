import type { EventTemplate } from 'nostr-tools/pure'
import type { EventPublishContext } from '../../core/ports/eventPublish'
import type { SignedEventLike } from '../../core/ports/signer'
import { signAndPublish } from '../../core/publishing'

export const SHARE_NOTE_KIND = 1

export interface ShareNoteInput {
	content: string
	/** Addressable coordinate of the shared item (`kind:pubkey:d`). */
	coordinate: string
	url: string
	hashtag?: string
}

/** Kind-1 note referencing a shared listing by coordinate and URL. */
export function createShareNoteTemplate(input: ShareNoteInput & { createdAt: number }): EventTemplate {
	return {
		kind: SHARE_NOTE_KIND,
		created_at: input.createdAt,
		content: input.content,
		tags: [
			['a', input.coordinate],
			['r', input.url],
			['t', input.hashtag ?? 'plebeian'],
		],
	}
}

export function publishShareNoteWorkflow<SignedEvent extends SignedEventLike>(
	context: EventPublishContext<SignedEvent>,
	input: ShareNoteInput,
): Promise<SignedEvent> {
	return signAndPublish(context, createShareNoteTemplate({ ...input, createdAt: context.now() }))
}

export interface ShareEventNoteInput {
	content: string
	eventId: string
	authorPubkey: string
	hashtag?: string
}

/** Kind-1 note referencing a shared regular event by id and author. */
export function createShareEventNoteTemplate(input: ShareEventNoteInput & { createdAt: number }): EventTemplate {
	return {
		kind: SHARE_NOTE_KIND,
		created_at: input.createdAt,
		content: input.content,
		tags: [
			['e', input.eventId],
			['p', input.authorPubkey],
			['t', input.hashtag ?? 'plebeian'],
		],
	}
}

export function publishShareEventNoteWorkflow<SignedEvent extends SignedEventLike>(
	context: EventPublishContext<SignedEvent>,
	input: ShareEventNoteInput,
): Promise<SignedEvent> {
	return signAndPublish(context, createShareEventNoteTemplate({ ...input, createdAt: context.now() }))
}
