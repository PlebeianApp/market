import {
	VANITY_CONFIG_KIND,
	VANITY_REQUEST_KIND,
	VANITY_CONFIRMATION_KIND,
	generateVanityDTag,
	isVanityExpired,
	type VanityConfig,
	type VanityRequest,
	type VanityConfirmation,
	type VanityAddress,
	type VanityStatus,
} from '@/lib/schemas/vanity'
import { ndkActions } from '@/lib/stores/ndk'
import type { NDKFilter, NDKEvent } from '@nostr-dev-kit/ndk'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { vanityKeys } from './queryKeyFactory'

// Re-export vanityKeys for use in other files
export { vanityKeys }

// Environment variables
const VANITY_SERVER_PUBKEY = import.meta.env.VITE_VANITY_SERVER_PUBKEY as string | undefined
const VANITY_DOMAIN = import.meta.env.VITE_VANITY_DOMAIN as string | undefined

// --- DELETED VANITY TRACKING ---
// Track deleted vanity request IDs to filter them out
const DELETED_VANITY_STORAGE_KEY = 'plebeian_deleted_vanity_ids'

const loadDeletedVanityIds = (): Set<string> => {
	try {
		const stored = localStorage.getItem(DELETED_VANITY_STORAGE_KEY)
		if (stored) {
			const parsed = JSON.parse(stored)
			if (Array.isArray(parsed)) {
				return new Set(parsed)
			}
		}
	} catch (e) {
		console.error('Failed to load deleted vanity IDs from localStorage:', e)
	}
	return new Set()
}

const saveDeletedVanityIds = (ids: Set<string>) => {
	try {
		localStorage.setItem(DELETED_VANITY_STORAGE_KEY, JSON.stringify(Array.from(ids)))
	} catch (e) {
		console.error('Failed to save deleted vanity IDs to localStorage:', e)
	}
}

const deletedVanityIds = loadDeletedVanityIds()

export const markVanityAsDeleted = (dTag: string) => {
	deletedVanityIds.add(dTag)
	saveDeletedVanityIds(deletedVanityIds)
}

export const isVanityDeleted = (dTag: string) => {
	return deletedVanityIds.has(dTag)
}

// --- HELPER FUNCTIONS ---

const parseVanityConfig = (event: NDKEvent): VanityConfig => {
	const config: VanityConfig = {
		domain: '',
		lud16: '',
		price: 2000, // default
		duration: 31536000, // default 1 year
	}

	for (const tag of event.tags) {
		if (tag.length < 2) continue
		switch (tag[0]) {
			case 'd':
				config.domain = tag[1]
				break
			case 'lud16':
				config.lud16 = tag[1]
				break
			case 'price':
				config.price = parseInt(tag[1], 10) || 2000
				break
			case 'duration':
				config.duration = parseInt(tag[1], 10) || 31536000
				break
		}
	}

	return config
}

const parseVanityRequest = (event: NDKEvent): VanityRequest => {
	const request: VanityRequest = {
		eventId: event.id,
		pubkey: event.pubkey,
		name: '',
		domain: '',
		dTag: '',
		createdAt: event.created_at || 0,
	}

	for (const tag of event.tags) {
		if (tag.length < 2) continue
		switch (tag[0]) {
			case 'd':
				request.dTag = tag[1]
				break
			case 'name':
				request.name = tag[1]
				break
			case 'domain':
				request.domain = tag[1]
				break
		}
	}

	return request
}

const parseVanityConfirmation = (event: NDKEvent): VanityConfirmation => {
	const confirmation: VanityConfirmation = {
		eventId: event.id,
		userPubkey: '',
		name: '',
		domain: '',
		dTag: '',
		validUntil: 0,
		paymentHash: '',
		revoked: false,
		createdAt: event.created_at || 0,
	}

	for (const tag of event.tags) {
		if (tag.length < 2) continue
		switch (tag[0]) {
			case 'd':
				confirmation.dTag = tag[1]
				break
			case 'p':
				confirmation.userPubkey = tag[1]
				break
			case 'name':
				confirmation.name = tag[1]
				break
			case 'domain':
				confirmation.domain = tag[1]
				break
			case 'valid_until':
				confirmation.validUntil = parseInt(tag[1], 10) || 0
				break
			case 'payment_hash':
				confirmation.paymentHash = tag[1]
				break
			case 'revoked':
				confirmation.revoked = true
				confirmation.revokedAt = parseInt(tag[1], 10)
				break
		}
	}

	return confirmation
}

// --- DATA FETCHING FUNCTIONS ---

/**
 * Fetches the vanity config for a domain
 */
export const fetchVanityConfig = async (domain: string): Promise<VanityConfig | null> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	if (!VANITY_SERVER_PUBKEY) return null

	const filter: NDKFilter = {
		kinds: [VANITY_CONFIG_KIND],
		authors: [VANITY_SERVER_PUBKEY],
		'#d': [domain],
		limit: 1,
	}

	const events = await ndk.fetchEvents(filter)
	const event = Array.from(events)[0]
	if (!event) return null

	return parseVanityConfig(event)
}

