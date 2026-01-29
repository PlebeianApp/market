import { ORDER_MESSAGE_TYPE, ORDER_PROCESS_KIND, SHIPPING_STATUS } from '@/lib/schemas/order'
import { SHIPPING_KIND } from '@/lib/schemas/shippingOption'
import { ndkActions } from '@/lib/stores/ndk'
import { naddrFromAddress } from '@/lib/nostr/naddr'
import type { NDKFilter } from '@nostr-dev-kit/ndk'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { orderKeys, shippingKeys } from './queryKeyFactory'

// Re-export shippingKeys for use in other files
export { shippingKeys }

// --- DELETED SHIPPING OPTIONS TRACKING ---
// Track deleted shipping option d-tags with deletion timestamps to filter them from relay responses.
// Per NIP-09, deletions only apply to events older than the deletion event.
// If a new event with the same d-tag is published after the deletion, it should be visible.
// Persisted to localStorage so deletions survive page reloads.

const DELETED_SHIPPING_STORAGE_KEY = 'plebeian_deleted_shipping_ids'

// Map of d-tag -> deletion timestamp (unix seconds)
const loadDeletedShippingIds = (): Map<string, number> => {
	try {
		const stored = localStorage.getItem(DELETED_SHIPPING_STORAGE_KEY)
		if (stored) {
			const parsed = JSON.parse(stored)
			// Handle legacy format (array of strings) - migrate to new format
			if (Array.isArray(parsed)) {
				const now = Math.floor(Date.now() / 1000)
				return new Map(parsed.map((dTag: string) => [dTag, now]))
			}
			// New format: object with d-tag keys and timestamp values
			if (typeof parsed === 'object' && parsed !== null) {
				return new Map(Object.entries(parsed))
			}
		}
	} catch (e) {
		console.error('Failed to load deleted shipping IDs from localStorage:', e)
	}
	return new Map()
}

const saveDeletedShippingIds = (ids: Map<string, number>) => {
	try {
		localStorage.setItem(DELETED_SHIPPING_STORAGE_KEY, JSON.stringify(Object.fromEntries(ids)))
	} catch (e) {
		console.error('Failed to save deleted shipping IDs to localStorage:', e)
	}
}

const deletedShippingIds = loadDeletedShippingIds()

export const markShippingAsDeleted = (dTag: string, deletionTimestamp?: number) => {
	// Use provided timestamp or current time
	const timestamp = deletionTimestamp ?? Math.floor(Date.now() / 1000)
	deletedShippingIds.set(dTag, timestamp)
	saveDeletedShippingIds(deletedShippingIds)
}

export const isShippingDeleted = (dTag: string, eventCreatedAt?: number) => {
	const deletionTimestamp = deletedShippingIds.get(dTag)
	if (deletionTimestamp === undefined) return false
	// If no event timestamp provided, assume deleted
	if (eventCreatedAt === undefined) return true
	// Per NIP-09: deletion only applies to events older than the deletion
	return eventCreatedAt < deletionTimestamp
}

const filterDeletedShippingOptions = (events: NDKEvent[]): NDKEvent[] => {
	return events.filter((event) => {
		const dTag = event.tags.find((t) => t[0] === 'd')?.[1]
		if (!dTag) return true
		return !isShippingDeleted(dTag, event.created_at)
	})
}

// --- DATA FETCHING FUNCTIONS ---

/**
 * Fetches all shipping options
 * @returns Array of shipping events sorted by creation date
 */
export const fetchShippingOptions = async () => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const filter: NDKFilter = {
		kinds: [SHIPPING_KIND], // Shipping options in Nostr
		limit: 50,
	}

	const events = await ndk.fetchEvents(filter)
	return filterDeletedShippingOptions(Array.from(events))
}

/**
 * Fetches a single shipping option
 * @param id The ID of the shipping option
 * @returns The shipping option event
 */
export const fetchShippingOption = async (id: string) => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const event = await ndk.fetchEvent(id)
	if (!event) {
		throw new Error('Shipping option not found')
	}

	return event
}

/**
 * Fetches a single shipping option by coordinates (pubkey + d-tag)
 * @param pubkey The pubkey of the seller
 * @param dTag The d-tag of the shipping option
 * @returns The shipping option event
 */
