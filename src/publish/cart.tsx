import { ndkActions } from '@/lib/stores/ndk'
import { CART_PERSISTENCE_D_TAG, CART_PERSISTENCE_KIND, type PersistedCartContent } from '@/lib/schemas/cartPersistence'
import NDK, { NDKEvent, type NDKSigner } from '@nostr-dev-kit/ndk'

export async function publishCartSnapshot(snapshot: PersistedCartContent, signer: NDKSigner, ndk: NDK): Promise<string> {
	const event = new NDKEvent(ndk)
	event.kind = CART_PERSISTENCE_KIND
	event.content = JSON.stringify(snapshot)
	event.tags = [['d', CART_PERSISTENCE_D_TAG]]

	await event.sign(signer)
	await ndkActions.publishEvent(event)

	return event.id
}
