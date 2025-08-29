export type AddressableEventCoordinates = AddressableEventCoordinate[]

export type AddressableEventCoordinate = {
	kind: number
	pubkey: string
	identifier: string
}

/**
 * Parses an a-tag string into coordinate components
 * @param aTag String in format "kind:pubkey:identifier"
 * @returns AddressableEventCoordinate object
 * @example
 * getCoordsFromATag("30402:npub123...:product-id")
 * // Returns: { kind: 30402, pubkey: "npub123...", identifier: "product-id" }
 */
export const getCoordsFromATag = (aTag: string): AddressableEventCoordinate => {
	const coordsArray = aTag.split(':')

	if (coordsArray.length !== 3) {
		throw new Error(`Invalid a-tag format: ${aTag}. Expected format: "kind:pubkey:identifier"`)
	}

	const kind = parseInt(coordsArray[0])
	if (isNaN(kind)) {
		throw new Error(`Invalid kind in a-tag: ${coordsArray[0]}. Kind must be a number`)
	}

	return {
		kind,
		pubkey: coordsArray[1],
		identifier: coordsArray[2],
	}
}

/**
 * Converts coordinate components into an a-tag string
 * @param coords AddressableEventCoordinate object
 * @returns String in format "kind:pubkey:identifier"
 * @example
 * getATagFromCoords({ kind: 30402, pubkey: "npub123...", identifier: "product-id" })
 * // Returns: "30402:npub123...:product-id"
 */
export const getATagFromCoords = (coords: AddressableEventCoordinate): string => {
	if (!coords.kind || !coords.pubkey || coords.identifier === undefined) {
		throw new Error('Invalid coordinates: kind, pubkey, and identifier are required')
	}

	return `${coords.kind}:${coords.pubkey}:${coords.identifier}`
}

/**
 * Legacy alias for getCoordsFromATag for backward compatibility
 * @deprecated Use getCoordsFromATag instead
 */
export const getCoordsForATag = getCoordsFromATag

/**
 * Validates if a string is a valid a-tag format
 * @param aTag String to validate
 * @returns true if valid, false otherwise
 */
export const isValidATag = (aTag: string): boolean => {
	try {
		getCoordsFromATag(aTag)
		return true
	} catch {
		return false
	}
}

/**
 * Creates coordinates from individual components
 * @param kind Event kind number
 * @param pubkey Public key string
 * @param identifier Unique identifier string
 * @returns AddressableEventCoordinate object
 */
export const createCoords = (kind: number, pubkey: string, identifier: string): AddressableEventCoordinate => {
	return { kind, pubkey, identifier }
}