export const fetchShippingOptionByCoordinates = async (pubkey: string, dTag: string) => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const naddr = naddrFromAddress(SHIPPING_KIND, pubkey, dTag)
	const event = await ndk.fetchEvent(naddr)

	if (!event) {
		throw new Error('Shipping option not found')
	}

	return event
}

/**
 * Fetches all shipping options from a specific pubkey
 * @param pubkey The pubkey of the seller
 * @returns Array of shipping option events sorted by creation date
 */
export const fetchShippingOptionsByPubkey = async (pubkey: string) => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const filter: NDKFilter = {
		kinds: [SHIPPING_KIND],
		authors: [pubkey],
	}

	const events = await ndk.fetchEvents(filter)
	return filterDeletedShippingOptions(Array.from(events))
}

// --- REACT QUERY OPTIONS ---

/**
 * React Query options for fetching a single shipping option
 * @param id Shipping option ID
 * @returns Query options object
 */
export const shippingOptionQueryOptions = (id: string) =>
	queryOptions({
		queryKey: shippingKeys.details(id),
		queryFn: () => fetchShippingOption(id),
	})

/**
 * React Query options for fetching a single shipping option by coordinates
 * @param pubkey Seller's pubkey
 * @param dTag Shipping option d-tag
 * @returns Query options object
 */
export const shippingOptionByCoordinatesQueryOptions = (pubkey: string, dTag: string) =>
	queryOptions({
		queryKey: shippingKeys.byCoordinates(pubkey, dTag),
		queryFn: () => fetchShippingOptionByCoordinates(pubkey, dTag),
	})

/**
 * React Query options for fetching all shipping options
 */
export const shippingOptionsQueryOptions = queryOptions({
	queryKey: shippingKeys.all,
	queryFn: fetchShippingOptions,
	refetchOnMount: 'always', // Always refetch to pick up deletions
})

/**
 * React Query options for fetching shipping options by pubkey
 * @param pubkey Seller's pubkey
 */
export const shippingOptionsByPubkeyQueryOptions = (pubkey: string) =>
	queryOptions({
		queryKey: shippingKeys.byPubkey(pubkey),
		queryFn: () => fetchShippingOptionsByPubkey(pubkey),
		staleTime: 300000, // Added staleTime of 5 minutes (300,000 ms)
	})

// --- HELPER FUNCTIONS (DATA EXTRACTION) ---

/**
 * Gets the shipping option title from a shipping event
 * @param event The shipping event
 * @returns The shipping option title string
 */
export const getShippingTitle = (event: NDKEvent): string => event.tags.find((t) => t[0] === 'title')?.[1] || 'Standard Shipping'

/**
 * Gets the shipping option description from a shipping event
 * @param event The shipping event
 * @returns The shipping option description string
 */
export const getShippingDescription = (event: NDKEvent): string => event.content || ''

/**
 * Gets the price tag from a shipping event
 * @param event The shipping event
 * @returns A tuple with the format:
 * - [0]: 'price' (literal)
 * - [1]: amount (string)
 * - [2]: currency (string)
 */
export const getShippingPrice = (event: NDKEvent) => {
	const priceTag = event.tags.find((t) => t[0] === 'price')
	if (!priceTag) return undefined

	return priceTag
}

/**
 * Gets the country tag from a shipping event
 * @param event The shipping event
 * @returns The country code or array of country codes
 */
export const getShippingCountry = (event: NDKEvent) => {
	const countryTag = event.tags.find((t) => t[0] === 'country')
	if (!countryTag) return undefined

	return countryTag
}

/**
 * Gets the service tag from a shipping event
 * @param event The shipping event
 * @returns The shipping service type
 */
export const getShippingService = (event: NDKEvent) => {
	const serviceTag = event.tags.find((t) => t[0] === 'service')
	if (!serviceTag) return undefined

	return serviceTag
}

/**
 * Gets the carrier tag from a shipping event
 * @param event The shipping event
 * @returns The carrier name
 */
export const getShippingCarrier = (event: NDKEvent) => {
	const carrierTag = event.tags.find((t) => t[0] === 'carrier')
	if (!carrierTag) return undefined

	return carrierTag
}

/**
 * Gets the location tag from a shipping event
 * @param event The shipping event
 * @returns The location string
 */
export const getShippingLocation = (event: NDKEvent) => {
	const locationTag = event.tags.find((t) => t[0] === 'location')
	if (!locationTag) return undefined

	return locationTag
}

