import { SHIPPING_KIND } from '@/lib/schemas/shippingOption'
import { ndkActions } from '@/lib/stores/ndk'
import { shippingKeys } from '@/queries/queryKeyFactory'
import NDK, { NDKEvent, type NDKSigner, type NDKTag } from '@nostr-dev-kit/ndk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

export interface ShippingFormData {
	title: string
	description: string
	price: string
	currency: string
	country: string
	additionalCountries?: string[]
	service: 'standard' | 'express' | 'overnight' | 'pickup'
	carrier?: string
	region?: string
	additionalRegions?: string[]
	duration?: {
		min: string
		max: string
		unit: 'D' | 'W' | 'M'
	}
	location?: string
	geohash?: string
	weightLimits?: {
		min?: { value: string; unit: string }
		max?: { value: string; unit: string }
	}
	dimensionLimits?: {
		min?: { value: string; unit: string }
		max?: { value: string; unit: string }
	}
	priceCalculations?: {
		weight?: { value: string; unit: string }
		volume?: { value: string; unit: string }
		distance?: { value: string; unit: string }
	}
}

/**
 * Creates a new shipping option event (kind 30406)
 */
export const createShippingEvent = (
	formData: ShippingFormData,
	signer: NDKSigner,
	ndk: NDK,
	shippingId?: string, // Optional for updates
): NDKEvent => {
	const event = new NDKEvent(ndk)
	event.kind = SHIPPING_KIND
	event.content = formData.description

	// Generate a unique ID if not provided (for new shipping options)
	const id = shippingId || `shipping_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`

	// Build required tags
	const tags: NDKTag[] = [
		['d', id],
		['title', formData.title],
		['price', formData.price, formData.currency],
		['country', formData.country, ...(formData.additionalCountries || [])],
		['service', formData.service],
	]

	// Add optional tags
	if (formData.carrier) {
		tags.push(['carrier', formData.carrier])
	}

	if (formData.region) {
		tags.push(['region', formData.region, ...(formData.additionalRegions || [])])
	}

	if (formData.duration) {
		tags.push(['duration', formData.duration.min, formData.duration.max, formData.duration.unit])
	}

	if (formData.location) {
		tags.push(['location', formData.location])
	}

	if (formData.geohash) {
		tags.push(['g', formData.geohash])
	}

	// Weight constraints
	if (formData.weightLimits?.min) {
		tags.push(['weight-min', formData.weightLimits.min.value, formData.weightLimits.min.unit])
	}

	if (formData.weightLimits?.max) {
		tags.push(['weight-max', formData.weightLimits.max.value, formData.weightLimits.max.unit])
	}

	// Dimension constraints
	if (formData.dimensionLimits?.min) {
		tags.push(['dim-min', formData.dimensionLimits.min.value, formData.dimensionLimits.min.unit])
	}

	if (formData.dimensionLimits?.max) {
		tags.push(['dim-max', formData.dimensionLimits.max.value, formData.dimensionLimits.max.unit])
	}

	// Price calculations
	if (formData.priceCalculations?.weight) {
		tags.push(['price-weight', formData.priceCalculations.weight.value, formData.priceCalculations.weight.unit])
	}

	if (formData.priceCalculations?.volume) {
		tags.push(['price-volume', formData.priceCalculations.volume.value, formData.priceCalculations.volume.unit])
	}

	if (formData.priceCalculations?.distance) {
		tags.push(['price-distance', formData.priceCalculations.distance.value, formData.priceCalculations.distance.unit])
	}

	event.tags = tags

	return event
}

/**
 * Publishes a new shipping option
 */
export const publishShippingOption = async (formData: ShippingFormData, signer: NDKSigner, ndk: NDK): Promise<string> => {
	// Validation
	if (!formData.title.trim()) {
		throw new Error('Shipping title is required')
	}

	if (!formData.description.trim()) {
		throw new Error('Shipping description is required')
	}

	if (!formData.price.trim() || isNaN(Number(formData.price))) {
		throw new Error('Valid shipping price is required')
	}

	if (!formData.currency.trim()) {
		throw new Error('Currency is required')
	}

	if (!formData.country.trim()) {
		throw new Error('Country is required')
	}

	if (!formData.service) {
		throw new Error('Service type is required')
	}

	const event = createShippingEvent(formData, signer, ndk)

	await event.sign(signer)
	await event.publish()

	return event.id
}

/**
 * Updates an existing shipping option by preserving the original d tag
 */
