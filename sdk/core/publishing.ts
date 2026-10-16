import type { EventPublishContext } from './ports/eventPublish'
import type { SignedEventLike } from './ports/signer'

/** Kind, content, and tags of an event before signing; `created_at` comes from the context clock. */
export interface UnsignedEventData {
	kind: number
	content: string
	tags: string[][]
}

export const DELETION_KIND = 5

/** Shared tail of every publishing workflow: sign with the injected signer, then hand to the injected publisher. */
export async function signAndPublish<SignedEvent extends SignedEventLike>(
	context: EventPublishContext<SignedEvent>,
	data: UnsignedEventData,
): Promise<SignedEvent> {
	const event = await context.signer.sign({ kind: data.kind, content: data.content, tags: data.tags, created_at: context.now() })
	await context.publish(event)
	return event
}

export function addressableCoordinate(kind: number, pubkey: string, dTag: string): string {
	return `${kind}:${pubkey}:${dTag}`
}

/** NIP-09 deletion request for the author's own addressable event. Relays may keep serving the original. */
export function buildAddressableDeletion(kind: number, authorPubkey: string, dTag: string, reason: string): UnsignedEventData {
	return { kind: DELETION_KIND, content: reason, tags: [['a', addressableCoordinate(kind, authorPubkey, dTag)]] }
}

export async function deleteAddressableEvent<SignedEvent extends SignedEventLike>(
	context: EventPublishContext<SignedEvent>,
	kind: number,
	dTag: string,
	reason: string,
): Promise<SignedEvent> {
	if (!dTag) throw new Error('A d tag is required to delete an addressable event')
	return signAndPublish(context, buildAddressableDeletion(kind, context.authorPubkey, dTag, reason))
}