/**
 * Gets the duration tag from a shipping event
 * @param event The shipping event
 * @returns The duration information
 */
export const getShippingDuration = (event: NDKEvent) => {
	const durationTag = event.tags.find((t) => t[0] === 'duration')
	if (!durationTag) return undefined

	return durationTag
}

/**
 * Gets the pickup address from a shipping event
 * @param event The shipping event
 * @returns The pickup address string or undefined
 */
export const getShippingPickupAddress = (event: NDKEvent) => {
	// Try to get structured address first
	const street = event.tags.find((t) => t[0] === 'pickup-street')?.[1]
	const city = event.tags.find((t) => t[0] === 'pickup-city')?.[1]
	const state = event.tags.find((t) => t[0] === 'pickup-state')?.[1]
	const postalCode = event.tags.find((t) => t[0] === 'pickup-postal-code')?.[1]
	const country = event.tags.find((t) => t[0] === 'pickup-country')?.[1]

	// If we have structured data, return it
	if (street || city || state || postalCode || country) {
		return {
			street: street || '',
			city: city || '',
			state: state || '',
			postalCode: postalCode || '',
			country: country || '',
		}
	}

	// Fallback to legacy pickup-address tag for backward compatibility
	const legacyAddress = event.tags.find((t) => t[0] === 'pickup-address')?.[1]
	if (legacyAddress) {
		// Return as a structured object with the full address in street field
		return {
			street: legacyAddress,
			city: '',
			state: '',
			postalCode: '',
			country: '',
		}
	}

	return null
}

/**
 * Get pickup address as a formatted string
 */
export const getShippingPickupAddressString = (event: NDKEvent) => {
	const address = getShippingPickupAddress(event)
	if (!address) return null

	// If it's legacy format (all in street field), return as is
	if (address.street && !address.city && !address.state && !address.postalCode && !address.country) {
		return address.street
	}

	// Format structured address
	return [address.street, address.city, address.state, address.postalCode, address.country].filter(Boolean).join(', ')
}

/**
 * Gets the weight min/max limits from a shipping event
 * @param event The shipping event
 * @returns Object with min and max weight limits
 */
export const getShippingWeightLimits = (event: NDKEvent) => {
	const minTag = event.tags.find((t) => t[0] === 'weight-min')
	const maxTag = event.tags.find((t) => t[0] === 'weight-max')

	return {
		min: minTag,
		max: maxTag,
	}
}

/**
 * Gets the dimension min/max limits from a shipping event
 * @param event The shipping event
 * @returns Object with min and max dimension limits
 */
export const getShippingDimensionLimits = (event: NDKEvent) => {
	const minTag = event.tags.find((t) => t[0] === 'dim-min')
	const maxTag = event.tags.find((t) => t[0] === 'dim-max')

	return {
		min: minTag,
		max: maxTag,
	}
}

/**
 * Gets the creation timestamp from a shipping event
 * @param event The shipping event
 * @returns The creation timestamp (number)
 */
export const getShippingCreatedAt = (event: NDKEvent): number => event.created_at || 0

/**
 * Gets the pubkey from a shipping event
 * @param event The shipping event
 * @returns The pubkey (string)
 */
export const getShippingPubkey = (event: NDKEvent): string => event.pubkey

/**
 * Gets the event ID (d tag) from a shipping event
 * @param event The shipping event
 * @returns The d tag value
 */
export const getShippingId = (event: NDKEvent): string | undefined => {
	return event.tags.find((t) => t[0] === 'd')?.[1]
}

/**
 * Creates a reference to a shipping option using the standard format
 * @param pubkey The pubkey of the seller
 * @param id The ID of the shipping option (d tag)
 * @returns A string in the format "30406:pubkey:id"
 */
export const createShippingReference = (pubkey: string, id: string): string => {
	return `${SHIPPING_KIND}:${pubkey}:${id}`
}

/**
 * Parses a shipping reference to extract the event ID
 * @param reference The shipping reference (either composite "30406:pubkey:id" or direct ID)
 * @returns The event ID (d tag value)
 */
export const parseShippingReference = (reference: string): string => {
	// If it's a composite reference (contains colons), extract the ID part
	if (reference.includes(':')) {
		const parts = reference.split(':')
		if (parts.length === 3 && parts[0] === SHIPPING_KIND.toString()) {
			return parts[2] // Return the ID part
		}
	}
	// Otherwise, assume it's already a direct ID
	return reference
}

