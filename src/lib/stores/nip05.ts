import { Store } from '@tanstack/store'

export interface Nip05Entry {
	username: string
	pubkey: string
	validUntil: number
}

export interface Nip05State {
	entries: Map<string, Nip05Entry>
	pubkeyToUsername: Map<string, string>
	lastUpdated: number
	isLoaded: boolean
}

const initialState: Nip05State = {
	entries: new Map(),
	pubkeyToUsername: new Map(),
	lastUpdated: 0,
	isLoaded: false,
}

export const nip05Store = new Store<Nip05State>(initialState)

// Reserved names that cannot be registered (should match server)
const RESERVED_NAMES = new Set([
	'admin',
	'_',
	'root',
	'postmaster',
	'webmaster',
	'hostmaster',
	'abuse',
	'noc',
	'security',
	'info',
	'support',
	'help',
	'noreply',
	'no-reply',
	'app',
	'system',
	'api',
	'bot',
])

export const nip05Actions = {
	/**
	 * Update the nip05 store with new data
	 */
	setNip05: (entries: Nip05Entry[], lastUpdated?: number) => {
		const now = Math.floor(Date.now() / 1000)
		const entriesMap = new Map<string, Nip05Entry>()
		const pubkeyToUsername = new Map<string, string>()

		for (const entry of entries) {
			// Skip expired entries
			if (entry.validUntil < now) {
				continue
			}

			const normalizedName = entry.username.toLowerCase()
			entriesMap.set(normalizedName, entry)
			pubkeyToUsername.set(entry.pubkey, normalizedName)
		}

		nip05Store.setState((state) => ({
			...state,
			entries: entriesMap,
			pubkeyToUsername,
			lastUpdated: lastUpdated || Date.now(),
			isLoaded: true,
		}))
	},

	/**
	 * Clear all nip05 data
	 */
	clearNip05: () => {
		nip05Store.setState((state) => ({
			...state,
			...initialState,
		}))
	},

	/**
	 * Resolve a username to a pubkey
	 */
	resolveUsername: (username: string): Nip05Entry | null => {
		const { entries } = nip05Store.state
		const entry = entries.get(username.toLowerCase())

		if (!entry) return null

		// Check if expired
		if (entry.validUntil < Math.floor(Date.now() / 1000)) {
			return null
		}

		return entry
	},

	/**
	 * Check if a username is available
	 */
	isUsernameAvailable: (username: string): boolean => {
		const normalized = username.toLowerCase()

		// Check reserved names
		if (RESERVED_NAMES.has(normalized)) return false

		// Check format validity
		if (!nip05Actions.isValidUsername(normalized)) return false

		const { entries } = nip05Store.state
		const entry = entries.get(normalized)

		if (!entry) return true

		// Available if expired
		return entry.validUntil < Math.floor(Date.now() / 1000)
	},

	/**
	 * Validate username format
	 */
	isValidUsername: (name: string): boolean => {
		// Allow alphanumeric, hyphens, underscores, dots, 1-30 characters
		const regex = /^[a-z0-9][a-z0-9._-]{0,28}[a-z0-9]$|^[a-z0-9]$/
		return regex.test(name.toLowerCase())
	},

	/**
	 * Check if a name is reserved
	 */
	isReservedName: (username: string): boolean => {
		return RESERVED_NAMES.has(username.toLowerCase())
	},

	/**
	 * Get NIP-05 entry for a pubkey
	 */
	getNip05ForPubkey: (pubkey: string): Nip05Entry | null => {
		const { pubkeyToUsername, entries } = nip05Store.state
		const username = pubkeyToUsername.get(pubkey)

		if (!username) return null

		return nip05Actions.resolveUsername(username)
	},

	/**
	 * Get all active nip05 entries
	 */
	getAllNip05Entries: (): Nip05Entry[] => {
		const { entries } = nip05Store.state
		const now = Math.floor(Date.now() / 1000)

		return Array.from(entries.values()).filter((entry) => entry.validUntil > now)
	},

	/**
	 * Check if nip05 store is loaded
	 */
	isNip05Loaded: (): boolean => {
		return nip05Store.state.isLoaded
	},

	/**
	 * Get last update timestamp
	 */
	getLastUpdated: (): number => {
		return nip05Store.state.lastUpdated
	},
}
