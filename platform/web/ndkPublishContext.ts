import { ndkActions } from '@/lib/stores/ndk'
import { NDKEvent, type NDKSigner } from '@/lib/nostr/ndk-events'
import type { EventPublishContext } from '@sdk/core/ports/eventPublish'

export type NdkClient = NonNullable<ConstructorParameters<typeof NDKEvent>[0]>

/**
 * Platform adapter: binds the web host's NDK client and signer to the SDK's
 * explicit publish context. SDK workflows never read the NDK singleton.
 */
export async function createNdkPublishContext(
	ndk: NdkClient,
	signer: NDKSigner,
	publish: (event: NDKEvent) => Promise<void> = async (event) => {
		await ndkActions.publishEvent(event)
	},
): Promise<EventPublishContext<NDKEvent>> {
	const author = await signer.user()
	return {
		authorPubkey: author.pubkey,
		now: () => Math.floor(Date.now() / 1000),
		signer: {
			sign: async (template) => {
				const event = new NDKEvent(ndk)
				event.kind = template.kind as typeof event.kind
				event.content = template.content
				event.tags = template.tags as typeof event.tags
				event.created_at = template.created_at
				await event.sign(signer)
				return event
			},
		},
		publish,
	}
}
