import { ndkActions } from '@/lib/stores/ndk'
import { type NDKUserProfile, NDKSubscriptionCacheUsage, NDKUser, NDKRelaySet } from '@nostr-dev-kit/ndk'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { profileKeys } from './queryKeyFactory'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { nip19 } from 'nostr-tools'
import { defaultRelaysUrls, writeRelaysUrls } from '@/lib/constants'
import { configActions } from '@/lib/stores/config'

// Helper: fetch author's relay list (kind 10002) and add read relays to NDK explicit pool
const __authorRelayCache = new Map<string, { urls: string[]; fetchedAt: number }>()
const AUTHOR_RELAY_CACHE_TTL_MS = 5 * 60 * 1000
const ensureUserRelays = async (pubkey: string): Promise<string[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk || !pubkey) return []
	try {
		const now = Date.now()
		const cached = __authorRelayCache.get(pubkey)
		if (cached && now - cached.fetchedAt < AUTHOR_RELAY_CACHE_TTL_MS) {
			return cached.urls
		}
		const appRelay = configActions.getAppRelay()
		const baseRelays = appRelay ? [...defaultRelaysUrls, appRelay] : [...defaultRelaysUrls]
		const baseSet = NDKRelaySet.fromRelayUrls(baseRelays, ndk)
		const writeSet = NDKRelaySet.fromRelayUrls(writeRelaysUrls, ndk)
		let relayListEvt: NDKEvent | null = null
		// Try base relays first
		try {
			const result = await ndk.fetchEvents({ kinds: [10002 as any], authors: [pubkey], limit: 1 }, undefined, baseSet)
			const arr = Array.from(result)
			if (arr.length > 0) relayListEvt = arr.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
		} catch {}
		// Fallback to write relays
		if (!relayListEvt) {
			try {
				const result = await ndk.fetchEvents({ kinds: [10002 as any], authors: [pubkey], limit: 1 }, undefined, writeSet)
				const arr = Array.from(result)
				if (arr.length > 0) relayListEvt = arr.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
			} catch {}
		}
		if (!relayListEvt) {
			console.log('[profiles] No relay list (kind 10002) found for author; using existing relays', { author: pubkey })
			__authorRelayCache.set(pubkey, { urls: [], fetchedAt: now })
			return []
		}
		const readRelays: string[] = (relayListEvt.tags || [])
			.filter(
				(t) =>
					Array.isArray(t) &&
					t[0] === 'r' &&
					typeof t[1] === 'string' &&
					(t[2] === undefined || t[2] === '' || t[2] === 'read' || t[2] === 'both'),
			)
			.map((t: any) => (t[1] as string).trim())
			.filter((u) => /^wss:\/\//i.test(u)) as string[]
		const unique = Array.from(new Set(readRelays))
		if (unique.length > 0) {
			const added = ndkActions.addExplicitRelay(unique)
			console.log('[profiles] Added user read relays from kind 10002', {
				author: pubkey,
				relaysAdded: unique,
				totalExplicitRelays: added.length,
			})
		}
		__authorRelayCache.set(pubkey, { urls: unique, fetchedAt: now })
		return unique
	} catch (e) {
		console.warn('[profiles] Failed to fetch/apply relay list for author', pubkey, e)
		return []
	}
}

export const fetchProfileByNpub = async (npub: string): Promise<NDKUserProfile | null> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	try {
		// Resolve user and fetch metadata (kind 0) across all connected read relays
		let pubkey = ''
		try {
			const decoded = nip19.decode(npub)
			if (typeof decoded.data === 'string') pubkey = decoded.data
		} catch {}
		const user = ndk.getUser({ pubkey: pubkey || undefined, npub })
		const author = pubkey || user.pubkey
		if (!author) return null
		const relays = await ensureUserRelays(author)
		const appRelay = configActions.getAppRelay()
		const baseRelays = appRelay ? [...defaultRelaysUrls, appRelay] : [...defaultRelaysUrls]
		const merged = Array.from(new Set<string>([...baseRelays, ...relays])).slice(0, 40)
		const relaySet = NDKRelaySet.fromRelayUrls(merged, ndk)
		const evt = await ndk.fetchEvent({ kinds: [0], authors: [author] }, { cacheUsage: NDKSubscriptionCacheUsage.PARALLEL }, relaySet)
		if (!evt) {
			console.warn('[profiles] No kind 0 found after including user relays', { author, connected: ndk.pool.connectedRelays().length })
			return null
		}
		try {
			console.log('[profiles] Kind 0 event fetched (by npub)', {
				author,
				id: evt.id,
				created_at: (evt as any).created_at,
				contentPreview: (evt.content || '').slice(0, 120),
			})
			return JSON.parse(evt.content) as NDKUserProfile
		} catch (err) {
			console.warn('Failed to parse profile metadata content for npub:', npub, err)
			return null
		}
	} catch (e) {
		console.error('Failed to fetch profile with NDK across read relays', e)
		return null
	}
}

