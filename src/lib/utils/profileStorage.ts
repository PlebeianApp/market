import type { NDKUserProfile } from '@nostr-dev-kit/ndk'

const PROFILE_STORAGE_PREFIX = 'profile_'

/**
 * Store profile data in localStorage
 */
export const storeProfileInLocalStorage = (pubkey: string, profile: NDKUserProfile): void => {
	try {
		const profileKey = `${PROFILE_STORAGE_PREFIX}${pubkey}`
		localStorage.setItem(profileKey, JSON.stringify(profile))
		console.log('✅ Profile stored in localStorage:', profileKey)
	} catch (error) {
		console.warn('Failed to store profile in localStorage:', error)
	}
}

/**
 * Retrieve profile data from localStorage
 */
export const getProfileFromLocalStorage = (pubkey: string): NDKUserProfile | null => {
	try {
		const profileKey = `${PROFILE_STORAGE_PREFIX}${pubkey}`
		const cached = localStorage.getItem(profileKey)
		if (cached) {
			const profile = JSON.parse(cached)
			if (process.env.NODE_ENV === 'development') {
				console.log('📦 Retrieved profile from localStorage:', profileKey)
			}
			return profile
		}
	} catch (error) {
		console.warn('Failed to load profile from localStorage:', error)
	}
	return null
}

/**
 * Remove profile data from localStorage
 */
export const removeProfileFromLocalStorage = (pubkey: string): void => {
	try {
		const profileKey = `${PROFILE_STORAGE_PREFIX}${pubkey}`
		localStorage.removeItem(profileKey)
		console.log('🗑️ Profile removed from localStorage:', profileKey)
	} catch (error) {
		console.warn('Failed to remove profile from localStorage:', error)
	}
}

/**
 * Clear all profile data from localStorage
 */
export const clearAllProfilesFromLocalStorage = (): void => {
	try {
		const keys = Object.keys(localStorage)
		const profileKeys = keys.filter((key) => key.startsWith(PROFILE_STORAGE_PREFIX))

		profileKeys.forEach((key) => localStorage.removeItem(key))
		console.log(`🗑️ Cleared ${profileKeys.length} profiles from localStorage`)
	} catch (error) {
		console.warn('Failed to clear profiles from localStorage:', error)
	}
}
