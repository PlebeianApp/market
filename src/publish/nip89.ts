import { DEFAULT_INSTANCE_CONFIG } from '@/lib/instance-config'
import { configStore } from '@/lib/stores/config'
import { NDKEvent, type NDKSigner } from '@/lib/nostr/ndk-events'
import { createNdkPublishContext, type NdkClient as NDK } from '@platform/web/ndkPublishContext'
import {
	buildClientTag,
	buildHandlerInfoEventData,
	HANDLER_INFO_KIND,
	NIP89_CLIENT_SOFTWARE_NAME,
	publishHandlerInfoWorkflow,
} from '@sdk/core/nip89'

/**
 * NIP-89: Recommended Application Handlers
 * This module handles creation and publishing of Application Handler events
 */

export { HANDLER_INFO_KIND, NIP89_CLIENT_SOFTWARE_NAME }
export const PRODUCT_KIND = 30402
export const COLLECTION_KIND = 30405

export const PLEBEIAN_MARKET_URL = 'https://plebeian.market'
export const PLEBEIAN_MARKET_RELAY = 'wss://relay.plebeian.market'

/**
 * Resolve runtime metadata for a published handler event. The runtime config
 * is authoritative when it is available; the shipped Plebeian URLs remain as
 * the compatibility fallback so existing setups keep working without env vars.
 */
function resolveHandlerMetadata(handlerId?: string, relayUrl?: string, siteUrl?: string) {
	const config = configStore.state.config
	const effectiveSiteUrl = siteUrl || config.siteUrl || PLEBEIAN_MARKET_URL
	const effectiveHandlerId = handlerId || config.handlerId || DEFAULT_INSTANCE_CONFIG.handlerId
	const effectiveRelayUrl = relayUrl || config.appRelay || PLEBEIAN_MARKET_RELAY
	return {
		effectiveSiteUrl,
		effectiveHandlerId,
		effectiveRelayUrl,
	}
}

/**
 * Creates a handler information event (kind 31990) for Plebeian Market
 * This announces which event kinds the application can handle
 *
 * @param appSettings - Optional app settings to include in the content (for backward compatibility)
 */
export const createHandlerInfoEvent = (
	signer: NDKSigner,
	ndk: NDK,
	handlerId?: string,
	appSettings?: Record<string, unknown>,
): NDKEvent => {
	const { effectiveHandlerId, effectiveSiteUrl } = resolveHandlerMetadata(handlerId)
	const data = buildHandlerInfoEventData({ handlerId: effectiveHandlerId, siteUrl: effectiveSiteUrl, appSettings })

	const event = new NDKEvent(ndk)
	event.kind = data.kind
	event.content = data.content
	event.tags = data.tags
	return event
}

/**
 * Creates handler information event data as a plain object (for use with finalizeEvent)
 * This is used in setup.tsx where we need to sign with generateSecretKey
 */
export const createHandlerInfoEventData = (
	pubkey: string,
	appSettings: Record<string, unknown>,
	relayUrl?: string,
	handlerId?: string,
	siteUrl?: string,
): {
	kind: number
	created_at: number
	tags: string[][]
	content: string
	pubkey: string
} => {
	const { effectiveHandlerId, effectiveSiteUrl, effectiveRelayUrl } = resolveHandlerMetadata(handlerId, relayUrl, siteUrl)

	// `effectiveRelayUrl` always resolves (falls back to `PLEBEIAN_MARKET_RELAY`), so the `r` tag is always present.
	const data = buildHandlerInfoEventData({
		handlerId: effectiveHandlerId,
		siteUrl: effectiveSiteUrl,
		relayUrl: effectiveRelayUrl,
		appSettings,
	})

	return {
		kind: data.kind,
		created_at: Math.floor(Date.now() / 1000),
		tags: data.tags,
		content: data.content,
		pubkey,
	}
}

/**
 * Publishes a handler information event
 */
export const publishHandlerInfo = async (
	signer: NDKSigner,
	ndk: NDK,
	handlerId?: string,
	appSettings?: Record<string, unknown>,
): Promise<string | null> => {
	try {
		const { effectiveHandlerId, effectiveSiteUrl } = resolveHandlerMetadata(handlerId)
		const { handlerId: publishedHandlerId } = await publishHandlerInfoWorkflow(await createNdkPublishContext(ndk, signer), {
			handlerId: effectiveHandlerId,
			siteUrl: effectiveSiteUrl,
			appSettings,
		})
		return publishedHandlerId || null
	} catch (error) {
		console.error('Error publishing handler info:', error)
		throw error
	}
}

/**
 * Creates a client tag for use in published events
 * This identifies that the event was created by Plebeian Market
 *
 * @param appPubkey - The public key of the Plebeian Market application
 * @param handlerId - The handler identifier (d tag value) from the handler info event
 * @returns A client tag array
 */
export const createClientTag = (appPubkey: string, handlerId: string, relayUrl?: string): [string, string, string, string] => {
	const effectiveRelayUrl = relayUrl || configStore.state.config.appRelay || PLEBEIAN_MARKET_RELAY
	const effectiveHandlerId = handlerId || configStore.state.config.handlerId || DEFAULT_INSTANCE_CONFIG.handlerId
	return buildClientTag(appPubkey, effectiveHandlerId, effectiveRelayUrl)
}
