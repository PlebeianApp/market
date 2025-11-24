import { ORDER_MESSAGE_TYPE, ORDER_PROCESS_KIND, ORDER_GENERAL_KIND, PAYMENT_RECEIPT_KIND, ORDER_STATUS } from '@/lib/schemas/order'
import { ndkActions } from '@/lib/stores/ndk'
import { orderKeys } from '@/queries/queryKeyFactory'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import type { NDKTag } from '@nostr-dev-kit/ndk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { v4 as uuidv4 } from 'uuid'
import type { CheckoutFormData } from '@/components/checkout/ShippingAddressForm'
import { fetchProfileByIdentifier } from '@/queries/profiles'
import { getShippingEvent, getShippingService } from '@/queries/shipping'
// import type { CartProduct, SellerData, V4VShare } from '@/lib/stores/cart'

/**
 * Helper function to check if all products in a list are pickup orders
 */
async function checkIfAllProductsArePickup(products: CartProduct[]): Promise<boolean> {
	try {
		const pickupChecks = await Promise.all(
			products.map(async (product) => {
				if (!product.shippingMethodId) return false

				try {
					const shippingEvent = await getShippingEvent(product.shippingMethodId)
					if (!shippingEvent) return false

					const serviceTag = getShippingService(shippingEvent)
					return serviceTag?.[1] === 'pickup'
				} catch (error) {
					console.error('Error checking shipping service:', error)
					return false
				}
			}),
		)

		return pickupChecks.every((isPickup) => isPickup)
	} catch (error) {
		console.error('Error checking if all products are pickup:', error)
		return false
	}
}

// Temporary type definitions - ideally these should be imported from a central types file
interface CartProduct {
	id: string
	amount: number
	shippingMethodId?: string | null
}
interface V4VShare {
	pubkey: string
	name: string
	percentage: number
}
interface SellerData {
	satsTotal: number
	shippingSats: number
	shares: {
		sellerAmount: number
	}
}

export type OrderCreateParams = {
	productRef: string // Product reference in format 30402:<pubkey>:<d-tag>
	sellerPubkey: string // Merchant's pubkey
	quantity: number
	price: number
	currency?: string
	shippingRef?: string // Reference to shipping option in format 30406:<pubkey>:<d-tag>
	shippingAddress?: string
	email?: string // Customer email for contact
	phone?: string // Customer phone for contact
	notes?: string
}

/**
 * Creates a new order on the Nostr network
 */
export const createOrder = async (params: OrderCreateParams): Promise<string> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const signer = ndkActions.getSigner()
	if (!signer) throw new Error('No active user')

	const user = ndk.activeUser
	if (!user) throw new Error('No active user')

	const currency = params.currency || 'USD'
	const total = (params.price * params.quantity).toFixed(2)
	const orderId = uuidv4()

	// Create the order event according to Gamma Market Spec (NIP-17)
	const event = new NDKEvent(ndk)
	event.kind = ORDER_PROCESS_KIND // Kind 16 for order processing
	event.content = params.notes || ''
	event.tags = [
		// Required tags per spec
		['p', params.sellerPubkey], // Merchant's pubkey
		['subject', `Order for ${params.productRef.split(':').pop() || 'product'}`],
		['type', ORDER_MESSAGE_TYPE.ORDER_CREATION], // Type 1 for order creation
		['order', orderId],
		['amount', total],

		// Item details - the spec requires this format
		['item', params.productRef, params.quantity.toString()],
	]

	// Add optional tags
	if (params.shippingRef) {
		event.tags.push(['shipping', params.shippingRef])
	}

	if (params.shippingAddress) {
		event.tags.push(['address', params.shippingAddress])
	}

	if (params.email) {
		event.tags.push(['email', params.email])
	}

	if (params.phone) {
		event.tags.push(['phone', params.phone])
	}

	if (params.notes) {
		event.tags.push(['notes', params.notes])
	}

	// Sign and publish the event
	await event.sign(signer)
	await event.publish()

	return event.id
}

/**
 * Mutation hook for creating a new order
 */
