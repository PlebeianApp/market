import { productPublishIssueMessage, type ProductFormData } from '@/publish/products'
import { ndkActions, getWriteRelaySet, getWriteRelays } from '@/lib/stores/ndk'
import type { NDKEvent, NDKSigner } from '@/lib/nostr/ndk-events'
import { createNdkPublishContext, type NdkClient as NDK } from '@platform/web/ndkPublishContext'
import { publishMigratedProductWorkflow } from '@sdk/commerce/products'

export type MigrationStep = 'preparing' | 'signing' | 'publishing' | 'done'

export interface MigrationProgress {
	step: MigrationStep
	relayUrl?: string
	relayStatus?: 'pending' | 'success' | 'error'
	relayUrls?: string[]
}

const createProductId = () => `product_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`

/**
 * Publishes a migrated product (NIP-99) with migration tags
 * Adds "migrated" tag with the original NIP-15 event ID
 * Publishes to user's relays (same as regular products)
 */
export const publishMigratedProduct = async (
	formData: ProductFormData,
	originalNip15EventId: string,
	signer: NDKSigner,
	ndk: NDK,
	onProgress?: (progress: MigrationProgress) => void,
): Promise<string> => {
	const publishWithRelayProgress = async (event: NDKEvent) => {
		const relaySet = getWriteRelaySet()
		const relayUrls = relaySet ? Array.from(relaySet.relays).map((r) => r.url) : getWriteRelays()
		onProgress?.({ step: 'publishing', relayUrls })

		const publishHandler = (relay: { url: string }) => {
			onProgress?.({ step: 'publishing', relayUrl: relay.url, relayStatus: 'success' })
		}
		event.on('relay:published', publishHandler)
		try {
			await ndkActions.publishEvent(event)
		} finally {
			event.off('relay:published', publishHandler)
		}
	}

	const context = await createNdkPublishContext(ndk, signer, publishWithRelayProgress)
	const outcome = await publishMigratedProductWorkflow(
		{
			...context,
			createProductId,
			// 'publishing' is reported by the publish adapter together with the relay list.
			onStep: (step) => step !== 'publishing' && onProgress?.({ step }),
		},
		formData,
		originalNip15EventId,
	)
	if (!outcome.ok) throw new Error(productPublishIssueMessage(outcome.issue))
	return outcome.event.id
}