export const updateShippingOption = async (
	shippingDTag: string, // The 'd' tag value from the original shipping option
	formData: ShippingFormData,
	signer: NDKSigner,
	ndk: NDK,
): Promise<string> => {
	// Validation
	if (!shippingDTag) {
		throw new Error('Shipping d tag is required for updates')
	}

	if (!formData.title.trim()) {
		throw new Error('Shipping title is required')
	}

	if (!formData.description.trim()) {
		throw new Error('Shipping description is required')
	}

	if (!formData.price.trim() || isNaN(Number(formData.price))) {
		throw new Error('Valid shipping price is required')
	}

	if (!formData.currency.trim()) {
		throw new Error('Currency is required')
	}

	if (!formData.country.trim()) {
		throw new Error('Country is required')
	}

	if (!formData.service) {
		throw new Error('Service type is required')
	}

	// Create event with the same d tag to update the existing shipping option
	const event = createShippingEvent(formData, signer, ndk, shippingDTag)

	await event.sign(signer)
	await event.publish()

	return event.id
}

/**
 * Deletes a shipping option by publishing a deletion event
 */
export const deleteShippingOption = async (shippingDTag: string, signer: NDKSigner, ndk: NDK): Promise<boolean> => {
	try {
		// Create a deletion event (kind 5)
		const deleteEvent = new NDKEvent(ndk)
		deleteEvent.kind = 5
		deleteEvent.content = 'Shipping option deleted'

		// Reference the shipping option to delete
		const pubkey = await signer.user().then((user) => user.pubkey)
		deleteEvent.tags = [['a', `${SHIPPING_KIND}:${pubkey}:${shippingDTag}`]]

		await deleteEvent.sign(signer)
		await deleteEvent.publish()

		return true
	} catch (error) {
		console.error('Error deleting shipping option:', error)
		throw error
	}
}

/**
 * Mutation hook for publishing a new shipping option
 */
export const usePublishShippingOptionMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()
	const currentUserPubkey = ndk?.activeUser?.pubkey

	return useMutation({
		mutationFn: async (formData: ShippingFormData) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')
			return publishShippingOption(formData, signer, ndk)
		},
		onSuccess: async (eventId) => {
			// Invalidate and refetch shipping options queries
			await queryClient.invalidateQueries({ queryKey: shippingKeys.all })

			if (currentUserPubkey) {
				await queryClient.invalidateQueries({ queryKey: shippingKeys.byPubkey(currentUserPubkey) })
			}

			toast.success('Shipping option published successfully')
		},
		onError: (error) => {
			console.error('Failed to publish shipping option:', error)
			toast.error(error instanceof Error ? error.message : 'Failed to publish shipping option')
		},
	})
}

/**
 * Mutation hook for updating an existing shipping option
 */
export const useUpdateShippingOptionMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()
	const currentUserPubkey = ndk?.activeUser?.pubkey

	return useMutation({
		mutationFn: async ({ shippingDTag, formData }: { shippingDTag: string; formData: ShippingFormData }) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')
			return updateShippingOption(shippingDTag, formData, signer, ndk)
		},
		onSuccess: async (eventId, variables) => {
			// Invalidate and refetch queries
			await queryClient.invalidateQueries({ queryKey: shippingKeys.all })
			await queryClient.invalidateQueries({ queryKey: shippingKeys.details(variables.shippingDTag) })

			if (currentUserPubkey) {
				await queryClient.invalidateQueries({ queryKey: shippingKeys.byPubkey(currentUserPubkey) })
			}

			toast.success('Shipping option updated successfully')
		},
		onError: (error) => {
			console.error('Failed to update shipping option:', error)
			toast.error(error instanceof Error ? error.message : 'Failed to update shipping option')
		},
	})
}

/**
 * Mutation hook for deleting a shipping option
 */
export const useDeleteShippingOptionMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()
	const currentUserPubkey = ndk?.activeUser?.pubkey

	return useMutation({
		mutationFn: async (shippingDTag: string) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')
			return deleteShippingOption(shippingDTag, signer, ndk)
		},
		onSuccess: async (result, shippingDTag) => {
			// Invalidate and refetch queries
			await queryClient.invalidateQueries({ queryKey: shippingKeys.all })
			await queryClient.invalidateQueries({ queryKey: shippingKeys.details(shippingDTag) })

			if (currentUserPubkey) {
				await queryClient.invalidateQueries({ queryKey: shippingKeys.byPubkey(currentUserPubkey) })
			}

			toast.success('Shipping option deleted successfully')
		},
		onError: (error) => {
			console.error('Failed to delete shipping option:', error)
			toast.error(error instanceof Error ? error.message : 'Failed to delete shipping option')
		},
	})
}
