import type { EventPublishContext } from '../../core/ports/eventPublish'
import type { SignedEventLike } from '../../core/ports/signer'
import { addressableCoordinate, deleteAddressableEvent, signAndPublish } from '../../core/publishing'
import { buildCollectionEventData, COLLECTION_EVENT_KIND, type CollectionEventInput } from './collectionEvent'

export interface CollectionPublishContext<SignedEvent extends SignedEventLike> extends EventPublishContext<SignedEvent> {
	createCollectionId(): string
	clientTag?: string[]
}

export type CollectionPublishInput = Omit<CollectionEventInput, 'collectionId' | 'clientTag'>

export interface CollectionPublishOutcome<SignedEvent> {
	event: SignedEvent
	collectionId: string
	coordinate: string
}

/** Builds, signs, and publishes a kind-30405 collection; pass `collectionId` to replace an existing one. */
export async function publishCollectionWorkflow<SignedEvent extends SignedEventLike>(
	context: CollectionPublishContext<SignedEvent>,
	input: CollectionPublishInput,
	collectionId?: string,
): Promise<CollectionPublishOutcome<SignedEvent>> {
	const id = collectionId || context.createCollectionId()
	const event = await signAndPublish(context, buildCollectionEventData({ ...input, collectionId: id, clientTag: context.clientTag }))
	return { event, collectionId: id, coordinate: addressableCoordinate(COLLECTION_EVENT_KIND, context.authorPubkey, id) }
}

export function deleteCollectionWorkflow<SignedEvent extends SignedEventLike>(
	context: EventPublishContext<SignedEvent>,
	collectionId: string,
): Promise<SignedEvent> {
	return deleteAddressableEvent(context, COLLECTION_EVENT_KIND, collectionId, 'Collection deleted')
}
