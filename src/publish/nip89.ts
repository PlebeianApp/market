import { DEFAULT_INSTANCE_CONFIG } from '@/lib/instance-config'
import { configStore } from '@/lib/stores/config'
import { ndkActions } from '@/lib/stores/ndk'
import NDK, { NDKEvent, type NDKSigner } from '@nostr-dev-kit/ndk'

/**
 * NIP-89: Recommended Application Handlers
 * This module handles creation and publishing of Application Handler events
 */

export const HANDLER_INFO_KIND = 31990
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
	const event = new NDKEvent(ndk)
	event.kind = HANDLER_INFO_KIND

	// If app settings are provided, use them as content (for backward compatibility with existing system)
	// Otherwise, leave content empty as per NIP-89
	if (appSettings) {
		event.content = JSON.stringify(appSettings)
	} else {
		event.content = ''
	}

	const { effectiveHandlerId, effectiveSiteUrl } = resolveHandlerMetadata(handlerId)

	// Tags for the handler info event
	event.tags = [
		['d', effectiveHandlerId], // Handler identifier
		['k', PRODUCT_KIND.toString()], // Supports product listings (kind 30402)
		['k', COLLECTION_KIND.toString()], // Supports collections (kind 30405)

		// URL patterns for handling products (kind 30402)
		// <bech32> will be replaced by clients with the actual NIP-19 encoded entity
		['web', `${effectiveSiteUrl}/product/<bech32>`, 'naddr'],
		['web', `${effectiveSiteUrl}/a/<bech32>`, 'naddr'], // Alternative pattern

		// URL patterns for handling collections (kind 30405)
		['web', `${effectiveSiteUrl}/collection/<bech32>`, 'naddr'],
	]

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

	const tags: string[][] = [
		['d', effectiveHandlerId],
		['k', PRODUCT_KIND.toString()],
		['k', COLLECTION_KIND.toString()],
		['web', `${effectiveSiteUrl}/product/<bech32>`, 'naddr'],
		['web', `${effectiveSiteUrl}/a/<bech32>`, 'naddr'],
		['web', `${effectiveSiteUrl}/collection/<bech32>`, 'naddr'],
	]

	if (effectiveRelayUrl) {
		tags.push(['r', effectiveRelayUrl])
	}

	return {
		kind: HANDLER_INFO_KIND,
		created_at: Math.floor(Date.now() / 1000),
		tags,
		content: JSON.stringify(appSettings),
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
		const event = createHandlerInfoEvent(signer, ndk, handlerId, appSettings)
		await event.sign(signer)
		await ndkActions.publishEvent(event)

		// Return the handler ID
		const dTag = event.tags.find((tag) => tag[0] === 'd')
		return dTag?.[1] || null
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
	return ['client', 'Plebeian Market', `31990:${appPubkey}:${effectiveHandlerId}`, effectiveRelayUrl]
}