export const useCreateOrderMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const currentUserPubkey = ndk?.activeUser?.pubkey

	return useMutation({
		mutationFn: createOrder,
		onSuccess: async (orderId) => {
			// Invalidate all order queries
			await queryClient.invalidateQueries({ queryKey: orderKeys.all })

			// If we have the current user's pubkey, invalidate user specific queries
			if (currentUserPubkey) {
				await queryClient.invalidateQueries({ queryKey: orderKeys.byPubkey(currentUserPubkey) })
				await queryClient.invalidateQueries({ queryKey: orderKeys.byBuyer(currentUserPubkey) })
			}

			toast.success('Order created successfully')
			return orderId
		},
		onError: (error) => {
			console.error('Failed to create order:', error)
			toast.error('Failed to create order')
		},
	})
}

export type OrderStatusUpdateParams = {
	orderEventId: string
	status: (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS]
	tracking?: string
	reason?: string
	onSuccess?: () => void // Optional callback for client-side refresh
}

/**
 * Updates the status of an order on the Nostr network
 */
export const updateOrderStatus = async (params: OrderStatusUpdateParams): Promise<NDKEvent> => {
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

	// Create the order status event
	const event = new NDKEvent(ndk)
	event.kind = ORDER_PROCESS_KIND
	event.content = params.reason || `Order status updated to ${params.status}`
	event.tags = [
		['p', recipientPubkey],
		['subject', 'order-info'],
		['type', ORDER_MESSAGE_TYPE.STATUS_UPDATE],
		['order', originalOrderId || params.orderEventId],
		['status', params.status],
	]

	// Add optional tracking information if provided
	if (params.tracking) {
		event.tags.push(['tracking', params.tracking])
	}

	// Sign and publish the event
	await event.sign(signer)
	await event.publish()

	return event
}

/**
 * Mutation hook for updating order status
 */
export const useUpdateOrderStatusMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const currentUserPubkey = ndk?.activeUser?.pubkey

	return useMutation({
		mutationFn: updateOrderStatus,
		onSuccess: async (event, params) => {
			// Show toast first for immediate feedback
			toast.success(`Order status updated to ${params.status}`)

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
			console.error('Failed to update order status:', error)
			toast.error('Failed to update order status')
		},
	})
}

export type PaymentReceiptParams = {
	orderEventId: string
	method: 'lightning' | 'bitcoin' | 'fiat' | 'other'
	amount: number
	currency?: string
	txid?: string
	proof?: string
}

/**
 * Creates a payment receipt for an order on the Nostr network
 */
export const createPaymentReceipt = async (params: PaymentReceiptParams): Promise<string> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const signer = ndkActions.getSigner()
	if (!signer) throw new Error('No active user')

	const currency = params.currency || 'USD'

	// Get the merchant pubkey from the original order
	const originalOrder = await ndk.fetchEvent({
		ids: [params.orderEventId],
	})

	if (!originalOrder) throw new Error('Original order not found')

	// Find merchant pubkey (p tag in original order)
	const merchantTag = originalOrder.tags.find((tag) => tag[0] === 'p')
	const merchantPubkey = merchantTag?.[1]

	if (!merchantPubkey) throw new Error('Merchant pubkey not found in order')

	// Create the payment receipt event according to Gamma Market Spec
	const event = new NDKEvent(ndk)
	event.kind = PAYMENT_RECEIPT_KIND
	event.content = `Payment confirmation for order`
	event.tags = [
		// Required tags per spec
		['p', merchantPubkey], // Merchant's pubkey
		['subject', 'order-receipt'],
		['order', params.orderEventId],

		// Payment proof with medium, reference and proof
		['payment', params.method, params.txid || 'unknown', params.proof || ''],

		// Amount
		['amount', params.amount.toFixed(2)],
	]

	// Sign and publish the event
	await event.sign(signer)
	await event.publish()

	return event.id
}

/**
 * Mutation hook for creating a payment receipt
 */
export const useCreatePaymentReceiptMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const currentUserPubkey = ndk?.activeUser?.pubkey

	return useMutation({
		mutationFn: createPaymentReceipt,
		onSuccess: async (_, params) => {
			// Invalidate all order queries
			await queryClient.invalidateQueries({ queryKey: orderKeys.all })

			// Invalidate the specific order details
			await queryClient.invalidateQueries({ queryKey: orderKeys.details(params.orderEventId) })

			// If we have the current user's pubkey, invalidate buyer and seller specific queries
			if (currentUserPubkey) {
				await queryClient.invalidateQueries({ queryKey: orderKeys.byPubkey(currentUserPubkey) })
				await queryClient.invalidateQueries({ queryKey: orderKeys.byBuyer(currentUserPubkey) })
				await queryClient.invalidateQueries({ queryKey: orderKeys.bySeller(currentUserPubkey) })
			}

			toast.success('Payment receipt created')
		},
		onError: (error) => {
			console.error('Failed to create payment receipt:', error)
			toast.error('Failed to create payment receipt')
		},
	})
}

