import { ORDER_MESSAGE_TYPE, ORDER_PROCESS_KIND, ORDER_GENERAL_KIND, PAYMENT_RECEIPT_KIND, ORDER_STATUS } from '@/lib/schemas/order'
import { ndkActions } from '@/lib/stores/ndk'
import { orderKeys } from '@/queries/queryKeyFactory'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import type { NDKTag } from '@nostr-dev-kit/ndk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { v4 as uuidv4 } from 'uuid'
import type { CheckoutFormData } from '@/components/checkout/ShippingAddressForm'
import {
	isValidDigitalDeliveryContact,
	resolveCheckoutDeliveryRequirements,
	type CheckoutDeliveryRequirements,
} from '@sdk/commerce/checkout'
import {
	createBuyerOrderTemplate,
	createBuyerPaymentRequestTemplate,
	createGeneralOrderCommunicationTemplate,
	createOrderPaymentReceiptTemplate,
	createOrderStatusUpdateTemplate,
	createSellerOrderPublishFailure,
	executeSellerOrderPublishWorkflow,
	planSellerOrders,
	type SellerOrderPublishOutcome,
	type SellerOrderPublishPhase,
	type SellerOrderPublishProgress,
} from '@sdk/commerce/orders'
import { createEncryptedPrivateOrderMessageWithSigner, type PrivateOrderDeliveryDetails } from '@/lib/orders/privateOrderMessage'
import { fetchProfileByIdentifier } from '@/queries/profiles'
import { getShippingEvent, getShippingService } from '@/queries/shipping'
import type { Event } from 'nostr-tools'
// import type { CartProduct, SellerData, V4VShare } from '@/lib/stores/cart'

async function resolveDeliveryRequirementsForProducts(
	products: Array<{ id: string; shippingMethodId?: string | null }>,
): Promise<CheckoutDeliveryRequirements> {
	const shippingRefs = Array.from(new Set(products.map((product) => product.shippingMethodId?.trim()).filter(Boolean) as string[]))
	const servicesByShippingRef: Record<string, string | null> = {}

	await Promise.all(
		shippingRefs.map(async (shippingRef) => {
			try {
				const shippingEvent = await getShippingEvent(shippingRef)
				servicesByShippingRef[shippingRef] = shippingEvent ? getShippingService(shippingEvent)?.[1] || null : null
			} catch (error) {
				console.error('Error resolving shipping service:', error)
				servicesByShippingRef[shippingRef] = null
			}
		}),
	)

	return resolveCheckoutDeliveryRequirements({
		products,
		servicesByShippingRef,
	})
}

function hasRequiredPhysicalAddress(shippingData: CheckoutFormData): boolean {
	return Boolean(
		shippingData.name.trim() &&
		shippingData.firstLineOfAddress.trim() &&
		shippingData.city.trim() &&
		shippingData.zipPostcode.trim() &&
		shippingData.country.trim(),
	)
}

function getPublicSellerShippingRef(shippingRef: string | null | undefined): string | undefined {
	const trimmed = shippingRef?.trim()
	if (!trimmed || trimmed.includes('\n') || trimmed.includes('\r')) return undefined

	const [kind, sellerPubkey, ...dTagParts] = trimmed.split(':')
	const dTag = dTagParts.join(':')
	if (kind !== '30406' || !sellerPubkey || !dTag) return undefined

	return trimmed
}

