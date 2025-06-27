import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ndkActions } from '@/lib/stores/ndk'
import { paymentDetailsKeys, walletDetailsKeys } from './queryKeyFactory'
import { NDKEvent, NDKKind } from '@nostr-dev-kit/ndk'
import { configStore } from '@/lib/stores/config'
import { v4 as uuidv4 } from 'uuid'
import { toast } from 'sonner'
import { nip04 } from 'nostr-tools'
import { type PaymentDetailsMethod } from '@/lib/constants'

/**
 * Payment method types as defined in the spec
 */
export type PaymentMethod = PaymentDetailsMethod

/**
 * Interface for payment details as per SPEC.md
 */
export interface PaymentDetail {
	id: string // Event ID
	paymentMethod: PaymentMethod
	paymentDetail: string // Could be bolt11, btc address, etc.
	createdAt: number
	coordinates?: string // Optional product/collection coordinates
	isDefault?: boolean // Whether this is the default payment method
}

/**
 * Scope types for payment details
 */
export type PaymentScope = 'global' | 'collection' | 'product'

/**
 * Enhanced payment detail interface for receiving payments UI
 */
export interface RichPaymentDetail extends PaymentDetail {
	userId: string
	scope: PaymentScope
	scopeId?: string | null // Collection or product ID
	scopeName?: string // Collection or product name
	isDefault: boolean
}

/**
 * Wallet detail interface for tracking on-chain indices
 */
export interface WalletDetail {
	id: string
	key: string
	valueNumeric: number
	valueString: string
	updatedAt: Date
	paymentDetailId: string
}

/**
 * Fetches payment details for a specific ID
 */
export const fetchPaymentDetail = async (id: string): Promise<PaymentDetail | null> => {
	try {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		// Fetch the event
		const event = await ndk.fetchEvent({
			ids: [id],
		})

		if (!event) {
			console.log('Payment detail event not found:', id)
			return null
		}

		// Event should have the l tag with value 'payment_detail'
		const lTag = event.tags.find((tag) => tag[0] === 'l' && tag[1] === 'payment_detail')
		if (!lTag) {
			console.log('Not a payment detail event:', id)
			return null
		}

		// Decrypt the content if the user has a signer
		const signer = ndkActions.getSigner()
		if (!signer) {
			console.warn('No signer available to decrypt payment details')
			return null
		}

		const user = await signer.user()
		if (!user) return null

		// Find app pubkey from the p tag or use the stored app pubkey
		const pTag = event.tags.find((tag) => tag[0] === 'p')
		const appPubkey = pTag ? pTag[1] : configStore.state.config.appPublicKey

		if (!appPubkey) {
			console.warn('App public key not available')
			return null
		}

		// Decrypt the content
		let content
		try {
			// If the event author is the app, decrypt with the user's key
			// If the event author is the user, decrypt with the app's key
			const isEventFromApp = event.pubkey === appPubkey

			if (isEventFromApp) {
				content = await nip04.decrypt(appPubkey, user.pubkey, event.content)
			} else {
				content = await nip04.decrypt(user.pubkey, appPubkey, event.content)
			}

			const parsedContent = JSON.parse(content)

			// Find any a tag for coordinates
			const aTag = event.tags.find((tag) => tag[0] === 'a')
			const coordinates = aTag ? aTag[1] : undefined

			return {
				id: event.id,
				paymentMethod: parsedContent.payment_method || 'other',
				paymentDetail: parsedContent.payment_detail || '',
				createdAt: event.created_at || 0,
				coordinates,
				isDefault: parsedContent.is_default === true || parsedContent.is_default === 'true',
			}
		} catch (error) {
			console.error('Error decrypting payment details:', error)
			return null
		}
	} catch (error) {
		console.error('Error fetching payment detail:', error)
		return null
	}
}

/**
 * React query hook for fetching payment details
 */
export const usePaymentDetail = (id: string) => {
	return useQuery({
		queryKey: paymentDetailsKeys.details(id),
		queryFn: () => fetchPaymentDetail(id),
		enabled: !!id,
	})
}