// Types based on gamma_spec.md
export interface OrderCreationData {
	merchantPubkey: string
	buyerPubkey: string
	orderItems: Array<{
		productRef: string // "30402:<pubkey>:<d-tag>"
		quantity: number
	}>
	totalAmountSats: number
	shippingRef?: string // "30406:<pubkey>:<d-tag>"
	shippingAddress?: CheckoutFormData
	email?: string
	phone?: string
	notes?: string
	paymentMethod?: 'ln' | 'on-chain' // Buyer's chosen payment method
}

export interface PaymentRequestData {
	buyerPubkey: string
	merchantPubkey: string
	orderId: string
	amountSats: number
	paymentMethods: Array<{
		type: 'lightning' | 'bitcoin' | 'other'
		details: string // BOLT11, address, etc.
	}>
	expirationTime?: number
	notes?: string
}

export interface StatusUpdateData {
	recipientPubkey: string
	senderPubkey: string
	orderId: string
	status: 'pending' | 'confirmed' | 'processing' | 'completed' | 'cancelled'
	notes?: string
}

export interface PaymentReceiptData {
	merchantPubkey: string
	buyerPubkey: string
	orderId: string
	amountSats: number
	paymentProof: {
		medium: 'lightning' | 'bitcoin' | 'other'
		reference: string // invoice, address, etc.
		proof: string // preimage, txid, etc.
	}
	notes?: string
}

/**
 * Creates a spec-compliant order creation event (Kind 16, type 1)
 * Following gamma_spec.md section 4.1
 */
export async function createOrderCreationEvent(data: OrderCreationData): Promise<NDKEvent> {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const orderId = uuidv4()
	const now = Math.floor(Date.now() / 1000)

	// Build tags according to spec
	const tags: NDKTag[] = [
		// Required tags
		['p', data.merchantPubkey],
		['subject', `Order ${orderId.substring(0, 8)}`],
		['type', ORDER_MESSAGE_TYPE.ORDER_CREATION],
		['order', orderId],
		['amount', data.totalAmountSats.toString()],
	]

	// Add item tags
	data.orderItems.forEach((item) => {
		tags.push(['item', item.productRef, item.quantity.toString()])
	})

	// Optional tags
	if (data.shippingRef) {
		tags.push(['shipping', data.shippingRef])
	}

	if (data.shippingAddress) {
		// Create a newline-separated address for better parsing and readability
		const addressParts = [
			data.shippingAddress.name,
			data.shippingAddress.firstLineOfAddress,
			data.shippingAddress.additionalInformation, // Include additional info if present
			data.shippingAddress.city,
			data.shippingAddress.zipPostcode,
			data.shippingAddress.country,
		].filter(Boolean) // Remove empty values

		const addressString = addressParts.join('\n')
		tags.push(['address', addressString])
	}

	if (data.email) {
		tags.push(['email', data.email])
	}

	if (data.phone) {
		tags.push(['phone', data.phone])
	}

	// Add payment method if specified
	if (data.paymentMethod) {
		tags.push(['payment_method', data.paymentMethod])
	}

	// Create the event
	const event = new NDKEvent(ndk)
	event.kind = ORDER_PROCESS_KIND
	event.created_at = now
	event.content = data.notes || `Order for ${data.orderItems.length} items`
	event.tags = tags

	// Sign the event
	await event.sign()

	return event
}

/**
 * Creates a spec-compliant payment request event (Kind 16, type 2)
 * Following gamma_spec.md section 4.2
 */
