import type { PersistedCartContent } from '@/lib/schemas/cartPersistence'
import type { NDKSigner } from '@/lib/nostr/ndk-events'
import { createNdkPublishContext, type NdkClient as NDK } from '@platform/web/ndkPublishContext'
import { publishCartSnapshotWorkflow } from '@sdk/commerce/cart'

export async function publishCartSnapshot(snapshot: PersistedCartContent, signer: NDKSigner, ndk: NDK): Promise<string> {
	const event = await publishCartSnapshotWorkflow(await createNdkPublishContext(ndk, signer), snapshot)
	return event.id
}