/**
 * Fetches a vanity confirmation by name and domain
 * Used to check if a name is available
 */
export const fetchVanityConfirmation = async (name: string, domain: string): Promise<VanityConfirmation | null> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	if (!VANITY_SERVER_PUBKEY) return null

	const dTag = generateVanityDTag(name, domain)

	const filter: NDKFilter = {
		kinds: [VANITY_CONFIRMATION_KIND],
		authors: [VANITY_SERVER_PUBKEY],
		'#d': [dTag],
		limit: 1,
	}

	const events = await ndk.fetchEvents(filter)
	const event = Array.from(events)[0]
	if (!event) return null

	return parseVanityConfirmation(event)
}

/**
 * Fetches all Kind 5 deletion events from a user that reference vanity requests
 */
const fetchUserVanityDeletions = async (pubkey: string): Promise<Set<string>> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const deletedDTags = new Set<string>()

	// Fetch all Kind 5 deletions from this user
	const filter: NDKFilter = {
		kinds: [5],
		authors: [pubkey],
		limit: 100,
	}

	const events = await ndk.fetchEvents(filter)

	// Extract deleted vanity request d-tags from a-tags
	for (const event of Array.from(events)) {
		for (const tag of event.tags) {
			if (tag[0] === 'a' && tag[1]) {
				// a-tag format: kind:pubkey:d-tag
				const parts = tag[1].split(':')
				if (parts.length === 3 && parts[0] === String(VANITY_REQUEST_KIND)) {
					deletedDTags.add(parts[2])
				}
			}
		}
	}

	return deletedDTags
}

/**
 * Fetches all vanity requests from a user
 */
const fetchUserVanityRequests = async (pubkey: string): Promise<VanityRequest[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const filter: NDKFilter = {
		kinds: [VANITY_REQUEST_KIND],
		authors: [pubkey],
		limit: 50,
	}

	const events = await ndk.fetchEvents(filter)
	return Array.from(events).map(parseVanityRequest)
}

/**
 * Fetches all vanity confirmations for a user
 */
const fetchUserVanityConfirmations = async (pubkey: string): Promise<VanityConfirmation[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	if (!VANITY_SERVER_PUBKEY) return []

	const filter: NDKFilter = {
		kinds: [VANITY_CONFIRMATION_KIND],
		authors: [VANITY_SERVER_PUBKEY],
		'#p': [pubkey],
		limit: 50,
	}

	const events = await ndk.fetchEvents(filter)
	return Array.from(events).map(parseVanityConfirmation)
}

/**
 * Fetches all vanity addresses for a user, combining requests and confirmations
 * CRITICAL: Fetches deletions FIRST before determining state
 */
export const fetchUserVanityAddresses = async (pubkey: string): Promise<VanityAddress[]> => {
	// Step 1: Fetch deletions FIRST
	const deletedDTags = await fetchUserVanityDeletions(pubkey)

	// Also include locally tracked deletions
	Array.from(deletedVanityIds).forEach((dTag) => {
		deletedDTags.add(dTag)
	})

	// Step 2: Fetch requests and confirmations in parallel
	const [requests, confirmations] = await Promise.all([fetchUserVanityRequests(pubkey), fetchUserVanityConfirmations(pubkey)])

	// Step 3: Build a map of addresses by d-tag
	const addressMap = new Map<string, VanityAddress>()

	// Add requests
	for (const request of requests) {
		if (deletedDTags.has(request.dTag)) continue

		addressMap.set(request.dTag, {
			name: request.name,
			domain: request.domain,
			dTag: request.dTag,
			status: 'pending_confirmation',
			request,
			isDeleted: false,
		})
	}

	// Add/update with confirmations
	for (const confirmation of confirmations) {
		if (deletedDTags.has(confirmation.dTag)) continue

		const existing = addressMap.get(confirmation.dTag)

		let status: VanityStatus
		if (confirmation.revoked) {
			status = 'revoked'
		} else if (isVanityExpired(confirmation.validUntil)) {
			status = 'expired'
		} else {
			status = 'active'
		}

		addressMap.set(confirmation.dTag, {
			name: confirmation.name,
			domain: confirmation.domain,
			dTag: confirmation.dTag,
			status,
			request: existing?.request,
			confirmation,
			isDeleted: false,
		})
	}

	// Step 4: Sort by status (active > pending > expired > revoked) then by name
	const statusOrder: Record<VanityStatus, number> = {
		active: 0,
		pending_payment: 1,
		pending_confirmation: 2,
		expired: 3,
		revoked: 4,
		available: 5,
	}

	return Array.from(addressMap.values()).sort((a, b) => {
		const statusDiff = statusOrder[a.status] - statusOrder[b.status]
		if (statusDiff !== 0) return statusDiff
		return a.name.localeCompare(b.name)
	})
}

// --- REACT QUERY OPTIONS ---

/**
 * React Query options for fetching vanity config
 */
