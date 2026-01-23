import { Store } from '@tanstack/store'

export interface VanityEntry {
	vanityName: string
	pubkey: string
	validUntil: number // Unix timestamp
}

export interface VanityState {
	// Raw vanity data - map of vanityName -> entry
	entries: Map<string, VanityEntry>

	// Reverse lookup - pubkey -> vanityName
	pubkeyToVanity: Map<string, string>

	// Metadata
	lastUpdated: number
	isLoaded: boolean
}

const initialState: VanityState = {
	entries: new Map(),
	pubkeyToVanity: new Map(),
	lastUpdated: 0,
	isLoaded: false,
}

export const vanityStore = new Store<VanityState>(initialState)

// Reserved names that cannot be registered (should match server)
const RESERVED_NAMES = new Set([
	'admin',
	'api',
	'dashboard',
	'products',
	'product',
	'profile',
	'checkout',
	'setup',
	'community',
	'posts',
	'post',
	'nostr',
	'search',
	'collection',
	'collections',
	'settings',
	'support',
	'help',
	'about',
	'terms',
	'privacy',
	'login',
	'logout',
	'register',
	'signup',
	'signin',
	'account',
	'user',
	'users',
	'app',
	'static',
	'assets',
	'images',
	'public',
	'favicon',
	'robots',
	'sitemap',
])

export const vanityActions = {
	/**
	 * Update the vanity store with new data
	 */
	setVanity: (entries: VanityEntry[], lastUpdated?: number) => {
		const now = Math.floor(Date.now() / 1000)
		const entriesMap = new Map<string, VanityEntry>()
		const pubkeyToVanity = new Map<string, string>()

		for (const entry of entries) {
			// Skip expired entries
			if (entry.validUntil < now) {
				continue
			}

			const normalizedName = entry.vanityName.toLowerCase()
			entriesMap.set(normalizedName, entry)
			pubkeyToVanity.set(entry.pubkey, normalizedName)
		}

		vanityStore.setState((state) => ({
			...state,
			entries: entriesMap,
			pubkeyToVanity,
			lastUpdated: lastUpdated || Date.now(),
			isLoaded: true,
		}))
	},

	/**
	 * Clear all vanity data
	 */
	clearVanity: () => {
		vanityStore.setState((state) => ({
			...state,
			...initialState,
		}))
	},

	/**
	 * Resolve a vanity name to a pubkey
	 */
	resolveVanity: (vanityName: string): VanityEntry | null => {
		const { entries } = vanityStore.state
		const entry = entries.get(vanityName.toLowerCase())

		if (!entry) return null

		// Check if expired
		if (entry.validUntil < Math.floor(Date.now() / 1000)) {
			return null
		}

		return entry
	},

	/**
	 * Check if a vanity name is available
	 */
	isVanityAvailable: (vanityName: string): boolean => {
		const normalized = vanityName.toLowerCase()

		// Check reserved names
		if (RESERVED_NAMES.has(normalized)) return false

		// Check format validity
		if (!vanityActions.isValidVanityName(normalized)) return false

		const { entries } = vanityStore.state
		const entry = entries.get(normalized)

		if (!entry) return true

		// Available if expired
		return entry.validUntil < Math.floor(Date.now() / 1000)
	},

	/**
	 * Validate vanity name format
	 */
	isValidVanityName: (name: string): boolean => {
		// Allow alphanumeric, hyphens, underscores, 3-30 characters
		const regex = /^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/
		return regex.test(name.toLowerCase())
	},

	/**
	 * Check if a name is reserved
	 */
	isReservedName: (vanityName: string): boolean => {
		return RESERVED_NAMES.has(vanityName.toLowerCase())
	},

	/**
	 * Get vanity URL for a pubkey
	 */
	getVanityForPubkey: (pubkey: string): VanityEntry | null => {
		const { pubkeyToVanity, entries } = vanityStore.state
		const vanityName = pubkeyToVanity.get(pubkey)

		if (!vanityName) return null

		return vanityActions.resolveVanity(vanityName)
	},

	/**
	 * Get all active vanity entries
	 */
	getAllVanityEntries: (): VanityEntry[] => {
		const { entries } = vanityStore.state
		const now = Math.floor(Date.now() / 1000)

		return Array.from(entries.values()).filter((entry) => entry.validUntil > now)
	},

	/**
	 * Check if vanity store is loaded
	 */
	isVanityLoaded: (): boolean => {
		return vanityStore.state.isLoaded
	},

	/**
	 * Get last update timestamp
	 */
	getLastUpdated: (): number => {
		return vanityStore.state.lastUpdated
	},
}

// React hook for consuming the store
export const useVanity = () => {
	return {
		...vanityStore.state,
		...vanityActions,
	}
}
