import type { EventPublishContext } from '../../core/ports/eventPublish'
import type { SignedEventLike } from '../../core/ports/signer'
import { signAndPublish, type UnsignedEventData } from '../../core/publishing'
import type { PersistedCartContent } from './cartIntent'

export const CART_PERSISTENCE_KIND = 30078
export const CART_PERSISTENCE_D_TAG = 'plebeian-market-cart'

export function buildCartSnapshotEventData(snapshot: PersistedCartContent): UnsignedEventData {
	return { kind: CART_PERSISTENCE_KIND, content: JSON.stringify(snapshot), tags: [['d', CART_PERSISTENCE_D_TAG]] }
}

export function publishCartSnapshotWorkflow<SignedEvent extends SignedEventLike>(
	context: EventPublishContext<SignedEvent>,
	snapshot: PersistedCartContent,
): Promise<SignedEvent> {
	return signAndPublish(context, buildCartSnapshotEventData(snapshot))
}