export async function createPaymentRequestEvent(data: PaymentRequestData): Promise<NDKEvent> {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const now = Math.floor(Date.now() / 1000)

	// Build tags according to spec
	const tags: NDKTag[] = [
		// Required tags
		['p', data.buyerPubkey],
		['recipient', data.merchantPubkey],
		['subject', 'order-payment'],
		['type', ORDER_MESSAGE_TYPE.PAYMENT_REQUEST],
		['order', data.orderId],
		['amount', data.amountSats.toString()],
	]

	// Add payment method tags
	data.paymentMethods.forEach((method) => {
		tags.push(['payment', method.type, method.details])
	})

	// Optional expiration
	if (data.expirationTime) {
		tags.push(['expiration', data.expirationTime.toString()])
	}

	// Create the event
	const event = new NDKEvent(ndk)
	event.kind = ORDER_PROCESS_KIND
	event.created_at = now
	event.content = data.notes || 'Payment request for your order'
	event.tags = tags

	// Sign the event
	await event.sign()

	return event
}

export interface OnChainPaymentRequestData {
	buyerPubkey: string
	recipientPubkey: string // Can be merchant or V4V recipient
	orderId: string
	amountSats: number
	bitcoinAddress: string
	isV4V?: boolean // True if this is a V4V payment
	v4vRecipientName?: string
	notes?: string
}

/**
 * Creates an on-chain payment request event (Kind 16, type 2)
 * Seller/V4V recipient provides a Bitcoin address for the buyer to pay to
 */
export async function createOnChainPaymentRequest(data: OnChainPaymentRequestData): Promise<NDKEvent> {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const now = Math.floor(Date.now() / 1000)

	// Build tags according to spec
	const tags: NDKTag[] = [
		// Required tags
		['p', data.buyerPubkey],
		['subject', data.isV4V ? 'v4v-payment-request' : 'order-payment'],
		['type', ORDER_MESSAGE_TYPE.PAYMENT_REQUEST],
		['order', data.orderId],
		['amount', data.amountSats.toString()],
		['currency', 'sats'],

		// On-chain payment details
		['payment_method', 'on-chain'],
		['bitcoin_address', data.bitcoinAddress],
	]

	// Add V4V markers if applicable
	if (data.isV4V) {
		tags.push(['payment-type', 'v4v'])
		tags.push(['v4v-recipient', data.recipientPubkey])
	}

	// Create the event
	const event = new NDKEvent(ndk)
	event.kind = ORDER_PROCESS_KIND
	event.created_at = now
	event.content =
		data.notes ||
		(data.isV4V
			? `V4V payment request: Please send ${data.amountSats} sats to the provided Bitcoin address`
			: `Please send ${data.amountSats} sats to the provided Bitcoin address`)
	event.tags = tags

	// Sign the event
	await event.sign()

	return event
}

/**
 * Creates a spec-compliant status update event (Kind 16, type 3)
 * Following gamma_spec.md section 4.3
 */
export async function createStatusUpdateEvent(data: StatusUpdateData): Promise<NDKEvent> {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const now = Math.floor(Date.now() / 1000)

	// Build tags according to spec
	const tags: NDKTag[] = [
		// Required tags
		['p', data.recipientPubkey],
		['subject', 'order-info'],
		['type', ORDER_MESSAGE_TYPE.STATUS_UPDATE],
		['order', data.orderId],
		['status', data.status],
	]

	// Create the event
	const event = new NDKEvent(ndk)
	event.kind = ORDER_PROCESS_KIND
	event.created_at = now
	event.content = data.notes || `Order status updated to ${data.status}`
	event.tags = tags

	// Sign the event
	await event.sign()

	return event
}

/**
 * Creates a spec-compliant payment receipt event (Kind 17)
 * Following gamma_spec.md section 4.6
 */
export async function createPaymentReceiptEvent(data: PaymentReceiptData): Promise<NDKEvent> {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const now = Math.floor(Date.now() / 1000)

	// Build tags according to spec
	const tags: NDKTag[] = [
		// Required tags
		['p', data.merchantPubkey],
		['subject', 'order-receipt'],
		['order', data.orderId],
		['payment', data.paymentProof.medium, data.paymentProof.reference, data.paymentProof.proof],
		['amount', data.amountSats.toString()],
	]

	// Create the event
	const event = new NDKEvent(ndk)
	event.kind = PAYMENT_RECEIPT_KIND
	event.created_at = now
	event.content = data.notes || 'Payment confirmation'
	event.tags = tags

	// Sign the event
	await event.sign()

	return event
}