export const vanityConfigQueryOptions = (domain: string) =>
	queryOptions({
		queryKey: vanityKeys.config(domain),
		queryFn: () => fetchVanityConfig(domain),
		staleTime: 5 * 60 * 1000, // 5 minutes
		enabled: !!domain && !!VANITY_SERVER_PUBKEY,
	})

/**
 * React Query options for checking name availability
 */
export const vanityConfirmationQueryOptions = (name: string, domain: string) =>
	queryOptions({
		queryKey: vanityKeys.confirmationByName(name, domain),
		queryFn: () => fetchVanityConfirmation(name, domain),
		staleTime: 30 * 1000, // 30 seconds
		enabled: !!name && !!domain && !!VANITY_SERVER_PUBKEY,
	})

/**
 * React Query options for fetching user's vanity addresses
 */
export const userVanityAddressesQueryOptions = (pubkey: string | undefined) =>
	queryOptions({
		queryKey: vanityKeys.userAddresses(pubkey || ''),
		queryFn: () => fetchUserVanityAddresses(pubkey!),
		staleTime: 30 * 1000, // 30 seconds
		enabled: !!pubkey,
	})

// --- REACT QUERY HOOKS ---

/**
 * Hook to fetch vanity config
 */
export const useVanityConfig = (domain?: string) => {
	const effectiveDomain = domain || VANITY_DOMAIN || ''
	return useQuery({
		...vanityConfigQueryOptions(effectiveDomain),
	})
}

/**
 * Hook to check if a name is available
 */
export const useCheckNameAvailability = (name: string, domain?: string) => {
	const effectiveDomain = domain || VANITY_DOMAIN || ''
	const query = useQuery({
		...vanityConfirmationQueryOptions(name.toLowerCase(), effectiveDomain),
	})

	const isAvailable = !query.data || query.data.revoked || isVanityExpired(query.data.validUntil)

	return {
		...query,
		isAvailable,
		isTaken: query.data && !query.data.revoked && !isVanityExpired(query.data.validUntil),
	}
}

/**
 * Hook to fetch user's vanity addresses
 */
export const useUserVanityAddresses = (pubkey: string | undefined) => {
	return useQuery({
		...userVanityAddressesQueryOptions(pubkey),
	})
}

/**
 * Hook to poll for vanity confirmation after payment
 */
export const useVanityConfirmationPolling = (dTag: string, enabled: boolean) => {
	const parts = dTag.split(':')
	const name = parts[0] || ''
	const domain = parts[1] || VANITY_DOMAIN || ''

	return useQuery({
		queryKey: vanityKeys.confirmationByName(name, domain),
		queryFn: () => fetchVanityConfirmation(name, domain),
		enabled: enabled && !!name && !!domain && !!VANITY_SERVER_PUBKEY,
		refetchInterval: enabled ? 3000 : false, // Poll every 3 seconds when enabled
		refetchIntervalInBackground: false,
	})
}

/**
 * Get the vanity domain from environment
 */
export const getVanityDomain = (): string => {
	return VANITY_DOMAIN || ''
}

/**
 * Get the vanity server pubkey from environment
 */
export const getVanityServerPubkey = (): string => {
	return VANITY_SERVER_PUBKEY || ''
}

/**
 * Check if vanity feature is configured
 */
export const isVanityConfigured = (): boolean => {
	return !!VANITY_SERVER_PUBKEY && !!VANITY_DOMAIN
}

// --- PUBLIC VANITY LINK QUERIES ---

/**
 * Fetches active vanity links for a pubkey (for display on profile pages)
 * Only returns active (non-expired, non-revoked) vanity addresses
 */
export const fetchActiveVanityLinksForPubkey = async (pubkey: string): Promise<{ name: string; domain: string; url: string }[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) return []
	if (!VANITY_SERVER_PUBKEY) return []

	const filter: NDKFilter = {
		kinds: [VANITY_CONFIRMATION_KIND],
		authors: [VANITY_SERVER_PUBKEY],
		'#p': [pubkey],
		limit: 10,
	}

	const events = await ndk.fetchEvents(filter)
	const confirmations = Array.from(events).map(parseVanityConfirmation)

	// Filter to only active (non-expired, non-revoked) confirmations
	const activeLinks = confirmations
		.filter((c) => !c.revoked && !isVanityExpired(c.validUntil))
		.map((c) => ({
			name: c.name,
			domain: c.domain,
			url: `https://${c.domain}/${c.name}`,
		}))

	return activeLinks
}

/**
 * React Query options for fetching active vanity links for a pubkey
 */
export const activeVanityLinksQueryOptions = (pubkey: string | undefined) =>
	queryOptions({
		queryKey: vanityKeys.userLinks(pubkey || ''),
		queryFn: () => fetchActiveVanityLinksForPubkey(pubkey!),
		staleTime: 5 * 60 * 1000, // 5 minutes
		enabled: !!pubkey && !!VANITY_SERVER_PUBKEY,
	})

/**
 * Hook to fetch active vanity links for a pubkey (for profile display)
 */
export const useActiveVanityLinks = (pubkey: string | undefined) => {
	return useQuery({
		...activeVanityLinksQueryOptions(pubkey),
	})
}