export type ShippingUpdateParams = {
	orderEventId: string
	status: (typeof SHIPPING_STATUS)[keyof typeof SHIPPING_STATUS]
	tracking?: string
	carrier?: string
	eta?: number
	reason?: string
	onSuccess?: () => void // Optional callback for client-side refresh
}

/**
 * Updates the shipping status of an order on the Nostr network
 */
export const updateShippingStatus = async (params: ShippingUpdateParams): Promise<string> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const signer = ndkActions.getSigner()
	if (!signer) throw new Error('No active user')

	// Fetch the original order to get the counterparty pubkey
	const originalOrder = await ndk.fetchEvent({
		ids: [params.orderEventId],
	})

	if (!originalOrder) throw new Error('Original order not found')

	// Extract the original order ID from the order tag
	const originalOrderIdTag = originalOrder.tags.find((tag) => tag[0] === 'order')
	const originalOrderId = originalOrderIdTag?.[1]

	// Determine the recipient based on who's sending the update
	// If current user is the buyer, send to seller (recipient in original order)
	// If current user is the seller, send to buyer (author of original order)
	const currentUserPubkey = ndk.activeUser?.pubkey
	let recipientPubkey: string

	if (currentUserPubkey === originalOrder.pubkey) {
		// Current user is the buyer, send to seller
		const recipientTag = originalOrder.tags.find((tag) => tag[0] === 'p')
		recipientPubkey = recipientTag?.[1] || ''
	} else {
		// Current user is the seller, send to buyer
		recipientPubkey = originalOrder.pubkey
	}

	if (!recipientPubkey) throw new Error('Recipient pubkey not found')

	// Create the shipping update event
	const event = new NDKEvent(ndk)
	event.kind = ORDER_PROCESS_KIND
	event.content = params.reason || `Shipping status updated to ${params.status}`
	event.tags = [
		['p', recipientPubkey],
		['subject', 'shipping-info'],
		['type', ORDER_MESSAGE_TYPE.SHIPPING_UPDATE], // Type 4 for shipping updates
		['order', originalOrderId || params.orderEventId], // Use the original order ID when available
		['status', params.status],
	]

	// Add optional tracking information if provided
	if (params.tracking) {
		event.tags.push(['tracking', params.tracking])
	}

	// Add optional carrier information if provided
	if (params.carrier) {
		event.tags.push(['carrier', params.carrier])
	}

	// Add optional ETA information if provided
	if (params.eta) {
		event.tags.push(['eta', params.eta.toString()])
	}

	// Sign and publish the event
	await event.sign(signer)
	await ndkActions.publishEvent(event)

	return event.id
}

/**
 * Mutation hook for updating shipping status
 */
export const useUpdateShippingStatusMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const currentUserPubkey = ndk?.activeUser?.pubkey

	return useMutation({
		mutationFn: updateShippingStatus,
		onSuccess: async (eventId, params) => {
			// Show toast first for immediate feedback
			toast.success(`Order shipping status updated to ${params.status}`)

			// Call the onSuccess callback if provided (for client-side refresh)
			if (params.onSuccess) {
				params.onSuccess()
				return // Exit early if the client is handling the refresh
			}

			// Invalidate all relevant queries
			await queryClient.invalidateQueries({ queryKey: orderKeys.all })
			await queryClient.invalidateQueries({ queryKey: orderKeys.details(params.orderEventId) })

			// If we have the current user's pubkey, invalidate user specific queries
			if (currentUserPubkey) {
				await queryClient.invalidateQueries({ queryKey: orderKeys.byPubkey(currentUserPubkey) })
				await queryClient.invalidateQueries({ queryKey: orderKeys.byBuyer(currentUserPubkey) })
				await queryClient.invalidateQueries({ queryKey: orderKeys.bySeller(currentUserPubkey) })
			}

			// Trigger a refetch to show updated status
			queryClient.refetchQueries({ queryKey: orderKeys.details(params.orderEventId) })
		},
		onError: (error) => {
			console.error('Failed to update shipping status:', error)
			toast.error('Failed to update shipping status')
		},
	})
}

/**
 * Extracts full shipping information in a user-friendly format
 * @param event The shipping event
 * @returns A structured object with all shipping details
 */
