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

	// Generate a unique ID for this handler
	const id = handlerId || crypto.randomUUID()

	// Tags for the handler info event
	event.tags = [
		['d', id], // Handler identifier
		['k', PRODUCT_KIND.toString()], // Supports product listings (kind 30402)
		['k', COLLECTION_KIND.toString()], // Supports collections (kind 30405)

		// URL patterns for handling products (kind 30402)
		// <bech32> will be replaced by clients with the actual NIP-19 encoded entity
		['web', `${PLEBEIAN_MARKET_URL}/product/<bech32>`, 'naddr'],
		['web', `${PLEBEIAN_MARKET_URL}/a/<bech32>`, 'naddr'], // Alternative pattern

		// URL patterns for handling collections (kind 30405)
		['web', `${PLEBEIAN_MARKET_URL}/collection/<bech32>`, 'naddr'],
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
): {
	kind: number
	created_at: number
	tags: string[][]
	content: string
	pubkey: string
} => {
	const id = handlerId || crypto.randomUUID()

	const tags: string[][] = [
		['d', id],
		['k', PRODUCT_KIND.toString()],
		['k', COLLECTION_KIND.toString()],
		['web', `${PLEBEIAN_MARKET_URL}/product/<bech32>`, 'naddr'],
		['web', `${PLEBEIAN_MARKET_URL}/a/<bech32>`, 'naddr'],
		['web', `${PLEBEIAN_MARKET_URL}/collection/<bech32>`, 'naddr'],
	]

	// Add relay if provided
	if (relayUrl) {
		tags.push(['r', relayUrl])
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
		await event.publish()

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
export const createClientTag = (appPubkey: string, handlerId: string): [string, string, string, string] => {
	return ['client', 'Plebeian Market', `31990:${appPubkey}:${handlerId}`, PLEBEIAN_MARKET_RELAY]
}
