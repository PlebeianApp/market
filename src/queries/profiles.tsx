import { ndkActions } from '@/lib/stores/ndk'
import { type NDKUserProfile, NDKEvent, NDKUser } from '@nostr-dev-kit/ndk'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { nip19 } from 'nostr-tools'
import { profileKeys } from './queryKeyFactory'

export const fetchProfileByNpub = async (npub: string): Promise<NDKUserProfile | null> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	try {
		const user = ndk.getUser({ npub })
		return await user.fetchProfile()
	} catch (e) {
		console.error('Failed to fetch profile with NDK user method', e)
		return null
	}
}

export const fetchProfileByNip05 = async (nip05: string): Promise<NDKUserProfile | null> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	try {
		const user = await ndk.getUserFromNip05(nip05)
		if (!user) throw new Error('User not found')
		return await user.fetchProfile()
	} catch (e) {
		console.error('Failed to fetch profile with NDK user method', e)
		return null
	}
}

export const fetchProfileByIdentifier = async (identifier: string): Promise<{ profile: NDKUserProfile | null; user: NDKUser | null }> => {
	console.log('🔄 Profile Query: Starting profile fetch for identifier:', identifier)
	const ndk = ndkActions.getNDK()
	if (!ndk) {
		console.error('❌ Profile Query: NDK not initialized')
		throw new Error('NDK not initialized')
	}

	try {
		let user: NDKUser | null = null
		let profile: NDKUserProfile | null = null

		if (identifier.includes('@')) {
			console.log('🔍 Profile Query: Fetching user by NIP-05:', identifier)
			user = await ndk.getUserFromNip05(identifier)
			if (!user) {
				console.warn('⚠️ Profile Query: No user found for NIP-05:', identifier)
				return { profile: null, user: null }
			}
			profile = await user.fetchProfile()
		} else if (identifier.startsWith('npub')) {
			console.log('🔍 Profile Query: Fetching user by npub:', identifier)
			user = ndk.getUser({ npub: identifier })
			profile = await user.fetchProfile()
		} else {
			console.log('🔍 Profile Query: Fetching user by hex pubkey:', identifier)
			user = ndk.getUser({ hexpubkey: identifier })
			profile = await user.fetchProfile()
		}

		if (profile) {
			console.log('✅ Profile Query: Successfully fetched profile for:', identifier, 'Profile:', profile)
		} else {
			console.warn('⚠️ Profile Query: No profile data found for:', identifier)
		}

		return { profile, user }
	} catch (e) {
		console.error('❌ Profile Query: Failed to fetch profile with identifier:', identifier, 'Error:', e)
		return { profile: null, user: null }
	}
}

export const profileQueryOptions = (npub: string) =>
	queryOptions({
		queryKey: profileKeys.details(npub),
		queryFn: () => fetchProfileByNpub(npub),
	})

export const profileByNip05QueryOptions = (nip05: string) =>
	queryOptions({
		queryKey: profileKeys.detailsByNip05(nip05),
		queryFn: () => fetchProfileByNip05(nip05),
	})

export const profileByIdentifierQueryOptions = (identifier: string) =>
	queryOptions({
		queryKey: profileKeys.details(identifier),
		queryFn: () => fetchProfileByIdentifier(identifier),
	})

export const validateNip05 = async (pubkey: string): Promise<boolean | null> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	try {
		const user = ndk.getUser({ pubkey })
		const profile = await user.fetchProfile()
		if (!profile?.nip05) return null

		return await user.validateNip05(profile.nip05)
	} catch (e) {
		console.error('Error validating NIP-05:', e)
		return false
	}
}

export const nip05ValidationQueryOptions = (pubkey: string) =>
	queryOptions({
		queryKey: profileKeys.nip05(pubkey),
		queryFn: () => validateNip05(pubkey),
	})

// --- DATA EXTRACTION FUNCTIONS ---

export const getProfileName = ({ profile }: { profile: NDKUserProfile | null }): string => {
	if (!profile) return ''
	return profile.name || profile.displayName || ''
}

export const getProfileNip05 = ({ profile }: { profile: NDKUserProfile | null }): string | undefined => {
	if (!profile) return undefined
	return profile.nip05
}

// --- REACT QUERY HOOKS ---

export const useProfileName = (pubkey: string) => {
	return useQuery({
		...profileByIdentifierQueryOptions(pubkey),
		select: getProfileName,
	})
}

export const useProfileNip05 = (pubkey: string) => {
	return useQuery({
		...profileByIdentifierQueryOptions(pubkey),
		select: getProfileNip05,
	})
}

export const checkZapCapability = async (event: NDKEvent | NDKUser): Promise<boolean> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	try {
		if (event instanceof NDKUser) {
			const zapInfo = await event.getZapInfo()
			return zapInfo.size > 0
		} else {
			const userToZap = ndk.getUser({ pubkey: event.pubkey })
			const zapInfo = await userToZap.getZapInfo()
			return zapInfo.size > 0
		}
	} catch (e) {
		console.error('Failed to check zap capability:', e)
		return false
	}
}

export const zapCapabilityQueryOptions = (event: NDKEvent | NDKUser) =>
	queryOptions({
		queryKey: profileKeys.zapCapability(event.pubkey),
		queryFn: () => checkZapCapability(event),
	})

export const useZapCapability = (event: NDKEvent | NDKUser) => {
	return useQuery({
		...zapCapabilityQueryOptions(event),
		select: (data) => data,
	})
}

export const checkZapCapabilityByNpub = async (npub: string): Promise<boolean> => {
	try {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		// Convert npub to hex pubkey
		const { data: pubkey } = nip19.decode(npub)
		if (typeof pubkey !== 'string') {
			throw new Error('Invalid npub format')
		}

		// Create a user from the pubkey
		const user = new NDKUser({ pubkey })
		user.ndk = ndk

		// Check zap capability using existing function
		return await checkZapCapability(user)
	} catch (error) {
		console.error('Error checking zap capability by npub:', error)
		return false
	}
}

export const zapCapabilityByNpubQueryOptions = (npub: string) =>
	queryOptions({
		queryKey: profileKeys.zapCapability(npub),
		queryFn: () => checkZapCapabilityByNpub(npub),
	})

export const useZapCapabilityByNpub = (npub: string) => {
	return useQuery({
		...zapCapabilityByNpubQueryOptions(npub),
		select: (data) => data,
	})
}
