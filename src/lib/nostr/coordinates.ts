import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { isAddressableKind } from 'nostr-tools/kinds'

/**
 * Helper to extract the 'd' tag from an event
 */
export const getDTag = (event: NDKEvent): string | null => {
	const dTag = event.tags.find((tag) => tag[0] === 'd')
	return dTag ? dTag[1] : null
}

/**
 * Constructs the coordinate string for an addressable event: "kind:pubkey:d-tag"
 */
export const getCoordinates = (event: NDKEvent): string => {
	const dTag = getDTag(event)
	if (!dTag) {
		throw new Error(`Addressable event (kind ${event.kind}) is missing the required 'd' tag.`)
	}
	return `${event.kind}:${event.pubkey}:${dTag}`
}

export const getCoordinatesOrId = (event: NDKEvent): string => {
	return isAddressableKind(event.kind) ? getCoordinates(event) : event.id
}
