import { ndkActions } from '@/lib/stores/ndk'
import type { EventPublishContext } from '@sdk/core/ports/eventPublish'
import NDK, { NDKEvent, type NDKSigner, type NDKTag } from '@nostr-dev-kit/ndk'

/**
 * Platform adapter: binds the web host's NDK client and signer to the SDK's
 * explicit publish context. SDK workflows never read the NDK singleton.
 */
export async function createNdkPublishContext(ndk: NDK, signer: NDKSigner): Promise<EventPublishContext<NDKEvent>> {
	const author = await signer.user()
	return {
		authorPubkey: author.pubkey,
		now: () => Math.floor(Date.now() / 1000),
		signer: {
			sign: async (template) => {
				const event = new NDKEvent(ndk)
				event.kind = template.kind as typeof event.kind
				event.content = template.content
				event.tags = template.tags as NDKTag[]
				event.created_at = template.created_at
				await event.sign(signer)
				return event
			},
		},
		publish: async (event) => {
			await ndkActions.publishEvent(event)
		},
	}
}