/**
 * Fetches all payment details for a user
 */
export const fetchUserPaymentDetails = async (userPubkey: string): Promise<PaymentDetail[]> => {
	try {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		// Fetch payment detail events for this user
		const events = await ndk.fetchEvents({
			kinds: [NDKKind.AppSpecificData],
			authors: [userPubkey],
			'#l': ['payment_detail'],
		})

		if (!events || events.size === 0) {
			console.log('No payment detail events found for user:', userPubkey)
			return []
		}

		// Group events by d tag and keep only the most recent for each
		const eventsArray = Array.from(events)
		const eventsByDTag = new Map<string, any>()

		for (const event of eventsArray) {
			const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1]
			if (!dTag) continue

			const existingEvent = eventsByDTag.get(dTag)
			if (!existingEvent || (event.created_at || 0) > (existingEvent.created_at || 0)) {
				eventsByDTag.set(dTag, event)
			}
		}

		// Convert the most recent events to payment details
		const paymentDetails: PaymentDetail[] = []
		const latestEvents = Array.from(eventsByDTag.values())

		for (const event of latestEvents) {
			const detail = await fetchPaymentDetail(event.id)
			if (detail) {
				paymentDetails.push(detail)
			}
		}

		return paymentDetails
	} catch (error) {
		console.error('Error fetching user payment details:', error)
		return []
	}
}

/**
 * React query hook for fetching all payment details for a user
 */
export const useUserPaymentDetails = (userPubkey: string) => {
	return useQuery({
		queryKey: paymentDetailsKeys.byPubkey(userPubkey),
		queryFn: () => fetchUserPaymentDetails(userPubkey),
		enabled: !!userPubkey,
	})
}

/**
 * Fetches payment details for a specific product or collection
 */
export const fetchProductPaymentDetails = async (coordinates: string, userPubkey?: string): Promise<PaymentDetail[]> => {
	try {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		// Set up filter object
		const filter: any = {
			kinds: [NDKKind.AppSpecificData],
			'#l': ['payment_detail'],
			'#a': [coordinates],
		}

		// If user pubkey is provided, add it to the filter
		if (userPubkey) {
			filter.authors = [userPubkey]
		}

		// Fetch payment detail events
		const events = await ndk.fetchEvents(filter)

		if (!events || events.size === 0) {
			return []
		}

		// Group events by d tag and keep only the most recent for each
		const eventsArray = Array.from(events)
		const eventsByDTag = new Map<string, any>()

		for (const event of eventsArray) {
			const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1]
			if (!dTag) continue

			const existingEvent = eventsByDTag.get(dTag)
			if (!existingEvent || (event.created_at || 0) > (existingEvent.created_at || 0)) {
				eventsByDTag.set(dTag, event)
			}
		}

		// Convert the most recent events to payment details
		const paymentDetails: PaymentDetail[] = []
		const latestEvents = Array.from(eventsByDTag.values())

		for (const event of latestEvents) {
			const detail = await fetchPaymentDetail(event.id)
			if (detail) {
				paymentDetails.push(detail)
			}
		}

		return paymentDetails
	} catch (error) {
		console.error('Error fetching product payment details:', error)
		return []
	}
}

/**
 * React query hook for fetching payment details for a specific product or collection
 */
export const useProductPaymentDetails = (coordinates: string, userPubkey?: string) => {
	return useQuery({
		queryKey: paymentDetailsKeys.byProductOrCollection(coordinates),
		queryFn: () => fetchProductPaymentDetails(coordinates, userPubkey),
		enabled: !!coordinates,
	})
}

/**
 * Interface for publishing payment details
 */
export interface PublishPaymentDetailParams {
	paymentMethod: PaymentMethod
	paymentDetail: string
	coordinates?: string // Optional product/collection coordinates
	appPubkey?: string // Optional app pubkey
	dTag?: string // Optional d tag for replaceable events (for updates)
	isDefault?: boolean // Whether this is the default payment method
}

