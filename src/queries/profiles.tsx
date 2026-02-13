import { ndkActions } from '@/lib/stores/ndk'
import { type NDKUserProfile, NDKEvent, NDKUser } from '@nostr-dev-kit/ndk'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { profileKeys } from './queryKeyFactory'

export const fetchProfileByNpub = async (npub: string): Promise<NDKUserProfile | null> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	try {
		const user = await ndk.fetchUser(npub)
		if (!user) throw new Error('User not found')
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
		const user = await ndk.fetchUser(nip05)
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

	const timeoutMs = 8000
	try {
		const result = await Promise.race([
			(async () => {
				const user = await ndk.fetchUser(identifier)
				if (!user) return { profile: null, user: null }
				const profile = await user.fetchProfile()
				return { profile, user }
			})(),
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Profile fetch timed out')), timeoutMs)),
		])
		return result
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
		const user = await ndk.fetchUser(pubkey)
		if (!user) return null

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

export const useProfile = (pubkey: string | undefined) => {
	return useQuery({
		queryKey: profileKeys.details(pubkey ?? ''),
		queryFn: () => fetchProfileByIdentifier(pubkey!),
		enabled: !!pubkey,
		staleTime: 5 * 60 * 1000,
		retry: 2,
	})
}

export const checkZapCapability = async (event: NDKEvent | NDKUser): Promise<boolean> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const pubkey = event.pubkey
	if (!pubkey) return false

	try {
		const baseUser = event instanceof NDKUser ? event : event.author
		const userToZap = baseUser?.ndk ? baseUser : await ndk.fetchUser(pubkey)
		if (!userToZap) return false

		const zapInfo = await userToZap.getZapInfo()
		return zapInfo.size > 0
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

export type ZapMethod = 'nip57' | 'nip61'

export interface ZapCapabilityInfo {
	canReceiveZaps: boolean
	methods: ZapMethod[]
	hasLightning: boolean // nip57 - traditional Lightning zaps
	hasCashu: boolean // nip61 - Cashu/Nutzaps
}

export const checkZapCapabilityByNpub = async (npub: string): Promise<boolean> => {
	// Guard against empty or invalid npub
	if (!npub || !npub.startsWith('npub')) {
		return false
	}

	try {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		// Get user from NDK (ensures NDK instance is attached)
		const user = await ndk.fetchUser(npub)
		if (!user) return false

		// Check zap capability - get zap info directly
		const zapInfo = await user.getZapInfo()
		return zapInfo.size > 0
	} catch (error) {
		console.error('Error checking zap capability by npub:', error)
		return false
	}
}

export const getZapCapabilityInfo = async (npub: string): Promise<ZapCapabilityInfo> => {
	const defaultResult: ZapCapabilityInfo = {
		canReceiveZaps: false,
		methods: [],
		hasLightning: false,
		hasCashu: false,
	}

	// Guard against empty or invalid npub
	if (!npub || !npub.startsWith('npub')) {
		return defaultResult
	}

	try {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		// Get user from NDK (ensures NDK instance is attached)
		const user = await ndk.fetchUser(npub)
		if (!user) return defaultResult

		// Get zap info
		const zapInfo = await user.getZapInfo()

		const methods: ZapMethod[] = []
		let hasLightning = false
		let hasCashu = false

		zapInfo.forEach((_, method) => {
			methods.push(method as ZapMethod)
			if (method === 'nip57') hasLightning = true
			if (method === 'nip61') hasCashu = true
		})

		return {
			canReceiveZaps: zapInfo.size > 0,
			methods,
			hasLightning,
			hasCashu,
		}
	} catch (error) {
		console.error('Error getting zap capability info:', error)
		return defaultResult
	}
}

export const zapCapabilityByNpubQueryOptions = (npub: string) =>
	queryOptions({
		queryKey: profileKeys.zapCapability(npub),
		queryFn: () => checkZapCapabilityByNpub(npub),
		enabled: !!npub && npub.startsWith('npub'),
	})

export const useZapCapabilityByNpub = (npub: string) => {
	return useQuery({
		...zapCapabilityByNpubQueryOptions(npub),
		enabled: !!npub && npub.startsWith('npub'),
		select: (data) => data,
	})
}

export const zapCapabilityInfoQueryOptions = (npub: string) =>
	queryOptions({
		queryKey: [...profileKeys.zapCapability(npub), 'info'],
		queryFn: () => getZapCapabilityInfo(npub),
		enabled: !!npub && npub.startsWith('npub'),
	})

export const useZapCapabilityInfo = (npub: string) => {
	return useQuery({
		...zapCapabilityInfoQueryOptions(npub),
		enabled: !!npub && npub.startsWith('npub'),
	})
}