export const getShippingInfo = (event: NDKEvent) => {
	if (!event) return null

	const id = getShippingId(event)
	const title = getShippingTitle(event)
	const priceTag = getShippingPrice(event)
	const countryTag = getShippingCountry(event) || ['country']
	const serviceTag = getShippingService(event)

	// Return null if any required field is missing (country is optional - empty means worldwide)
	if (!id || !title || !priceTag || !serviceTag) {
		return null
	}

	// Country tag is optional - empty/missing means worldwide shipping
	const countries = countryTag ? countryTag.slice(1) : [] // Remove the 'country' tag name, get all country codes

	return {
		id,
		title,
		description: getShippingDescription(event),
		price: {
			amount: priceTag[1],
			currency: priceTag[2],
		},
		countries,
		service: serviceTag[1],
		carrier: getShippingCarrier(event)?.[1],
		location: getShippingLocation(event)?.[1],
		duration: getShippingDuration(event)
			? {
					min: getShippingDuration(event)?.[1],
					max: getShippingDuration(event)?.[2],
					unit: getShippingDuration(event)?.[3],
				}
			: undefined,
		weightLimits: {
			min: getShippingWeightLimits(event).min?.[1],
			minUnit: getShippingWeightLimits(event).min?.[2],
			max: getShippingWeightLimits(event).max?.[1],
			maxUnit: getShippingWeightLimits(event).max?.[2],
		},
		dimensionLimits: {
			min: getShippingDimensionLimits(event).min?.[1],
			minUnit: getShippingDimensionLimits(event).min?.[2],
			max: getShippingDimensionLimits(event).max?.[1],
			maxUnit: getShippingDimensionLimits(event).max?.[2],
		},
		sellerPubkey: getShippingPubkey(event),
		createdAt: getShippingCreatedAt(event),
	}
}

/**
 * Gets the event that created a shipping option based on its ID
 * @param id The shipping option event ID
 * @returns A promise that resolves to the NDKEvent or null if not found
 */
export const getShippingEvent = async (id: string) => {
	try {
		return await fetchShippingOption(id)
	} catch (error) {
		console.error(`Failed to fetch shipping event: ${id}`, error)
		return null
	}
}

// --- REACT QUERY HOOKS ---

/**
 * Hook to get the shipping option title
 * @param id Shipping option ID
 * @returns Query result with the shipping title
 */
export const useShippingTitle = (id: string) => {
	return useQuery({
		...shippingOptionQueryOptions(id),
		select: getShippingTitle,
	})
}

/**
 * Hook to get the shipping option description
 * @param id Shipping option ID
 * @returns Query result with the shipping description
 */
export const useShippingDescription = (id: string) => {
	return useQuery({
		...shippingOptionQueryOptions(id),
		select: getShippingDescription,
	})
}

/**
 * Hook to get the shipping option price
 * @param id Shipping option ID
 * @returns Query result with the shipping price tuple
 */
export const useShippingPrice = (id: string) => {
	return useQuery({
		...shippingOptionQueryOptions(id),
		select: getShippingPrice,
	})
}

/**
 * Hook to get the shipping option country
 * @param id Shipping option ID
 * @returns Query result with the shipping country info
 */
export const useShippingCountry = (id: string) => {
	return useQuery({
		...shippingOptionQueryOptions(id),
		select: getShippingCountry,
	})
}

/**
 * Hook to get the shipping option service type
 * @param id Shipping option ID
 * @returns Query result with the shipping service type
 */
export const useShippingService = (id: string) => {
	return useQuery({
		...shippingOptionQueryOptions(id),
		select: getShippingService,
	})
}

/**
 * Hook to get shipping options by pubkey
 * @param pubkey Seller's pubkey
 * @returns Query result with an array of shipping option events
 */
export const useShippingOptionsByPubkey = (pubkey: string) => {
	return useQuery({
		...shippingOptionsByPubkeyQueryOptions(pubkey),
		enabled: !!pubkey,
	})
}

/**
 * Hook to get all shipping options
 * @returns Query result with an array of shipping option events
 */
export const useShippingOptions = () => {
	return useQuery({
		...shippingOptionsQueryOptions,
	})
}

/**
 * Hook to get complete shipping info in a user-friendly format
 * @param id Shipping option ID
 * @returns Query result with structured shipping information
 */
export const useShippingInfo = (id: string) => {
	return useQuery({
		...shippingOptionQueryOptions(id),
		select: getShippingInfo,
	})
}
