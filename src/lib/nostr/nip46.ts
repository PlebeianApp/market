import { MAIN_RELAY_BY_STAGE } from '../constants'

export interface NostrConnectMetadata {
	name?: string
	url?: string
	description?: string
	icons?: string[]
}

export function normalizeRelayUrls(relay: string | string[]): string[] {
	const relays = Array.isArray(relay) ? relay : [relay]
	const normalized = relays.map((relayUrl) => relayUrl.trim()).filter((relayUrl): relayUrl is string => relayUrl.length > 0)
	return Array.from(new Set(normalized))
}

export function getNip46RelayUrls(relay: string | string[]): string[] {
	const uniqueRelays = normalizeRelayUrls(relay)

	if (uniqueRelays.length > 0) {
		return uniqueRelays
	}

	if (process.env.NODE_ENV === 'production') {
		return []
	}

	return [MAIN_RELAY_BY_STAGE.development]
}

export function buildNostrConnectUrl(
	localPubkey: string,
	relay: string | string[],
	secret: string,
	metadata?: NostrConnectMetadata,
): string {
	const params = new URLSearchParams()
	for (const relayUrl of getNip46RelayUrls(relay)) {
		params.append('relay', relayUrl)
	}
	params.set('secret', secret)

	if (metadata) params.set('metadata', JSON.stringify(metadata))

	return `nostrconnect://${localPubkey}?${params.toString()}`
}

export function buildBunkerUrl(remoteSignerPubkey: string, relay: string | string[], secret: string): string {
	const params = new URLSearchParams()
	for (const relayUrl of getNip46RelayUrls(relay)) {
		params.append('relay', relayUrl)
	}
	params.set('secret', secret)
	return `bunker://${remoteSignerPubkey}?${params.toString()}`
}