/**
 * Publishes payment details
 */
export const publishPaymentDetail = async (params: PublishPaymentDetailParams): Promise<string> => {
	try {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		const signer = ndkActions.getSigner()
		if (!signer) throw new Error('No signer available to publish payment details')

		// Get user
		const user = await signer.user()
		if (!user) throw new Error('User not available')

		// Get app pubkey
		const appPubkey = params.appPubkey || configStore.state.config.appPublicKey
		if (!appPubkey) throw new Error('App public key not available')

		// Create the content object
		const contentObj = {
			payment_method: params.paymentMethod,
			payment_detail: params.paymentDetail,
			is_default: params.isDefault || false,
		}

		// Encrypt content for the app
		const contentStr = JSON.stringify(contentObj)
		let encryptedContent

		// Encrypt to app's pubkey
		encryptedContent = await nip04.encrypt(user.pubkey, appPubkey, contentStr)

		// Create the event
		const event = new NDKEvent(ndk)
		event.kind = NDKKind.AppSpecificData
		event.content = encryptedContent
		event.tags = [
			['d', params.dTag || uuidv4()],
			['l', 'payment_detail'],
			['p', appPubkey], // Reference to the app
		]

		// Add coordinates if provided
		if (params.coordinates) {
			event.tags.push(['a', params.coordinates])
		}

		// Sign and publish
		await event.sign(signer)
		await event.publish()

		return event.id
	} catch (error) {
		console.error('Error publishing payment details:', error)
		throw new Error(`Failed to publish payment details: ${error instanceof Error ? error.message : String(error)}`)
	}
}

/**
 * React query mutation hook for publishing payment details
 */
export const usePublishPaymentDetail = () => {
	return useMutation({
		mutationKey: paymentDetailsKeys.publish(),
		mutationFn: publishPaymentDetail,
		onSuccess: (eventId) => {
			toast.success('Payment details saved successfully')
			return eventId
		},
		onError: (error) => {
			console.error('Failed to publish payment details:', error)
			toast.error('Failed to save payment details')
		},
	})
}

// ===============================
// ENHANCED PAYMENT DETAILS FOR RECEIVING PAYMENTS UI
// ===============================

/**
 * Interface for enhanced publishing payment details
 */
export interface PublishRichPaymentDetailParams extends PublishPaymentDetailParams {
	scope?: PaymentScope
	scopeId?: string | null
	scopeName?: string
	isDefault?: boolean
}

/**
 * Interface for updating payment details
 */
export interface UpdatePaymentDetailParams extends PublishRichPaymentDetailParams {
	paymentDetailId: string
}

/**
 * Interface for deleting payment details
 */
export interface DeletePaymentDetailParams {
	paymentDetailId: string
	userPubkey: string
}

/**
 * Parses scope information from coordinates
 */
const parseScopeFromCoordinates = (coordinates?: string): { scope: PaymentScope; scopeId: string | null; scopeName: string } => {
	if (!coordinates) {
		return { scope: 'global', scopeId: null, scopeName: 'Global' }
	}

	const parts = coordinates.split(':')
	if (parts.length !== 3) {
		return { scope: 'global', scopeId: null, scopeName: 'Global' }
	}

	const [kind, pubkey, dTag] = parts

	if (kind === '30405') {
		// Collection scope
		return { scope: 'collection', scopeId: dTag, scopeName: `Collection ${dTag.substring(0, 8)}...` }
	} else if (kind === '30402') {
		// Product scope
		return { scope: 'product', scopeId: dTag, scopeName: `Product ${dTag.substring(0, 8)}...` }
	}

	return { scope: 'global', scopeId: null, scopeName: 'Global' }
}

/**
 * Fetches enhanced payment details for receiving payments UI
 */
