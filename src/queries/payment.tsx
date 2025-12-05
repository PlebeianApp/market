import { PAYMENT_DETAILS_METHOD, ZAP_RELAYS, type PaymentDetailsMethod } from '@/lib/constants'
import { configStore } from '@/lib/stores/config'
import { ndkActions } from '@/lib/stores/ndk'
import type { PayWithNwcParams } from '@/publish/payment'
import { payInvoiceWithNwc, payInvoiceWithWebln } from '@/publish/payment'
import { LightningAddress, type Invoice, type NostrProvider } from '@getalby/lightning-tools'
import { NDKEvent, NDKKind } from '@nostr-dev-kit/ndk'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { nip04, nip19 } from 'nostr-tools'
import { toast } from 'sonner'
import { v4 as uuidv4 } from 'uuid'
import { paymentDetailsKeys, walletDetailsKeys } from './queryKeyFactory'

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
	scopeId?: string | null // Collection or product ID (primary, for single or first of many)
	scopeIds?: string[] // All product/collection IDs (for multi-product wallets)
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

		// Parse the content (no decryption needed - payment details are public)
		try {
			const parsedContent = JSON.parse(event.content)

			// Find ALL 'a' tags for coordinates (for multi-product wallets)
			const aTags = event.tags.filter((tag) => tag[0] === 'a')
			const coordinates = aTags.length > 0 ? aTags.map((t) => t[1]).join(',') : undefined

			return {
				id: event.id,
				paymentMethod: parsedContent.payment_method || 'other',
				paymentDetail: parsedContent.payment_detail || '',
				createdAt: event.created_at || 0,
				coordinates, // Now contains all product/collection references
				isDefault: parsedContent.is_default === true || parsedContent.is_default === 'true',
			}
		} catch (error) {
			console.error('Error parsing payment details:', error)
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
	coordinates?: string | string[] // Optional product/collection coordinates (single or multiple)
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

		// Payment details are public (Lightning addresses, BTC addresses)
		// No encryption needed - buyers need to read these to generate invoices
		const contentStr = JSON.stringify(contentObj)

		// Create the event
		const event = new NDKEvent(ndk)
		event.kind = NDKKind.AppSpecificData
		event.content = contentStr
		event.tags = [
			['d', params.dTag || uuidv4()],
			['l', 'payment_detail'],
			['p', appPubkey], // Reference to the app
		]

		// Add coordinates if provided (can be single string or array)
		if (params.coordinates) {
			const coordinatesArray = Array.isArray(params.coordinates) ? params.coordinates : [params.coordinates]
			coordinatesArray.forEach((coord) => {
				event.tags.push(['a', coord])
			})
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
			// Parse ALL coordinates from the event (comma-separated)
			const coordinatesArray = detail.coordinates ? detail.coordinates.split(',') : []

			if (coordinatesArray.length === 0) {
				// Global wallet
				return {
					...detail,
					userId: userPubkey,
					scope: 'global' as PaymentScope,
					scopeId: null,
					scopeName: 'Global',
					scopeIds: [],
					isDefault: detail.isDefault || false,
				}
			} else if (coordinatesArray.length > 1) {
				// Multiple products - check if they're all the same kind
				const firstCoord = coordinatesArray[0].split(':')
				const kind = firstCoord[0]

				const scopeIds = coordinatesArray.map((c) => c.split(':')[2])

				if (kind === '30405') {
					// Multiple collections (rare case)
					return {
						...detail,
						userId: userPubkey,
						scope: 'collection' as PaymentScope,
						scopeId: scopeIds[0],
						scopeName: `${coordinatesArray.length} Collections`,
						scopeIds,
						isDefault: detail.isDefault || false,
					}
				} else {
					// Multiple products
					return {
						...detail,
						userId: userPubkey,
						scope: 'product' as PaymentScope,
						scopeId: scopeIds[0],
						scopeName: `${coordinatesArray.length} Products`,
						scopeIds,
						isDefault: detail.isDefault || false,
					}
				}
			} else {
				// Single product or collection
				const scopeInfo = parseScopeFromCoordinates(coordinatesArray[0])
				return {
					...detail,
					userId: userPubkey,
					...scopeInfo,
					scopeIds: [scopeInfo.scopeId!].filter(Boolean),
					isDefault: detail.isDefault || false,
				}
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
export const useRichUserPaymentDetails = (userPubkey: string | undefined) => {
	return useQuery({
		queryKey: paymentDetailsKeys.byPubkey(userPubkey),
		queryFn: () => fetchRichUserPaymentDetails(userPubkey!),
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
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationKey: paymentDetailsKeys.publish(),
		mutationFn: publishRichPaymentDetail,
		onSuccess: async (eventId, variables) => {
			toast.success('Payment details saved successfully')

			// Get current user pubkey to invalidate the correct query
			let userPubkey = ''
			if (signer) {
				try {
					const user = await signer.user()
					if (user?.pubkey) {
						userPubkey = user.pubkey
					}
				} catch (error) {
					console.error('Failed to get user pubkey for cache invalidation:', error)
				}
			}

			// Invalidate relevant queries
			if (userPubkey) {
				queryClient.invalidateQueries({ queryKey: paymentDetailsKeys.byPubkey(userPubkey) })
			}

			if (variables.coordinates) {
				const coordinatesArray = Array.isArray(variables.coordinates) ? variables.coordinates : [variables.coordinates]
				coordinatesArray.forEach((coord) => {
					queryClient.invalidateQueries({ queryKey: paymentDetailsKeys.byProductOrCollection(coord) })
				})
			}

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
				const coordinatesArray = Array.isArray(variables.coordinates) ? variables.coordinates : [variables.coordinates]
				coordinatesArray.forEach((coord) => {
					queryClient.invalidateQueries({ queryKey: paymentDetailsKeys.byProductOrCollection(coord) })
				})
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

export interface GeneratedInvoice {
	id: string
	sellerPubkey: string
	sellerName: string
	amount: number
	bolt11: string | null
	lightningAddress: string | null
	expiresAt: number | undefined
	status: 'pending' | 'paid' | 'expired' | 'failed'
	isZap?: boolean
}

export interface GenerateInvoiceParams {
	sellerPubkey: string
	amountSats: number
	description: string
	invoiceId: string // A unique ID for this specific invoice generation attempt
	items: Array<{ productId: string; name: string; amount: number; price: number }>
	type: 'seller' | 'v4v'
	selectedPaymentDetailId?: string // Optional: Specific payment detail to use (bypasses resolution)
}

const createZapNostrProvider = async (ndkInstance: ReturnType<typeof ndkActions.getNDK>): Promise<NostrProvider | null> => {
	if (!ndkInstance || !ndkInstance.signer) {
		return null
	}

	const signer = ndkInstance.signer

	const getPubkey = async () => {
		try {
			const user = await signer.user()
			return user?.pubkey || signer.pubkey
		} catch (error) {
			console.warn('Failed to resolve signer pubkey for zap invoice:', error)
			return signer.pubkey
		}
	}

	const provider: NostrProvider = {
		getPublicKey: getPubkey,
		signEvent: async (event) => {
			const ndkEvent = new NDKEvent(ndkInstance)
			ndkEvent.kind = event.kind
			ndkEvent.content = event.content
			ndkEvent.tags = event.tags
			ndkEvent.created_at = event.created_at
			ndkEvent.pubkey = event.pubkey || (await getPubkey())
			if (event.id) {
				ndkEvent.id = event.id
			}

			await ndkEvent.sign(signer)

			return {
				...event,
				id: ndkEvent.id || event.id || '',
				sig: ndkEvent.sig || event.sig || '',
				pubkey: ndkEvent.pubkey || (await getPubkey()),
			}
		},
	}

	return provider
}

/**
 * Generates a BOLT11 invoice from a seller's payment details or lightning address.
 * Priority order:
 * 1. Product-specific payment details
 * 2. Collection-specific payment details
 * 3. Global payment details
 * 4. Seller's lud16 from profile
 */
export const generateInvoice = async (params: GenerateInvoiceParams): Promise<GeneratedInvoice> => {
	const { sellerPubkey, amountSats, description, items, type, selectedPaymentDetailId } = params

	// Fetch profile to get seller name and lud16 fallback
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const user = ndk.getUser({ pubkey: sellerPubkey })
	await user.fetchProfile()
	const sellerName = user.profile?.displayName || user.profile?.name || nip19.npubEncode(sellerPubkey).substring(0, 12)
	const fallbackLnAddress = user.profile?.lud16 || user.profile?.lud06

	let paymentDetails: PaymentDetail[] = []
	let lnAddress: string | null = null

	// For V4V payments, skip payment details resolution and use profile lud16 directly
	if (type === 'v4v') {
		console.log(`V4V payment - using seller's profile lud16 for ${sellerName}`)
		lnAddress = fallbackLnAddress || null
	} else if (selectedPaymentDetailId) {
		// If a specific payment detail was selected, use it directly
		console.log(`🎯 Using buyer-selected payment detail ID: ${selectedPaymentDetailId}`)
		try {
			const selectedDetail = await fetchPaymentDetail(selectedPaymentDetailId)
			if (selectedDetail && selectedDetail.paymentMethod === PAYMENT_DETAILS_METHOD.LIGHTNING_NETWORK) {
				lnAddress = selectedDetail.paymentDetail
				console.log(`📍 Using buyer-selected lightning address: ${lnAddress}`)
			} else {
				console.warn(`⚠️ Selected payment detail not found or not Lightning, falling back to resolution`)
			}
		} catch (error) {
			console.error(`❌ Error fetching selected payment detail, falling back to resolution:`, error)
		}
	}

	// If no specific payment detail was selected or fetching failed, use resolution logic
	if (!lnAddress && type !== 'v4v') {
		// For seller payments, resolve payment details using the priority order:
		// 1. Product-specific 2. Collection-specific 3. Global 4. Profile lud16
		const productIds = items.map((item) => item.productId)

		// Try each product in order until we find payment details
		for (const productId of productIds) {
			try {
				console.log(`🔍 Resolving payment details for product ${productId}`)
				const resolvedDetails = await resolvePaymentDetailsForProduct(productId, sellerPubkey)

				if (resolvedDetails.length > 0) {
					console.log(`✅ Found ${resolvedDetails.length} payment detail(s) for product ${productId}`)
					paymentDetails = resolvedDetails
					break // Use the first product's payment details
				}
			} catch (error) {
				console.error(`❌ Error resolving payment details for product ${productId}:`, error)
			}
		}

		// Extract Lightning Network address from resolved payment details
		if (paymentDetails.length > 0) {
			const lightningPaymentDetail = paymentDetails.find((pd) => pd.paymentMethod === PAYMENT_DETAILS_METHOD.LIGHTNING_NETWORK)
			if (lightningPaymentDetail) {
				lnAddress = lightningPaymentDetail.paymentDetail
				console.log(`📍 Using resolved lightning address: ${lnAddress}`)
			}
		}

		// Fallback to profile lud16 if no payment details found
		if (!lnAddress && fallbackLnAddress) {
			console.log(`⚠️ No payment details found, using fallback lud16: ${fallbackLnAddress}`)
			lnAddress = fallbackLnAddress
		}
	}

	// If still no lightning address found, return failed status
	if (!lnAddress) {
		console.warn(`❌ No lightning address found for seller ${sellerName}`)
		return {
			...params,
			id: params.invoiceId,
			sellerName,
			amount: amountSats,
			bolt11: null,
			lightningAddress: null,
			expiresAt: undefined,
			status: 'failed',
		}
	}

	// Generate the invoice using the resolved lightning address
	try {
		console.log(`⚡ Generating invoice for ${lnAddress} (${amountSats} sats)`)
		const ln = new LightningAddress(lnAddress)
		await ln.fetch()

		const zapSupported = (ln.lnurlpData?.allowsNostr ?? ln.lnurlpData?.rawData?.allowsNostr ?? false) && !!ln.nostrPubkey
		let invoice: Invoice | null = null
		let generatedViaZap = false

		if (zapSupported) {
			try {
				const nostrProvider = await createZapNostrProvider(ndk)
				if (nostrProvider) {
					console.log('⚡ Attempting zap invoice generation via LNURLp')
					invoice = await ln.zapInvoice(
						{
							satoshi: amountSats,
							comment: description,
							relays: ZAP_RELAYS,
							p: sellerPubkey,
						},
						{ nostr: nostrProvider },
					)
					generatedViaZap = true
				} else {
					console.warn('Zap invoice requested but no signer available. Falling back to regular invoice.')
				}
			} catch (zapError) {
				console.warn('Zap invoice generation failed, falling back to regular invoice:', zapError)
			}
		}

		if (!invoice) {
			invoice = await ln.requestInvoice({ satoshi: amountSats, comment: description })
		}

		if (!invoice.paymentRequest) {
			throw new Error('Failed to retrieve BOLT11 invoice from lightning address.')
		}

		console.log(`✅ Invoice generated successfully for ${sellerName}`)
		return {
			...params,
			id: params.invoiceId,
			sellerName,
			amount: amountSats,
			bolt11: invoice.paymentRequest,
			lightningAddress: lnAddress,
			expiresAt: invoice.expiry,
			status: 'pending',
			isZap: generatedViaZap,
		}
	} catch (error) {
		console.error(`❌ Failed to generate invoice for ${lnAddress}:`, error)
		// Return failed status on error
		return {
			...params,
			id: params.invoiceId,
			sellerName,
			amount: amountSats,
			bolt11: null,
			lightningAddress: lnAddress,
			expiresAt: undefined,
			status: 'failed',
			isZap: false,
		}
	}
}

/**
 * Mutation hook for generating a new invoice.
 */
export const useGenerateInvoiceMutation = () => {
	return useMutation({
		mutationFn: generateInvoice,
		onError: (error, variables) => {
			toast.error(`Failed to generate invoice for ${variables.sellerPubkey}: ${error.message}`)
		},
	})
}

/**
 * Gets all available payment options for a seller's products.
 * Returns all payment details found via the priority resolution.
 * @param productIds - Array of product IDs to resolve payment details for
 * @param sellerPubkey - The seller's pubkey
 * @returns Array of unique payment details
 */
export const getAvailablePaymentOptions = async (productIds: string[], sellerPubkey: string): Promise<PaymentDetail[]> => {
	try {
		const allPaymentDetails: PaymentDetail[] = []

		// Collect payment details from all products
		for (const productId of productIds) {
			try {
				const resolvedDetails = await resolvePaymentDetailsForProduct(productId, sellerPubkey)
				allPaymentDetails.push(...resolvedDetails)
			} catch (error) {
				console.error(`Error resolving payment details for product ${productId}:`, error)
			}
		}

		// Remove duplicates based on payment detail ID
		const uniquePaymentDetails = Array.from(new Map(allPaymentDetails.map((pd) => [pd.id, pd])).values())

		// Filter to only Lightning Network payment methods
		const lightningPayments = uniquePaymentDetails.filter((pd) => pd.paymentMethod === PAYMENT_DETAILS_METHOD.LIGHTNING_NETWORK)

		console.log(`Found ${lightningPayments.length} unique Lightning payment option(s) for seller`)
		return lightningPayments
	} catch (error) {
		console.error('Error getting available payment options:', error)
		return []
	}
}

/**
 * Query hook for fetching available payment options for seller's products
 */
export const useAvailablePaymentOptions = (productIds: string[], sellerPubkey: string, enabled = true) => {
	return useQuery({
		queryKey: paymentDetailsKeys.availableOptions(sellerPubkey, productIds),
		queryFn: () => getAvailablePaymentOptions(productIds, sellerPubkey),
		enabled: enabled && productIds.length > 0 && !!sellerPubkey,
		staleTime: 1000 * 60 * 5, // 5 minutes
	})
}

/**
 * Resolves the applicable payment details for a given product.
 * Priority order:
 * 1. Product-specific payment details
 * 2. Collection-specific payment details (if product is in a collection)
 * 3. Global payment details
 * 4. Seller's lud16 from profile metadata
 *
 * @param productId - The product ID (d-tag)
 * @param sellerPubkey - The seller's pubkey
 * @returns Array of payment details, or empty array if none found
 */
export const resolvePaymentDetailsForProduct = async (productId: string, sellerPubkey: string): Promise<PaymentDetail[]> => {
	try {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		// 1. Check for product-specific payment details
		const productCoordinates = `30402:${sellerPubkey}:${productId}`
		const productPaymentDetails = await fetchProductPaymentDetails(productCoordinates, sellerPubkey)

		if (productPaymentDetails.length > 0) {
			console.log(`Found ${productPaymentDetails.length} product-specific payment details for ${productId}`)
			return productPaymentDetails
		}

		// 2. Check if product is in a collection and get collection-specific payment details
		// First, fetch the product event to see if it has collection references
		const productEvent = await ndk.fetchEvent({
			kinds: [30402],
			authors: [sellerPubkey],
			'#d': [productId],
		})

		if (productEvent) {
			// Look for 'a' tags that reference collections (kind 30405)
			const collectionTags = productEvent.tags.filter((tag) => tag[0] === 'a' && tag[1]?.startsWith('30405:'))

			for (const collectionTag of collectionTags) {
				const collectionCoordinates = collectionTag[1]
				const collectionPaymentDetails = await fetchProductPaymentDetails(collectionCoordinates, sellerPubkey)

				if (collectionPaymentDetails.length > 0) {
					console.log(`Found ${collectionPaymentDetails.length} collection-specific payment details for product ${productId}`)
					return collectionPaymentDetails
				}
			}
		}

		// 3. Check for global payment details
		const globalPaymentDetails = await fetchUserPaymentDetails(sellerPubkey)
		const globalOnly = globalPaymentDetails.filter((pd) => !pd.coordinates)

		if (globalOnly.length > 0) {
			console.log(`Found ${globalOnly.length} global payment details for seller ${sellerPubkey}`)
			return globalOnly
		}

		// 4. Fallback: no payment details found, will use seller's lud16 from profile
		console.log(`No payment details found for product ${productId}, will use seller's lud16`)
		return []
	} catch (error) {
		console.error(`Error resolving payment details for product ${productId}:`, error)
		return []
	}
}

export interface LightningInvoiceData {
	id: string
	sellerPubkey: string
	sellerName: string
	amount: number
	bolt11: string
	expiresAt?: number
	items: Array<{
		productId: string
		name: string
		amount: number
		price: number
	}>
	status: 'pending' | 'processing' | 'paid' | 'expired' | 'failed' | 'skipped'
	invoiceType?: 'seller' | 'v4v'
	originalSellerPubkey?: string
}

export interface PaymentReceiptSubscriptionParams {
	orderId: string
	invoiceId: string
	sessionStartTime: number
	enabled: boolean
}

/**
 * Subscribes to Kind 17 payment receipts for a specific invoice.
 * @returns The payment preimage when a valid receipt is found.
 */
export const usePaymentReceiptSubscription = (params: PaymentReceiptSubscriptionParams) => {
	const { orderId, invoiceId, sessionStartTime, enabled } = params

	return useQuery<string | null>({
		queryKey: paymentDetailsKeys.paymentReceipt(orderId!, invoiceId!),
		queryFn: () => {
			return new Promise((resolve) => {
				if (!enabled) {
					resolve(null)
					return
				}

				const ndk = ndkActions.getNDK()
				if (!ndk) {
					resolve(null)
					return
				}

				console.log(`🔍 Subscribing to payment receipts for invoice: ${invoiceId}`)

				// Cannot use multi-character tag filters - fetch all kind 17 events and filter programmatically
				const receiptFilter = {
					kinds: [17],
					since: sessionStartTime - 30, // 30-second buffer for clock skew
				}

				const subscription = ndk.subscribe(receiptFilter, {
					closeOnEose: false,
				})

				subscription.on('event', (receiptEvent: NDKEvent) => {
					// Filter programmatically for order and payment-request
					const orderTag = receiptEvent.tags.find((tag) => tag[0] === 'order')
					const paymentRequestTag = receiptEvent.tags.find((tag) => tag[0] === 'payment-request')

					// Only process events for our specific order and invoice
					if (orderTag?.[1] !== orderId || paymentRequestTag?.[1] !== invoiceId) {
						return
					}

					console.log(`💳 Payment receipt received for invoice: ${invoiceId}`, receiptEvent)

					if (receiptEvent.created_at && receiptEvent.created_at < sessionStartTime - 30) {
						console.log('⏰ Ignoring old receipt from before session start')
						return
					}

					const paymentTag = receiptEvent.tags.find((tag) => tag[0] === 'payment')
					const preimage = paymentTag?.[3] || 'external-payment'

					console.log(`✅ Valid payment receipt detected for ${invoiceId}`)
					subscription.stop()
					resolve(preimage)
				})
			})
		},
		enabled: enabled,
		refetchOnWindowFocus: false,
		refetchOnReconnect: true,
	})
}

/**
 * A mutation hook for paying an invoice using Nostr Wallet Connect (NWC).
 */
export const useNwcPaymentMutation = () => {
	return useMutation({
		mutationFn: async (params: PayWithNwcParams) => {
			return payInvoiceWithNwc(params)
		},
		onSuccess: () => {
			toast.success('NWC payment successful!')
		},
		onError: (error) => {
			toast.error(`NWC Payment Failed: ${error.message}`)
		},
	})
}

/**
 * A mutation hook for paying an invoice using WebLN.
 */
export const useWeblnPaymentMutation = () => {
	return useMutation({
		mutationFn: async (bolt11: string) => {
			return payInvoiceWithWebln(bolt11)
		},
		onSuccess: () => {
			toast.success('WebLN payment successful!')
		},
		onError: (error) => {
			toast.error(`WebLN Payment Failed: ${error.message}`)
		},
	})
}
