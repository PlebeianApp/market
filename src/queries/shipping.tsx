import { SHIPPING_KIND } from '@/lib/schemas/shippingOption'
import { ndkActions } from '@/lib/stores/ndk'
import type { NDKFilter } from '@nostr-dev-kit/ndk'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { shippingKeys } from './queryKeyFactory'

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
	return Array.from(events)
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
	return Array.from(events)
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
 * React Query options for fetching all shipping options
 */
export const shippingOptionsQueryOptions = queryOptions({
	queryKey: shippingKeys.all,
	queryFn: fetchShippingOptions,
})

/**
 * React Query options for fetching shipping options by pubkey
 * @param pubkey Seller's pubkey
 */
export const shippingOptionsByPubkeyQueryOptions = (pubkey: string) =>
	queryOptions({
		queryKey: shippingKeys.byPubkey(pubkey),
		queryFn: () => fetchShippingOptionsByPubkey(pubkey),
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
	return `30406:${pubkey}:${id}`
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
	const countryTag = getShippingCountry(event)
	const serviceTag = getShippingService(event)

	// Return null if any required field is missing
	if (!id || !title || !priceTag || !countryTag || !serviceTag) {
		return null
	}

	return {
		id,
		title,
		description: getShippingDescription(event),
		price: {
			amount: priceTag[1],
			currency: priceTag[2],
		},
		country: countryTag[1],
		additionalCountries: countryTag[2],
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
