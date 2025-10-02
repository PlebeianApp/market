import { Store } from '@tanstack/store'

export interface BlacklistState {
	// Raw blacklist data
	blacklistedPubkeys: string[]
	blacklistedProducts: string[]
	blacklistedCollections: string[]

	// Regex patterns for efficient matching
	pubkeyRegex: RegExp | null
	productRegex: RegExp | null
	collectionRegex: RegExp | null

	// Metadata
	lastUpdated: number
	isLoaded: boolean
}

const initialState: BlacklistState = {
	blacklistedPubkeys: [],
	blacklistedProducts: [],
	blacklistedCollections: [],
	pubkeyRegex: null,
	productRegex: null,
	collectionRegex: null,
	lastUpdated: 0,
	isLoaded: false,
}

export const blacklistStore = new Store<BlacklistState>(initialState)

/**
 * Helper function to escape regex special characters
 */
const escapeRegex = (str: string): string => {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Build a regex pattern from an array of strings
 * Returns null if array is empty
 */
const buildRegexPattern = (items: string[]): RegExp | null => {
	if (items.length === 0) return null

	// Escape each item and join with OR operator
	const pattern = items.map((item) => `^${escapeRegex(item)}$`).join('|')
	return new RegExp(pattern, 'i') // Case-insensitive
}

export const blacklistActions = {
	/**
	 * Update the blacklist with new data
	 */
	setBlacklist: (data: {
		blacklistedPubkeys: string[]
		blacklistedProducts: string[]
		blacklistedCollections: string[]
		lastUpdated?: number
	}) => {
		const pubkeyRegex = buildRegexPattern(data.blacklistedPubkeys)
		const productRegex = buildRegexPattern(data.blacklistedProducts)
		const collectionRegex = buildRegexPattern(data.blacklistedCollections)

		blacklistStore.setState((state) => ({
			...state,
			blacklistedPubkeys: data.blacklistedPubkeys,
			blacklistedProducts: data.blacklistedProducts,
			blacklistedCollections: data.blacklistedCollections,
			pubkeyRegex,
			productRegex,
			collectionRegex,
			lastUpdated: data.lastUpdated || Date.now(),
			isLoaded: true,
		}))

		console.log('🛡️ Blacklist updated:', {
			pubkeys: data.blacklistedPubkeys.length,
			products: data.blacklistedProducts.length,
			collections: data.blacklistedCollections.length,
		})
	},

	/**
	 * Clear all blacklist data
	 */
	clearBlacklist: () => {
		blacklistStore.setState((state) => ({
			...state,
			...initialState,
		}))
	},

	/**
	 * Check if a pubkey is blacklisted
	 */
	isPubkeyBlacklisted: (pubkey: string): boolean => {
		const { pubkeyRegex, blacklistedPubkeys } = blacklistStore.state

		if (blacklistedPubkeys.length === 0) return false

		// Use regex for performance if available, otherwise fall back to array includes
		if (pubkeyRegex) {
			return pubkeyRegex.test(pubkey)
		}

		return blacklistedPubkeys.includes(pubkey)
	},

	/**
	 * Check if a product coordinate is blacklisted
	 */
	isProductBlacklisted: (productCoords: string): boolean => {
		const { productRegex, blacklistedProducts } = blacklistStore.state

		if (blacklistedProducts.length === 0) return false

		// Use regex for performance if available, otherwise fall back to array includes
		if (productRegex) {
			return productRegex.test(productCoords)
		}

		return blacklistedProducts.includes(productCoords)
	},

	/**
	 * Check if a collection coordinate is blacklisted
	 */
	isCollectionBlacklisted: (collectionCoords: string): boolean => {
		const { collectionRegex, blacklistedCollections } = blacklistStore.state

		if (blacklistedCollections.length === 0) return false

		// Use regex for performance if available, otherwise fall back to array includes
		if (collectionRegex) {
			return collectionRegex.test(collectionCoords)
		}

		return blacklistedCollections.includes(collectionCoords)
	},

	/**
	 * Get all blacklisted items
	 */
	getBlacklist: () => {
		const { blacklistedPubkeys, blacklistedProducts, blacklistedCollections } = blacklistStore.state
		return {
			pubkeys: blacklistedPubkeys,
			products: blacklistedProducts,
			collections: blacklistedCollections,
		}
	},

	/**
	 * Get regex patterns (useful for advanced filtering)
	 */
	getRegexPatterns: () => {
		const { pubkeyRegex, productRegex, collectionRegex } = blacklistStore.state
		return {
			pubkeyRegex,
			productRegex,
			collectionRegex,
		}
	},

	/**
	 * Check if blacklist is loaded
	 */
	isBlacklistLoaded: (): boolean => {
		return blacklistStore.state.isLoaded
	},

	/**
	 * Get last update timestamp
	 */
	getLastUpdated: (): number => {
		return blacklistStore.state.lastUpdated
	},
}

// React hook for consuming the store
export const useBlacklist = () => {
	return {
		...blacklistStore.state,
		...blacklistActions,
	}
}