function requiresPrivateBuyerDeliveryDetails(requirements: CheckoutDeliveryRequirements): boolean {
	return requirements.needsPhysicalAddress || requirements.needsDigitalDeliveryContact
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

let lastOrderUpdateCreatedAt = 0

const getNextOrderUpdateCreatedAt = () => {
	const now = Math.floor(Date.now() / 1000)
	lastOrderUpdateCreatedAt = Math.max(now, lastOrderUpdateCreatedAt + 1)
	return lastOrderUpdateCreatedAt
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
	event.content = 'Order created'
	event.tags = [
		// Required tags per spec
		['p', params.sellerPubkey], // Merchant's pubkey
		['subject', 'order-info'],
		['type', ORDER_MESSAGE_TYPE.ORDER_CREATION], // Type 1 for order creation
		['order', orderId],
		['amount', total],

		// Item details - the spec requires this format
		['item', params.productRef, params.quantity.toString()],
	]

	// Add optional tags
	const shippingRef = getPublicSellerShippingRef(params.shippingRef)
	if (shippingRef) {
		event.tags.push(['shipping', shippingRef])
	}

	// Sign and publish the event
	await event.sign(signer)
	await ndkActions.publishEvent(event)

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
	event.created_at = getNextOrderUpdateCreatedAt()
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
	await ndkActions.publishEvent(event)

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

			// Trigger a refetch to show updated status before the mutation fully settles.
			await queryClient.refetchQueries({ queryKey: orderKeys.details(params.orderEventId) })
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
	await ndkActions.publishEvent(event)

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
	return createOrderCreationEventWithOrderId(data, uuidv4())
}

async function createOrderCreationEventWithOrderId(data: OrderCreationData, orderId: string): Promise<NDKEvent> {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const now = Math.floor(Date.now() / 1000)
	const template = createBuyerOrderTemplate({
		merchantPubkey: data.merchantPubkey,
		orderId,
		amountSats: data.totalAmountSats,
		items: data.orderItems,
		shippingRef: getPublicSellerShippingRef(data.shippingRef),
		createdAt: now,
	})

	// Create the event
	const event = new NDKEvent(ndk)
	event.kind = template.kind as typeof ORDER_PROCESS_KIND
	event.created_at = template.created_at
	event.content = template.content
	event.tags = template.tags as NDKTag[]

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
	const template = createBuyerPaymentRequestTemplate({
		buyerPubkey: data.buyerPubkey,
		merchantPubkey: data.merchantPubkey,
		orderId: data.orderId,
		amountSats: data.amountSats,
		paymentMethods: data.paymentMethods,
		expirationTime: data.expirationTime,
		createdAt: now,
		content: data.notes,
	})

	// Create the event
	const event = new NDKEvent(ndk)
	event.kind = template.kind as typeof ORDER_PROCESS_KIND
	event.created_at = template.created_at
	event.content = template.content
	event.tags = template.tags as NDKTag[]

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

	const template = createOrderStatusUpdateTemplate({
		recipientPubkey: data.recipientPubkey,
		orderId: data.orderId,
		status: data.status,
		createdAt: Math.floor(Date.now() / 1000),
		content: data.notes,
	})

	// Create the event
	const event = new NDKEvent(ndk)
	event.kind = template.kind as typeof ORDER_PROCESS_KIND
	event.created_at = template.created_at
	event.content = template.content
	event.tags = template.tags as NDKTag[]

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

	const template = createOrderPaymentReceiptTemplate({
		merchantPubkey: data.merchantPubkey,
		orderId: data.orderId,
		amountSats: data.amountSats,
		medium: data.paymentProof.medium,
		reference: data.paymentProof.reference,
		proof: data.paymentProof.proof,
		createdAt: Math.floor(Date.now() / 1000),
		content: data.notes,
	})

	// Create the event
	const event = new NDKEvent(ndk)
	event.kind = template.kind as typeof PAYMENT_RECEIPT_KIND
	event.created_at = template.created_at
	event.content = template.content
	event.tags = template.tags as NDKTag[]

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

	const template = createGeneralOrderCommunicationTemplate({
		recipientPubkey,
		subject,
		content: message,
		createdAt: Math.floor(Date.now() / 1000),
	})

	// Create the event
	const event = new NDKEvent(ndk)
	event.kind = template.kind as typeof ORDER_GENERAL_KIND
	event.created_at = template.created_at
	event.content = template.content
	event.tags = template.tags as NDKTag[]

	// Sign the event
	await event.sign()

	return event
}

/**
 * Publishes an order-related event to the network
 */
export async function publishOrderEvent(event: NDKEvent): Promise<boolean> {
	try {
		await ndkActions.publishEvent(event)
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
}

type SellerOrderPreflight = {
	sellerPubkey: string
	sellerProducts: CartProduct[]
	data: SellerData
	requirements: CheckoutDeliveryRequirements
	shippingRef?: string
}

type PreparedSellerOrderData = SellerOrderPreflight & {
	orderData: OrderCreationData
	orderId: string
	privateGiftWrapEvent?: NDKEvent
}

type PreparedSellerOrderPublishWork = PreparedSellerOrderData & {
	orderEvent: NDKEvent
}

function trimOptional(value: string | undefined): string | undefined {
	const trimmed = value?.trim()
	return trimmed || undefined
}

function createPrivateOrderDeliveryDetails(params: {
	sellerPubkey: string
	buyerPubkey: string
	orderId: string
	sellerProducts: CartProduct[]
	data: SellerData
	shippingRef?: string
	shippingData: CheckoutFormData
	requirements: CheckoutDeliveryRequirements
}): PrivateOrderDeliveryDetails {
	const { sellerPubkey, buyerPubkey, orderId, sellerProducts, data, shippingRef, shippingData, requirements } = params
	const delivery: PrivateOrderDeliveryDetails['delivery'] = {}

	if (requirements.needsPhysicalAddress) {
		delivery.name = trimOptional(shippingData.name)
		delivery.address = {
			firstLineOfAddress: trimOptional(shippingData.firstLineOfAddress),
			additionalInformation: trimOptional(shippingData.additionalInformation),
			city: trimOptional(shippingData.city),
			zipPostcode: trimOptional(shippingData.zipPostcode),
			country: trimOptional(shippingData.country),
		}
	}

	const buyerEmail = trimOptional(shippingData.email)
	if (buyerEmail && isValidDigitalDeliveryContact(buyerEmail)) {
		delivery.email = buyerEmail
	}

	if (requirements.needsPhysicalAddress) {
		delivery.phone = trimOptional(shippingData.phone)
	}

	return {
		orderId,
		buyerPubkey,
		sellerPubkey,
		totalAmountSats: data.satsTotal,
		shippingRef,
		items: sellerProducts.map((product) => ({
			productRef: `30402:${sellerPubkey}:${product.id}`,
			quantity: product.amount,
		})),
		delivery,
		orderNotes: '',
	}
}

function createNdkEventFromRawEvent(event: Event): NDKEvent {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	return new NDKEvent(ndk, {
		id: event.id,
		pubkey: event.pubkey,
		created_at: event.created_at,
		kind: event.kind,
		tags: event.tags.map((tag) => [...tag]),
		content: event.content,
		sig: event.sig,
	})
}

function publishResultHasRelayDetails(result: unknown): boolean {
	return result instanceof Set || Array.isArray(result) || (typeof result === 'object' && result !== null && 'size' in result)
}

function publishResultHasRelaySuccess(result: unknown): boolean {
	if (result instanceof Set) return result.size > 0
	if (Array.isArray(result)) return result.length > 0
	if (typeof result === 'object' && result !== null && 'size' in result && typeof (result as { size?: unknown }).size === 'number') {
		return (result as { size: number }).size > 0
	}
	return true
}

async function publishRequiredPrivateGiftWrap(event: NDKEvent): Promise<void> {
	const result = await ndkActions.publishEvent(event)
	if (publishResultHasRelayDetails(result) && !publishResultHasRelaySuccess(result)) {
		throw new Error('Encrypted seller delivery could not be published')
	}
}

/**
 * Creates and publishes a spec-compliant order for each seller,
 * then creates and publishes all necessary payment requests (merchant + V4V).
 * This function orchestrates the entire order creation and payment setup process.
 *
 * @returns An array of the created spec-compliant order IDs.
 */
export async function publishOrderWorkflowWithDependencies(params: PublishOrderDependenciesParams): Promise<SellerOrderPublishOutcome> {
	const { shippingData, sellers, productsBySeller, sellerData, v4vShares } = params
	let phase: SellerOrderPublishPhase = 'delivery_preflight'
	let activeSellerPubkey: string | undefined
	let activeOrderId: string | undefined
	let orderIds: string[] = []
	let progress: SellerOrderPublishProgress[] = []
	let paymentRequestFailures = 0

	try {
		const ndk = ndkActions.getNDK()
		const currentUser = ndk?.activeUser
		const buyerPubkey = currentUser?.pubkey

		if (!buyerPubkey) {
			throw new Error('No active user found for order creation')
		}

		const buyerEmail = shippingData.email.trim()
		if (buyerEmail && !isValidDigitalDeliveryContact(buyerEmail)) {
			throw new Error('Enter a valid email address before creating the order')
		}

		const preflight: SellerOrderPreflight[] = []

		for (const sellerPubkey of sellers) {
			activeSellerPubkey = sellerPubkey
			const sellerProducts = productsBySeller[sellerPubkey] || []
			const data = sellerData[sellerPubkey]

			if (sellerProducts.length === 0 || !data) continue

			const requirements = await resolveDeliveryRequirementsForProducts(sellerProducts)
			preflight.push({
				sellerPubkey,
				sellerProducts,
				data,
				requirements,
				shippingRef: getPublicSellerShippingRef(sellerProducts.find((p) => p.shippingMethodId)?.shippingMethodId),
			})
		}

		const planInputs = preflight.map(({ sellerPubkey, sellerProducts, data, requirements, shippingRef }) => ({
			sellerPubkey,
			orderId: uuidv4(),
			amountSats: data.satsTotal,
			products: sellerProducts.map((product) => ({ productId: product.id, quantity: product.amount })),
			shippingRef,
			deliveryRequirements: requirements,
		}))
		const planning = planSellerOrders(planInputs)
		if (planning.status === 'unresolved_delivery') {
			activeSellerPubkey = planning.failedSellerPubkey
			activeOrderId = planning.failedOrderId
			phase = 'delivery_preflight'
			progress = planInputs.map((item) => ({
				sellerPubkey: item.sellerPubkey,
				orderId: item.orderId,
				completedPhases: [],
				publishedEventIds: [],
				paymentRequestFailures: 0,
			}))
			return createSellerOrderPublishFailure({
				orderIds,
				progress,
				failedSellerPubkey: planning.failedSellerPubkey,
				failedOrderId: planning.failedOrderId,
				failedPhase: phase,
				error: 'Delivery requirements could not be verified for one or more selected shipping options',
				cause: new Error('Delivery requirements could not be verified for one or more selected shipping options'),
				paymentRequestFailures,
				unresolvedShippingRefs: planning.unresolvedShippingRefs,
			})
		}
		const plans = planning.plans
		progress = plans.map((plan) => ({
			sellerPubkey: plan.sellerPubkey,
			orderId: plan.orderId,
			completedPhases: [],
			publishedEventIds: [],
			paymentRequestFailures: 0,
		}))

		for (const plan of plans) {
			if (plan.deliveryRequirements.needsDigitalDeliveryContact && !isValidDigitalDeliveryContact(buyerEmail)) {
				activeSellerPubkey = plan.sellerPubkey
				activeOrderId = plan.orderId
				throw new Error('Digital delivery contact is required before creating the order')
			}
			if (plan.deliveryRequirements.needsPhysicalAddress && !hasRequiredPhysicalAddress(shippingData)) {
				activeSellerPubkey = plan.sellerPubkey
				activeOrderId = plan.orderId
				throw new Error('Shipping address is required before creating the order')
			}
		}

		const signerRequired = plans.some(({ requiresPrivateDelivery }) => requiresPrivateDelivery)
		const signer = signerRequired ? ndkActions.getSigner() : undefined
		if (signerRequired && !signer) {
			throw new Error('Encrypted seller delivery could not be prepared')
		}
		const preparedOrderData: PreparedSellerOrderData[] = []

		for (let index = 0; index < preflight.length; index++) {
			const preflightItem = preflight[index]!
			const plan = plans[index]!
			const { sellerPubkey, sellerProducts, data, requirements, shippingRef } = preflightItem
			activeSellerPubkey = sellerPubkey
			activeOrderId = plan.orderId
			phase = 'event_preparation'
			const orderId = plan.orderId
			const orderData: OrderCreationData = {
				merchantPubkey: sellerPubkey,
				buyerPubkey,
				orderItems: plan.items.map((item) => ({ productRef: item.productRef, quantity: item.quantity })),
				totalAmountSats: plan.amountSats,
				shippingRef: plan.shippingRef,
			}

			let privateGiftWrapEvent: NDKEvent | undefined
			if (plan.requiresPrivateDelivery) {
				try {
					const privateDetails = createPrivateOrderDeliveryDetails({
						sellerPubkey,
						buyerPubkey,
						orderId,
						sellerProducts,
						data,
						shippingRef: shippingRef || undefined,
						shippingData,
						requirements,
					})
					const { giftWrap } = await createEncryptedPrivateOrderMessageWithSigner({
						details: privateDetails,
						signer,
					})
					privateGiftWrapEvent = createNdkEventFromRawEvent(giftWrap)
				} catch {
					throw new Error('Encrypted seller delivery could not be prepared')
				}
			}

			preparedOrderData.push({
				...preflightItem,
				orderData,
				orderId,
				privateGiftWrapEvent,
			})
		}

		const preparedOrders: PreparedSellerOrderPublishWork[] = []
		for (const preparedOrder of preparedOrderData) {
			activeSellerPubkey = preparedOrder.sellerPubkey
			activeOrderId = preparedOrder.orderId
			phase = 'event_preparation'
			const orderEvent = await createOrderCreationEventWithOrderId(preparedOrder.orderData, preparedOrder.orderId)
			preparedOrders.push({
				...preparedOrder,
				orderEvent,
			})
		}

		const workflow = await executeSellerOrderPublishWorkflow(
			preparedOrders.map((preparedOrder) => ({
				sellerPubkey: preparedOrder.sellerPubkey,
				orderId: preparedOrder.orderId,
				requiresPrivateDelivery: Boolean(preparedOrder.privateGiftWrapEvent),
				...(preparedOrder.privateGiftWrapEvent ? { privateDelivery: preparedOrder.privateGiftWrapEvent } : {}),
				orderMarker: preparedOrder.orderEvent,
			})),
			{
				publishPrivateDelivery: async (work) => {
					if (!work.privateDelivery) throw new Error('Encrypted seller delivery could not be prepared')
					try {
						await publishRequiredPrivateGiftWrap(work.privateDelivery)
						return { eventId: work.privateDelivery.id }
					} catch {
						throw new Error('Encrypted seller delivery could not be published')
					}
				},
				publishOrderMarker: async (work) => {
					// Publish the sanitized public marker only after required private details are published.
					const publishResult = await ndkActions.publishEvent(work.orderMarker)
					if (publishResultHasRelayDetails(publishResult) && !publishResultHasRelaySuccess(publishResult)) {
						throw new Error('Order could not be published')
					}
					console.log(`✅ Spec-compliant order created for seller ${work.sellerPubkey.substring(0, 8)}...:`, work.orderId)
					return { eventId: work.orderMarker.id }
				},
				publishPaymentRequests: async (work) => {
					const preparedOrder = preparedOrders.find((item) => item.sellerPubkey === work.sellerPubkey && item.orderId === work.orderId)
					if (!preparedOrder) throw new Error('Prepared seller order was not found')
					const { sellerPubkey, data, orderId } = preparedOrder
					const paymentRequests: PaymentRequestData[] = []
					const productSubtotal = data.satsTotal - data.shippingSats
					const v4vRecipients = v4vShares[sellerPubkey] || []

					const sellerProfile = await fetchProfileByIdentifier(sellerPubkey)
					const sellerLnAddress = sellerProfile?.profile?.lud16 || sellerProfile?.profile?.lud06
					if (!sellerLnAddress) {
						console.warn(`Seller ${sellerPubkey} has no lightning address. Creating payment request without payment method.`)
					}
					paymentRequests.push({
						buyerPubkey,
						merchantPubkey: sellerPubkey,
						orderId,
						amountSats: data.shares.sellerAmount,
						paymentMethods: sellerLnAddress ? [{ type: 'lightning', details: sellerLnAddress }] : [],
						notes: sellerLnAddress ? `Payment for order ${orderId}` : `Payment for order ${orderId} (seller payment details pending)`,
					})

					for (const recipient of v4vRecipients) {
						const recipientPercentage = recipient.percentage > 1 ? recipient.percentage / 100 : recipient.percentage
						const recipientAmount = Math.max(1, Math.floor(productSubtotal * recipientPercentage))
						if (recipientAmount <= 0) continue
						const recipientProfile = await fetchProfileByIdentifier(recipient.pubkey)
						const recipientLnAddress = recipientProfile?.profile?.lud16 || recipientProfile?.profile?.lud06
						if (!recipientLnAddress) {
							console.warn(`V4V recipient ${recipient.name} has no lightning address. Creating payment request without payment method.`)
						}
						paymentRequests.push({
							buyerPubkey,
							merchantPubkey: recipient.pubkey,
							orderId,
							amountSats: recipientAmount,
							paymentMethods: recipientLnAddress ? [{ type: 'lightning', details: recipientLnAddress }] : [],
							notes: recipientLnAddress
								? `V4V share for order ${orderId} (${(recipientPercentage * 100).toFixed(1)}%)`
								: `V4V share for order ${orderId} (${(recipientPercentage * 100).toFixed(1)}%) - payment details pending`,
						})
					}

					let completed = 0
					let failed = 0
					const eventIds: string[] = []
					for (const request of paymentRequests) {
						try {
							const paymentRequestEvent = await createPaymentRequestEvent(request)
							const publishResult = await ndkActions.publishEvent(paymentRequestEvent)
							if (publishResultHasRelayDetails(publishResult) && !publishResultHasRelaySuccess(publishResult)) {
								failed++
								continue
							}
							completed++
							eventIds.push(paymentRequestEvent.id)
						} catch (error) {
							failed++
							console.error(`Failed to create payment request for ${request.notes}:`, error)
						}
					}
					console.log(`✅ Created ${completed}/${paymentRequests.length} payment request events for order ${orderId}`)
					return { completed, failed, eventIds }
				},
			},
		)
		orderIds = workflow.orderIds
		progress = workflow.progress
		paymentRequestFailures = workflow.paymentRequestFailures
		return workflow
	} catch (error) {
		return createSellerOrderPublishFailure({
			orderIds,
			progress,
			failedSellerPubkey: activeSellerPubkey,
			failedOrderId: activeOrderId,
			failedPhase: phase,
			error: error instanceof Error ? error.message : 'Order workflow failed',
			cause: error,
			paymentRequestFailures,
		})
	}
}

/**
 * Backward-compatible result surface for existing callers. New integrations
 * should consume publishOrderWorkflowWithDependencies() to inspect partial
 * outcomes and confirmed per-seller progress.
 */
export async function publishOrderWithDependencies(params: PublishOrderDependenciesParams): Promise<string[]> {
	const outcome = await publishOrderWorkflowWithDependencies(params)
	if (outcome.status !== 'published') throw new Error(outcome.error)
	return outcome.orderIds
}
