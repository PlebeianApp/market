import { ORDER_MESSAGE_TYPE, ORDER_PROCESS_KIND, ORDER_STATUS, PAYMENT_RECEIPT_KIND } from '@/lib/schemas/order'
import { ndkActions } from '@/lib/stores/ndk'
import { orderKeys } from '@/queries/queryKeyFactory'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { v4 as uuidv4 } from 'uuid'

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
	method: 'lightning' | 'bitcoin' | 'ecash' | 'fiat' | 'other'
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