/**
 * Creates a general communication event (Kind 14)
 * Following gamma_spec.md section 4.5
 */
export async function createGeneralCommunicationEvent(recipientPubkey: string, subject: string, message: string): Promise<NDKEvent> {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const now = Math.floor(Date.now() / 1000)

	// Build tags according to spec
	const tags: NDKTag[] = [
		['p', recipientPubkey],
		['subject', subject],
	]

	// Create the event
	const event = new NDKEvent(ndk)
	event.kind = ORDER_GENERAL_KIND
	event.created_at = now
	event.content = message
	event.tags = tags

	// Sign the event
	await event.sign()

	return event
}

/**
 * Publishes an order-related event to the network
 */
export async function publishOrderEvent(event: NDKEvent): Promise<boolean> {
	try {
		await event.publish()
		console.log(`Published order event: ${event.kind}`)
		return true
	} catch (error) {
		console.error('Failed to publish order event:', error)
		return false
	}
}

/**
 * Complete order creation workflow - creates order and publishes it
 */
export async function createAndPublishOrder(data: OrderCreationData): Promise<{ orderId: string; success: boolean }> {
	try {
		const orderEvent = await createOrderCreationEvent(data)
		const orderId = orderEvent.tags.find((tag) => tag[0] === 'order')?.[1] || ''

		const success = await publishOrderEvent(orderEvent)

		if (success) {
			console.log(`Order ${orderId} created and published successfully`)
		}

		return { orderId, success }
	} catch (error) {
		console.error('Failed to create and publish order:', error)
		return { orderId: '', success: false }
	}
}

/**
 * Merchant workflow: Create and send payment request
 */
export async function requestPayment(data: PaymentRequestData): Promise<boolean> {
	try {
		const paymentEvent = await createPaymentRequestEvent(data)
		return await publishOrderEvent(paymentEvent)
	} catch (error) {
		console.error('Failed to request payment:', error)
		return false
	}
}

/**
 * Update order status workflow (spec-compliant)
 */
export async function updateOrderStatusSpec(data: StatusUpdateData): Promise<boolean> {
	try {
		const statusEvent = await createStatusUpdateEvent(data)
		return await publishOrderEvent(statusEvent)
	} catch (error) {
		console.error('Failed to update order status:', error)
		return false
	}
}

/**
 * Buyer workflow: Send payment receipt
 */
export async function sendPaymentReceipt(data: PaymentReceiptData): Promise<boolean> {
	try {
		const receiptEvent = await createPaymentReceiptEvent(data)
		return await publishOrderEvent(receiptEvent)
	} catch (error) {
		console.error('Failed to send payment receipt:', error)
		return false
	}
}

export interface PublishOrderDependenciesParams {
	shippingData: CheckoutFormData
	sellers: string[]
	productsBySeller: Record<string, CartProduct[]>
	sellerData: Record<string, SellerData>
	v4vShares: Record<string, V4VShare[]>
	paymentMethod?: 'ln' | 'on-chain' // Buyer's chosen payment method for merchant payments
	v4vPaymentMethods?: Record<string, 'ln' | 'on-chain'> // Payment method per V4V recipient pubkey
}

/**
 * Creates and publishes a spec-compliant order for each seller,
 * then creates and publishes all necessary payment requests (merchant + V4V).
 * This function orchestrates the entire order creation and payment setup process.
 *
 * @returns An array of the created spec-compliant order IDs.
 */