export const fetchRichUserPaymentDetails = async (userPubkey: string): Promise<RichPaymentDetail[]> => {
	try {
		const basicDetails = await fetchUserPaymentDetails(userPubkey)

		// Enhance the basic details with scope information from coordinates
		const richDetails = basicDetails.map((detail) => {
			const scopeInfo = parseScopeFromCoordinates(detail.coordinates)

			return {
				...detail,
				userId: userPubkey,
				...scopeInfo,
				isDefault: detail.isDefault || false,
			}
		})

		// If no payment detail is marked as default, make the first one default
		if (richDetails.length > 0 && !richDetails.some((detail) => detail.isDefault)) {
			richDetails[0].isDefault = true
		}

		return richDetails
	} catch (error) {
		console.error('Error fetching rich user payment details:', error)
		return []
	}
}

/**
 * React query hook for fetching enhanced payment details
 */
export const useRichUserPaymentDetails = (userPubkey: string) => {
	return useQuery({
		queryKey: paymentDetailsKeys.byPubkey(userPubkey),
		queryFn: () => fetchRichUserPaymentDetails(userPubkey),
		enabled: !!userPubkey,
	})
}

/**
 * Publishes enhanced payment details
 */
export const publishRichPaymentDetail = async (params: PublishRichPaymentDetailParams): Promise<string> => {
	try {
		// For now, we just publish the basic payment detail
		// In a full implementation, you might store additional metadata
		const eventId = await publishPaymentDetail({
			paymentMethod: params.paymentMethod,
			paymentDetail: params.paymentDetail,
			coordinates: params.coordinates,
			appPubkey: params.appPubkey,
			dTag: params.dTag,
			isDefault: params.isDefault,
		})

		return eventId
	} catch (error) {
		console.error('Error publishing rich payment details:', error)
		throw error
	}
}

/**
 * React query mutation hook for publishing enhanced payment details
 */
export const usePublishRichPaymentDetail = () => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationKey: paymentDetailsKeys.publish(),
		mutationFn: publishRichPaymentDetail,
		onSuccess: (eventId, variables) => {
			toast.success('Payment details saved successfully')
			// Invalidate relevant queries
			queryClient.invalidateQueries({ queryKey: paymentDetailsKeys.byPubkey(variables.appPubkey || '') })
			return eventId
		},
		onError: (error) => {
			console.error('Failed to publish payment details:', error)
			toast.error('Failed to save payment details')
		},
	})
}

/**
 * Updates payment details
 */
export const updatePaymentDetail = async (params: UpdatePaymentDetailParams): Promise<string> => {
	try {
		// First, we need to get the original event to extract its d tag
		const originalEvent = await fetchPaymentDetail(params.paymentDetailId)
		if (!originalEvent) {
			throw new Error('Original payment detail not found')
		}

		// Get the d tag from the original event
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		const originalNDKEvent = await ndk.fetchEvent({
			ids: [params.paymentDetailId],
		})

		if (!originalNDKEvent) {
			throw new Error('Original event not found')
		}

		const dTag = originalNDKEvent.tags.find((tag) => tag[0] === 'd')?.[1]
		if (!dTag) {
			throw new Error('Original event does not have a d tag')
		}

		// For updates, we publish a new event with the same d tag to replace the old one
		return await publishPaymentDetail({
			paymentMethod: params.paymentMethod,
			paymentDetail: params.paymentDetail,
			coordinates: params.coordinates,
			appPubkey: params.appPubkey,
			dTag: dTag, // Use the same d tag to replace the event
			isDefault: params.isDefault,
		})
	} catch (error) {
		console.error('Error updating payment details:', error)
		throw error
	}
}

/**
 * React query mutation hook for updating payment details
 */
