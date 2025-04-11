import { ndkActions } from '@/lib/stores/ndk'
import { type NDKUserProfile, NDKUser } from '@nostr-dev-kit/ndk'
import { queryOptions, useQuery } from '@tanstack/react-query'
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

export const fetchProfileByIdentifier = async (identifier: string): Promise<NDKUserProfile | null> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	try {
		if (identifier.includes('@')) {
			return await fetchProfileByNip05(identifier)
		}

		if (identifier.startsWith('npub')) {
			return await fetchProfileByNpub(identifier)
		}

		const user = ndk.getUser({ hexpubkey: identifier })
		return await user.fetchProfile()
	} catch (e) {
		console.error('Failed to fetch profile with identifier:', e)
		return null
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

export const validateNip05 = async (npub: string): Promise<boolean | null> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	try {
		const user = ndk.getUser({ npub })
		const profile = await user.fetchProfile()
		if (!profile?.nip05) return null

		const [name, domain] = profile.nip05.split('@')

		let punycodeDomain = domain
		if (!/^[a-z0-9.-]+$/.test(domain)) {
			try {
				console.log(`Domain might need punycode conversion: ${domain}`)
			} catch (err) {
				console.warn(`Punycode conversion failed for domain: ${domain}. Using original domain.`)
			}
		}

		const parsedNip05 = `${name}@${punycodeDomain}`

		return true
	} catch (e) {
		console.error('Error validating NIP-05:', e)
		return false
	}
}

export const nip05ValidationQueryOptions = (npub: string) =>
	queryOptions({
		queryKey: profileKeys.nip05(npub),
		queryFn: () => validateNip05(npub),
	})

// --- DATA EXTRACTION FUNCTIONS ---

export const getProfileName = (profile: NDKUserProfile | null): string => {
	if (!profile) return ''
	return profile.name || profile.displayName || ''
}

export const getProfileNip05 = (profile: NDKUserProfile | null): string | undefined => {
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