export async function publishOrderWithDependencies(params: PublishOrderDependenciesParams): Promise<string[]> {
	const { shippingData, sellers, productsBySeller, sellerData, v4vShares, paymentMethod = 'ln', v4vPaymentMethods = {} } = params

	const ndk = ndkActions.getNDK()
	const currentUser = ndk?.activeUser
	const buyerPubkey = currentUser?.pubkey

	if (!buyerPubkey) {
		throw new Error('No active user found for order creation')
	}

	const newOrderIds: string[] = []

	for (const sellerPubkey of sellers) {
		const sellerProducts = productsBySeller[sellerPubkey] || []
		const data = sellerData[sellerPubkey]

		if (sellerProducts.length === 0 || !data) continue

		// Check if all products for this seller are pickup orders
		const isAllPickup = await checkIfAllProductsArePickup(sellerProducts)

		const orderData: OrderCreationData = {
			merchantPubkey: sellerPubkey,
			buyerPubkey: buyerPubkey,
			orderItems: sellerProducts.map((product) => ({
				productRef: `30402:${sellerPubkey}:${product.id}`,
				quantity: product.amount,
			})),
			totalAmountSats: data.satsTotal,
			// Only include shipping address if not all pickup
			shippingAddress: isAllPickup ? undefined : shippingData,
			email: shippingData.email || 'customer@example.com',
			notes: `Order for ${sellerProducts.length} item(s) from seller.`,
			paymentMethod: paymentMethod, // Add buyer's chosen payment method
		}

		// 1. Create the main order event
		const { orderId, success } = await createAndPublishOrder(orderData)
		if (!success || !orderId) {
			console.warn(`Failed to create order for seller ${sellerPubkey}. Skipping...`)
			continue
		}
		newOrderIds.push(orderId)
		console.log(`✅ Spec-compliant order created for seller ${sellerPubkey.substring(0, 8)}...:`, orderId)

		// 2. Create payment requests for the order (merchant + V4V)
		// Note: Only create immediate payment requests for Lightning payments
		// For on-chain payments, seller provides address later via createOnChainPaymentRequest()
		const paymentRequests: PaymentRequestData[] = []
		const productSubtotal = data.satsTotal - data.shippingSats
		const v4vRecipients = v4vShares[sellerPubkey] || []

		// 2a. Payment request for the merchant's share (only if Lightning)
		const merchantShare = data.shares.sellerAmount
		if (paymentMethod === 'ln') {
			const sellerProfile = await fetchProfileByIdentifier(sellerPubkey)
			const sellerLnAddress = sellerProfile?.profile?.lud16 || sellerProfile?.profile?.lud06

			if (!sellerLnAddress) {
				console.warn(`Seller ${sellerPubkey} has no lightning address. Cannot create payment request.`)
			} else {
				paymentRequests.push({
					buyerPubkey: buyerPubkey,
					merchantPubkey: sellerPubkey,
					orderId: orderId,
					amountSats: merchantShare,
					paymentMethods: [{ type: 'lightning', details: sellerLnAddress }],
					notes: `Payment for order ${orderId}`,
				})
			}
		} else {
			console.log(`On-chain payment chosen for merchant ${sellerPubkey}. Seller will provide Bitcoin address.`)
		}

		// 2b. Payment requests for V4V shares (only if Lightning chosen for that recipient)
		for (const recipient of v4vRecipients) {
			const recipientPercentage = recipient.percentage > 1 ? recipient.percentage / 100 : recipient.percentage
			const recipientAmount = Math.max(1, Math.floor(productSubtotal * recipientPercentage))

			if (recipientAmount > 0) {
				const recipientPaymentMethod = v4vPaymentMethods[recipient.pubkey] || 'ln' // Default to Lightning

				if (recipientPaymentMethod === 'ln') {
					const recipientProfile = await fetchProfileByIdentifier(recipient.pubkey)
					const recipientLnAddress = recipientProfile?.profile?.lud16 || recipientProfile?.profile?.lud06
					if (!recipientLnAddress) {
						console.warn(`V4V recipient ${recipient.name} has no lightning address. Skipping.`)
						continue
					}
					paymentRequests.push({
						buyerPubkey: buyerPubkey,
						merchantPubkey: recipient.pubkey, // V4V recipient is the one getting paid
						orderId: orderId,
						amountSats: recipientAmount,
						paymentMethods: [{ type: 'lightning', details: recipientLnAddress }],
						notes: `V4V share for order ${orderId} (${(recipientPercentage * 100).toFixed(1)}%)`,
					})
				} else {
					console.log(`On-chain payment chosen for V4V recipient ${recipient.name}. Recipient will provide Bitcoin address.`)
				}
			}
		}

		// 3. Publish all payment request events
		let successfulRequests = 0
		for (const req of paymentRequests) {
			try {
				const paymentRequestEvent = await createPaymentRequestEvent(req)
				await paymentRequestEvent.publish()
				successfulRequests++
			} catch (error) {
				console.error(`Failed to create payment request for ${req.notes}:`, error)
			}
		}
		console.log(`✅ Created ${successfulRequests}/${paymentRequests.length} payment request events for order ${orderId}`)
	}

	return newOrderIds
}
