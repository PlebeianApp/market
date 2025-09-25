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
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	try {
		if (identifier.includes('@')) {
			const user = await ndk.getUserFromNip05(identifier)
			if (!user) return { profile: null, user: null }
			const profile = await user.fetchProfile()
			return { profile, user }
		}

		if (identifier.startsWith('npub')) {
			const user = ndk.getUser({ npub: identifier })
			const profile = await user.fetchProfile()
			return { profile, user }
		}

		const user = ndk.getUser({ hexpubkey: identifier })
		const profile = await user.fetchProfile()
		return { profile, user }
	} catch (e) {
		console.error('Failed to fetch profile with identifier:', e)
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

		const nip05User = await ndk.getUserFromNip05(profile.nip05)
		if (!nip05User) {
			return false
		}

		return nip05User.pubkey === user.pubkey
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