export const useUpdatePaymentDetail = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationKey: paymentDetailsKeys.updatePaymentDetail(),
		mutationFn: updatePaymentDetail,
		onSuccess: async (eventId, variables) => {
			// Get current user pubkey
			let userPubkey = ''
			if (signer) {
				const user = await signer.user()
				if (user && user.pubkey) {
					userPubkey = user.pubkey
				}
			}

			// Invalidate relevant queries
			if (userPubkey) {
				queryClient.invalidateQueries({ queryKey: paymentDetailsKeys.byPubkey(userPubkey) })
			}

			if (variables.coordinates) {
				queryClient.invalidateQueries({ queryKey: paymentDetailsKeys.byProductOrCollection(variables.coordinates) })
			}

			toast.success('Payment details updated successfully')
			return eventId
		},
		onError: (error) => {
			console.error('Failed to update payment details:', error)
			toast.error('Failed to update payment details')
		},
	})
}

/**
 * Deletes payment details by publishing a deletion event
 */
export const deletePaymentDetail = async (params: DeletePaymentDetailParams): Promise<string> => {
	try {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		const signer = ndkActions.getSigner()
		if (!signer) throw new Error('No signer available')

		// Create a deletion event (NIP-09)
		const event = new NDKEvent(ndk)
		event.kind = 5 // Deletion event
		event.content = 'Deleted payment detail'
		event.tags = [
			['e', params.paymentDetailId], // Event to delete
		]

		await event.sign(signer)
		await event.publish()

		return event.id
	} catch (error) {
		console.error('Error deleting payment details:', error)
		throw error
	}
}

/**
 * React query mutation hook for deleting payment details
 */
export const useDeletePaymentDetail = () => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationKey: paymentDetailsKeys.deletePaymentDetail(),
		mutationFn: deletePaymentDetail,
		onSuccess: (eventId, variables) => {
			toast.success('Payment details deleted successfully')
			// Invalidate relevant queries
			queryClient.invalidateQueries({ queryKey: paymentDetailsKeys.byPubkey(variables.userPubkey) })
			return eventId
		},
		onError: (error) => {
			console.error('Failed to delete payment details:', error)
			toast.error('Failed to delete payment details')
		},
	})
}

// ===============================
// WALLET DETAILS FOR ON-CHAIN INDEX TRACKING
// ===============================

/**
 * Fetches wallet details for on-chain index tracking
 */
export const fetchWalletDetail = async (userPubkey: string, paymentDetailId: string): Promise<WalletDetail | null> => {
	try {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		// Fetch wallet detail events
		const events = await ndk.fetchEvents({
			kinds: [NDKKind.AppSpecificData],
			'#l': ['wallet_detail'],
			'#a': [`30078:${userPubkey}:${paymentDetailId}`],
		})

		if (!events || events.size === 0) {
			return null
		}

		// Get the most recent event
		const eventArray = Array.from(events)
		const mostRecentEvent = eventArray.reduce((latest, current) =>
			(current.created_at || 0) > (latest.created_at || 0) ? current : latest,
		)

		// Decrypt and parse the content
		const signer = ndkActions.getSigner()
		if (!signer) return null

		const user = await signer.user()
		if (!user) return null

		const appPubkey = configStore.state.config.appPublicKey
		if (!appPubkey) return null

		let content
		try {
			content = await nip04.decrypt(user.pubkey, appPubkey, mostRecentEvent.content)
			const parsedContent = JSON.parse(content)

			return {
				id: mostRecentEvent.id,
				key: parsedContent.key || 'on-chain-index',
				valueNumeric: parseInt(parsedContent.value || '0'),
				valueString: parsedContent.value || '0',
				updatedAt: new Date((mostRecentEvent.created_at || 0) * 1000),
				paymentDetailId,
			}
		} catch (error) {
			console.error('Error decrypting wallet details:', error)
			return null
		}
	} catch (error) {
		console.error('Error fetching wallet detail:', error)
		return null
	}
}

/**
 * React query hook for fetching wallet details
 */
export const useWalletDetail = (userPubkey: string, paymentDetailId: string) => {
	return useQuery({
		queryKey: walletDetailsKeys.onChainIndex(userPubkey, paymentDetailId),
		queryFn: () => fetchWalletDetail(userPubkey, paymentDetailId),
		enabled: !!userPubkey && !!paymentDetailId,
	})
}
