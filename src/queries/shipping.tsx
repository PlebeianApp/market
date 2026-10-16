import { SHIPPING_STATUS } from '@/lib/schemas/order'
import { SHIPPING_KIND } from '@/lib/schemas/shippingOption'
import { ndkActions } from '@/lib/stores/ndk'
import { isValidHexKey } from '@/lib/utils'
import { naddrFromAddress } from '@/lib/nostr/naddr'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { orderKeys, shippingKeys } from './queryKeyFactory'
import { publishShippingStatusUpdateWorkflow } from '@sdk/commerce/orders'
import { readShippingOptionsWorkflow } from '@sdk/commerce/shipping'
import { createNdkPublishContext } from '@platform/web/ndkPublishContext'
import { createNdkReadContext, getNdkEventStore } from '@platform/web/ndkReadContext'

// Re-export shippingKeys for use in other files
export { shippingKeys }

/** True once the author's NIP-09 deletion for this option has been seen by the shared store. */
export const isShippingOptionDeleted = (event: NDKEvent): boolean => getNdkEventStore().isDeleted(event)

// --- DATA FETCHING FUNCTIONS ---

/**
 * Fetches all shipping options
 * @returns Array of shipping events sorted by creation date
 */
export const fetchShippingOptions = async () => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	return readShippingOptionsWorkflow(createNdkReadContext(), { limit: 50 })
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

	// A malformed (not just empty) pubkey would build { authors: [...] } that
	// trips NDK's strict filter validation. Reject before constructing it.
	if (!isValidHexKey(pubkey)) return []

	return readShippingOptionsWorkflow(createNdkReadContext(), { author: pubkey })
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
		enabled: isValidHexKey(pubkey),
		staleTime: 300000, // Added staleTime of 5 minutes (300,000 ms)
	})

// --- HELPER FUNCTIONS (DATA EXTRACTION) ---

import {
	getShippingCountry,
	getShippingDescription,
	getShippingInfo,
	getShippingPrice,
	getShippingService,
	getShippingTitle,
} from '@sdk/commerce/shipping'

export {
	createShippingReference,
	getShippingCarrier,
	getShippingCountry,
	getShippingCreatedAt,
	getShippingDescription,
	getShippingDimensionLimits,
	getShippingDuration,
	getShippingId,
	getShippingInfo,
	getShippingLocation,
	getShippingPickupAddress,
	getShippingPickupAddressString,
	getShippingPrice,
	getShippingPubkey,
	getShippingService,
	getShippingTitle,
	getShippingWeightLimits,
	parseShippingReference,
} from '@sdk/commerce/shipping'

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

	const context = await createNdkPublishContext(ndk, signer)
	const event = await publishShippingStatusUpdateWorkflow(
		{ ...context, loadOrder: (id) => ndk.fetchEvent({ ids: [id] }) },
		{
			orderEventId: params.orderEventId,
			status: params.status,
			reason: params.reason,
			tracking: params.tracking,
			carrier: params.carrier,
			eta: params.eta,
		},
	)
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

			// Trigger a refetch to show updated status before the mutation fully settles.
			await queryClient.refetchQueries({ queryKey: orderKeys.details(params.orderEventId) })
		},
		onError: (error) => {
			console.error('Failed to update shipping status:', error)
			toast.error('Failed to update shipping status')
		},
	})
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
