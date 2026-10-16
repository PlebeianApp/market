import { ndkActions } from '@/lib/stores/ndk'
import { shippingKeys } from '@/queries/queryKeyFactory'
import { createShippingReference } from '@/queries/shipping'
import type { NDKEvent, NDKSigner } from '@/lib/nostr/ndk-events'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createNdkPublishContext, type NdkClient as NDK } from '@platform/web/ndkPublishContext'
import { getNdkEventStore } from '@platform/web/ndkReadContext'
import {
	deleteShippingOptionWorkflow,
	publishShippingOptionWorkflow,
	type ShippingOptionFormInput,
	type ShippingPublishValidationIssue,
} from '@sdk/commerce/shipping'

export type ShippingFormData = ShippingOptionFormInput

export interface PublishedShippingOption {
	eventId: string
	shippingDTag: string
	shippingRef: string
}

function shippingPublishIssueMessage(issue: ShippingPublishValidationIssue): string {
	switch (issue) {
		case 'shipping-title-required':
			return 'Shipping title is required'
		case 'shipping-description-required':
			return 'Shipping description is required'
		case 'shipping-price-required':
			return 'Valid shipping price is required'
		case 'shipping-currency-required':
			return 'Currency is required'
		case 'shipping-service-required':
			return 'Service type is required'
		case 'shipping-pickup-street-required':
			return 'Street address is required for local pickup'
		case 'shipping-pickup-city-required':
			return 'City is required for local pickup'
	}
}

export const buildPublishedShippingOption = (eventId: string, pubkey: string, shippingDTag: string): PublishedShippingOption => ({
	eventId,
	shippingDTag,
	shippingRef: createShippingReference(pubkey, shippingDTag),
})

const createShippingId = () => `shipping_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`

async function publishShippingForm(formData: ShippingFormData, signer: NDKSigner, ndk: NDK, shippingDTag?: string) {
	if (formData.service === 'pickup' && formData.price !== '0') {
		console.warn('Pickup service price should be 0, adjusting automatically')
	}
	const context = await createNdkPublishContext(ndk, signer)
	const outcome = await publishShippingOptionWorkflow({ ...context, createShippingId }, formData, shippingDTag)
	if (!outcome.ok) throw new Error(shippingPublishIssueMessage(outcome.issue))
	return { outcome, authorPubkey: context.authorPubkey }
}

/**
 * Publishes a new shipping option
 */
export const publishShippingOption = async (formData: ShippingFormData, signer: NDKSigner, ndk: NDK): Promise<PublishedShippingOption> => {
	const { outcome, authorPubkey } = await publishShippingForm(formData, signer, ndk)
	return buildPublishedShippingOption(outcome.event.id, authorPubkey, outcome.shippingDTag)
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
	if (!shippingDTag) {
		throw new Error('Shipping d tag is required for updates')
	}
	const { outcome } = await publishShippingForm(formData, signer, ndk, shippingDTag)
	return outcome.event.id
}

/**
 * Deletes a shipping option by publishing a deletion event
 */
export const deleteShippingOption = async (shippingDTag: string, signer: NDKSigner, ndk: NDK): Promise<boolean> => {
	try {
		const deletion = await deleteShippingOptionWorkflow(await createNdkPublishContext(ndk, signer), shippingDTag)
		// Relays may keep serving the option; the store applies the deletion to every later read.
		getNdkEventStore().add(deletion)
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
		onSuccess: async () => {
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
		onMutate: async (shippingDTag) => {
			// Cancel any outgoing refetches to avoid overwriting our optimistic update
			await queryClient.cancelQueries({ queryKey: shippingKeys.all })
			if (currentUserPubkey) {
				await queryClient.cancelQueries({ queryKey: shippingKeys.byPubkey(currentUserPubkey) })
			}

			// Snapshot the previous values for rollback
			const previousAll = queryClient.getQueryData(shippingKeys.all)
			const previousByPubkey = currentUserPubkey ? queryClient.getQueryData(shippingKeys.byPubkey(currentUserPubkey)) : undefined

			// Optimistically remove the shipping option from the cache
			queryClient.setQueryData(shippingKeys.all, (old: NDKEvent[] | undefined) => {
				if (!old) return old
				return old.filter((event) => {
					const dTag = event.tags.find((t) => t[0] === 'd')?.[1]
					return dTag !== shippingDTag
				})
			})

			if (currentUserPubkey) {
				queryClient.setQueryData(shippingKeys.byPubkey(currentUserPubkey), (old: NDKEvent[] | undefined) => {
					if (!old) return old
					return old.filter((event) => {
						const dTag = event.tags.find((t) => t[0] === 'd')?.[1]
						return dTag !== shippingDTag
					})
				})
			}

			// Return context for rollback
			return { previousAll, previousByPubkey }
		},
		onError: (error, shippingDTag, context) => {
			// Rollback to previous values on error
			if (context?.previousAll) {
				queryClient.setQueryData(shippingKeys.all, context.previousAll)
			}
			if (context?.previousByPubkey && currentUserPubkey) {
				queryClient.setQueryData(shippingKeys.byPubkey(currentUserPubkey), context.previousByPubkey)
			}
			console.error('Failed to delete shipping option:', error)
			toast.error(error instanceof Error ? error.message : 'Failed to delete shipping option')
		},
		onSuccess: async (result, shippingDTag) => {
			// Remove the specific shipping option from cache without refetching
			// (Relays may still return deleted events, so we don't invalidate/refetch)
			queryClient.removeQueries({ queryKey: shippingKeys.details(shippingDTag) })

			toast.success('Shipping option deleted successfully')
		},
	})
}