export const fetchProfileByNip05 = async (nip05: string): Promise<NDKUserProfile | null> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	try {
		const user = await ndk.getUserFromNip05(nip05)
		if (!user) throw new Error('User not found')
		const relays = await ensureUserRelays(user.pubkey)
		const appRelay = configActions.getAppRelay()
		const baseRelays = appRelay ? [...defaultRelaysUrls, appRelay] : [...defaultRelaysUrls]
		const merged = Array.from(new Set<string>([...baseRelays, ...relays])).slice(0, 40)
		const relaySet = NDKRelaySet.fromRelayUrls(merged, ndk)
		const evt = await ndk.fetchEvent({ kinds: [0], authors: [user.pubkey] }, { cacheUsage: NDKSubscriptionCacheUsage.PARALLEL }, relaySet)
		if (!evt) {
			console.warn('[profiles] No kind 0 found after including user relays (nip05)', {
				author: user.pubkey,
				connected: ndk.pool.connectedRelays().length,
			})
			return null
		}
		try {
			console.log('[profiles] Kind 0 event fetched (by nip05)', {
				author: user.pubkey,
				id: evt.id,
				created_at: (evt as any).created_at,
				contentPreview: (evt.content || '').slice(0, 120),
			})
			return JSON.parse(evt.content) as NDKUserProfile
		} catch (err) {
			console.warn('Failed to parse profile metadata content for nip05:', nip05, err)
			return null
		}
	} catch (e) {
		console.error('Failed to fetch profile across read relays', e)
		return null
	}
}

export const fetchProfileByIdentifier = async (identifier: string): Promise<{ profile: NDKUserProfile | null; user: NDKUser | null }> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	try {
		let user: NDKUser | null | undefined = null
		let authorHex = ''
		if (identifier.includes('@')) {
			user = await ndk.getUserFromNip05(identifier)
			if (!user) return { profile: null, user: null }
			authorHex = user.pubkey
		} else if (identifier.startsWith('npub')) {
			let decodedHex = ''
			try {
				const decoded = nip19.decode(identifier)
				if (typeof decoded.data === 'string') decodedHex = decoded.data
			} catch {}
			user = ndk.getUser({ pubkey: decodedHex || undefined, npub: identifier })
			authorHex = decodedHex || user.pubkey
		} else {
			user = ndk.getUser({ pubkey: identifier })
			authorHex = identifier
		}

		if (!authorHex) return { profile: null, user }
		const relays = await ensureUserRelays(authorHex)
		const appRelay = configActions.getAppRelay()
		const baseRelays = appRelay ? [...defaultRelaysUrls, appRelay] : [...defaultRelaysUrls]
		const merged = Array.from(new Set<string>([...baseRelays, ...relays])).slice(0, 40)
		const relaySet = NDKRelaySet.fromRelayUrls(merged, ndk)
		const evt = await ndk.fetchEvent({ kinds: [0], authors: [authorHex] }, { cacheUsage: NDKSubscriptionCacheUsage.PARALLEL }, relaySet)
		if (!evt) {
			console.warn('[profiles] No kind 0 found after including user relays (identifier)', {
				author: authorHex,
				identifier,
				connected: ndk.pool.connectedRelays().length,
			})
			return { profile: null, user }
		}
		try {
			console.log('[profiles] Kind 0 event fetched (by identifier)', {
				author: authorHex,
				id: evt.id,
				created_at: (evt as any).created_at,
				contentPreview: (evt.content || '').slice(0, 120),
				identifier,
			})
			const profile = JSON.parse(evt.content) as NDKUserProfile
			return { profile, user }
		} catch (err) {
			console.warn('Failed to parse profile metadata content for identifier:', identifier, err)
			return { profile: null, user }
		}
	} catch (e) {
		console.error('Failed to fetch profile with identifier across read relays:', e)
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

export const profileByIdentifierQueryOptions = (identifier: string) => {
	// Normalize query key to reduce duplicate fetches across identifier forms
	// - If nip05, key separately under byNip05 to avoid clashes.
	// - If npub, decode to hex and use hex for the key so hex/npub share cache.
	// - If hex, use as-is.
	let key: readonly unknown[]
	if (identifier.includes('@')) {
		key = profileKeys.detailsByNip05(identifier)
	} else if (identifier.startsWith('npub')) {
		let decodedHex = ''
		try {
			const decoded = nip19.decode(identifier)
			if (typeof decoded.data === 'string') decodedHex = decoded.data
		} catch {}
		key = profileKeys.details(decodedHex || identifier)
	} else {
		key = profileKeys.details(identifier)
	}
	return queryOptions({
		queryKey: key,
		queryFn: () => fetchProfileByIdentifier(identifier),
	})
}

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
