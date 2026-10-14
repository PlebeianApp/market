import type { OrderWorkflowStatus, ShippingWorkflowStatus } from './orderEvents'
import type { CheckoutDeliveryRequirements } from '../checkout/deliveryRequirements'
import { createWorkflowError, type WorkflowError } from '../../core/errors'

export interface SellerOrderPlanInput {
	sellerPubkey: string
	orderId: string
	amountSats: number
	products: Array<{ productId: string; quantity: number }>
	shippingRef?: string
	deliveryRequirements: CheckoutDeliveryRequirements
}

export interface SellerOrderPlan {
	sellerPubkey: string
	orderId: string
	amountSats: number
	items: Array<{ productRef: string; quantity: number }>
	shippingRef?: string
	deliveryRequirements: CheckoutDeliveryRequirements
	requiresPrivateDelivery: boolean
}

export type SellerOrderPlanningOutcome =
	| { status: 'planned'; plans: SellerOrderPlan[] }
	| {
			status: 'unresolved_delivery'
			failedSellerPubkey: string
			failedOrderId: string
			unresolvedShippingRefs: string[]
	  }

/**
 * Purely plan one order per seller from already-read cart, seller, and shipping
 * data. No relay reads, encryption, signing, payment calls, or publishing occur
 * here. Unresolved delivery information fails the whole plan before side effects.
 */
export function planSellerOrders(inputs: readonly SellerOrderPlanInput[]): SellerOrderPlanningOutcome {
	const unresolved = inputs.find((input) => !input.deliveryRequirements.isResolved)
	if (unresolved) {
		return {
			status: 'unresolved_delivery',
			failedSellerPubkey: unresolved.sellerPubkey,
			failedOrderId: unresolved.orderId,
			unresolvedShippingRefs: [...unresolved.deliveryRequirements.unresolvedShippingRefs],
		}
	}

	return {
		status: 'planned',
		plans: inputs.map((input) => ({
			sellerPubkey: input.sellerPubkey,
			orderId: input.orderId,
			amountSats: input.amountSats,
			items: input.products.map((product) => ({
				productRef: `30402:${input.sellerPubkey}:${product.productId}`,
				quantity: product.quantity,
			})),
			...(input.shippingRef ? { shippingRef: input.shippingRef } : {}),
			deliveryRequirements: input.deliveryRequirements,
			requiresPrivateDelivery: input.deliveryRequirements.needsPhysicalAddress || input.deliveryRequirements.needsDigitalDeliveryContact,
		})),
	}
}

/** Side-effect phases in the current non-atomic, multi-seller order publisher. */
export type SellerOrderPublishPhase = 'delivery_preflight' | 'event_preparation' | 'private_delivery' | 'order_marker' | 'payment_request'

export interface SellerOrderPublishProgress {
	sellerPubkey: string
	orderId: string
	completedPhases: SellerOrderPublishPhase[]
	publishedEventIds: string[]
	paymentRequestFailures: number
}

export interface PreparedSellerOrderWork<PrivateDelivery, OrderMarker> {
	sellerPubkey: string
	orderId: string
	requiresPrivateDelivery: boolean
	privateDelivery?: PrivateDelivery
	orderMarker: OrderMarker
}

export interface SellerOrderPublishPorts<PrivateDelivery, OrderMarker> {
	publishPrivateDelivery(work: PreparedSellerOrderWork<PrivateDelivery, OrderMarker>): Promise<{ eventId: string }>
	publishOrderMarker(work: PreparedSellerOrderWork<PrivateDelivery, OrderMarker>): Promise<{ eventId: string }>
	publishPaymentRequests(
		work: PreparedSellerOrderWork<PrivateDelivery, OrderMarker>,
	): Promise<{ completed: number; failed: number; eventIds?: string[] }>
}

/**
 * Each seller order is published independently. A later failure does not undo
 * earlier relay writes; callers must retain IDs already confirmed published.
 */
export type SellerOrderPublishOutcome =
	| { status: 'published'; orderIds: string[]; progress: SellerOrderPublishProgress[]; paymentRequestFailures: number }
	| {
			status: 'partial'
			orderIds: string[]
			progress: SellerOrderPublishProgress[]
			failedSellerPubkey?: string
			failedOrderId?: string
			failedPhase: SellerOrderPublishPhase
			error: string
			failure: WorkflowError
			paymentRequestFailures: number
			unresolvedShippingRefs?: string[]
	  }
	| {
			status: 'failed'
			orderIds: string[]
			progress: SellerOrderPublishProgress[]
			failedSellerPubkey?: string
			failedOrderId?: string
			failedPhase: SellerOrderPublishPhase
			error: string
			failure: WorkflowError
			paymentRequestFailures: number
			unresolvedShippingRefs?: string[]
	  }

/** Record an acknowledged publish without changing other sellers' progress. */
export function recordSellerOrderEventPublished(
	progress: readonly SellerOrderPublishProgress[],
	input: { sellerPubkey: string; orderId: string; phase: SellerOrderPublishPhase; eventId: string },
): SellerOrderPublishProgress[] {
	return progress.map((seller) => {
		if (seller.sellerPubkey !== input.sellerPubkey || seller.orderId !== input.orderId) return seller
		return {
			...seller,
			completedPhases: seller.completedPhases.includes(input.phase) ? seller.completedPhases : [...seller.completedPhases, input.phase],
			publishedEventIds:
				input.eventId && !seller.publishedEventIds.includes(input.eventId)
					? [...seller.publishedEventIds, input.eventId]
					: seller.publishedEventIds,
		}
	})
}

/** Classify failure as partial after any confirmed relay publication, including a private delivery wrap. */
export function createSellerOrderPublishFailure(input: {
	orderIds: string[]
	progress: SellerOrderPublishProgress[]
	failedSellerPubkey?: string
	failedOrderId?: string
	failedPhase: SellerOrderPublishPhase
	error: string
	cause?: unknown
	paymentRequestFailures: number
	unresolvedShippingRefs?: string[]
}): SellerOrderPublishOutcome {
	const hasPublishedEvents = input.progress.some((seller) => seller.publishedEventIds.length > 0)
	const status = input.orderIds.length > 0 || hasPublishedEvents ? 'partial' : 'failed'
	return {
		status,
		orderIds: input.orderIds,
		progress: input.progress,
		failedSellerPubkey: input.failedSellerPubkey,
		failedOrderId: input.failedOrderId,
		failedPhase: input.failedPhase,
		error: input.error,
		failure: createWorkflowError({
			workflow: 'seller_order_publish',
			phase: input.failedPhase,
			status: 'failed',
			error: input.cause ?? input.error,
		}),
		paymentRequestFailures: input.paymentRequestFailures,
		...('unresolvedShippingRefs' in input ? { unresolvedShippingRefs: input.unresolvedShippingRefs } : {}),
	}
}

/**
 * Execute the existing legacy multi-seller ordering: private delivery wraps for
 * all sellers first, then each public order marker and its payment requests.
 * Side effects are injected; the SDK never signs, stores keys, or selects a
 * transport. Payment request failures remain reported-but-nonfatal, matching
 * current app behavior.
 */
export async function executeSellerOrderPublishWorkflow<PrivateDelivery, OrderMarker>(
	work: readonly PreparedSellerOrderWork<PrivateDelivery, OrderMarker>[],
	ports: SellerOrderPublishPorts<PrivateDelivery, OrderMarker>,
): Promise<SellerOrderPublishOutcome> {
	let progress: SellerOrderPublishProgress[] = work.map((seller) => ({
		sellerPubkey: seller.sellerPubkey,
		orderId: seller.orderId,
		completedPhases: [],
		publishedEventIds: [],
		paymentRequestFailures: 0,
	}))
	const orderIds: string[] = []
	let paymentRequestFailures = 0
	let active: PreparedSellerOrderWork<PrivateDelivery, OrderMarker> | undefined
	let phase: SellerOrderPublishPhase = 'event_preparation'

	const failed = (error: unknown): SellerOrderPublishOutcome =>
		createSellerOrderPublishFailure({
			orderIds,
			progress,
			failedSellerPubkey: active?.sellerPubkey,
			failedOrderId: active?.orderId,
			failedPhase: phase,
			error: error instanceof Error ? error.message : 'Order workflow failed',
			cause: error,
			paymentRequestFailures,
		})

	for (const seller of work) {
		active = seller
		if (!seller.requiresPrivateDelivery) continue
		phase = 'private_delivery'
		if (!seller.privateDelivery) return failed(new Error('Required private seller delivery was not prepared'))
		try {
			const result = await ports.publishPrivateDelivery(seller)
			progress = recordSellerOrderEventPublished(progress, {
				sellerPubkey: seller.sellerPubkey,
				orderId: seller.orderId,
				phase,
				eventId: result.eventId,
			})
		} catch (error) {
			return failed(error)
		}
	}

	for (const seller of work) {
		active = seller
		phase = 'order_marker'
		try {
			const result = await ports.publishOrderMarker(seller)
			orderIds.push(seller.orderId)
			progress = recordSellerOrderEventPublished(progress, {
				sellerPubkey: seller.sellerPubkey,
				orderId: seller.orderId,
				phase,
				eventId: result.eventId,
			})
		} catch (error) {
			return failed(error)
		}

		phase = 'payment_request'
		try {
			const result = await ports.publishPaymentRequests(seller)
			paymentRequestFailures += result.failed
			for (const eventId of result.eventIds ?? []) {
				progress = recordSellerOrderEventPublished(progress, {
					sellerPubkey: seller.sellerPubkey,
					orderId: seller.orderId,
					phase,
					eventId,
				})
			}
			if (result.completed > 0) {
				progress = progress.map((entry) =>
					entry.sellerPubkey === seller.sellerPubkey && entry.orderId === seller.orderId
						? {
								...entry,
								completedPhases: entry.completedPhases.includes(phase) ? entry.completedPhases : [...entry.completedPhases, phase],
							}
						: entry,
				)
			}
			progress = progress.map((entry) =>
				entry.sellerPubkey === seller.sellerPubkey && entry.orderId === seller.orderId
					? { ...entry, paymentRequestFailures: entry.paymentRequestFailures + result.failed }
					: entry,
			)
		} catch {
			paymentRequestFailures++
			progress = progress.map((entry) =>
				entry.sellerPubkey === seller.sellerPubkey && entry.orderId === seller.orderId
					? { ...entry, paymentRequestFailures: entry.paymentRequestFailures + 1 }
					: entry,
			)
		}
	}

	return { status: 'published', orderIds, progress, paymentRequestFailures }
}

/**
 * Workflow facts are orthogonal. Receipt publication is not settlement,
 * settlement is not merchant confirmation, and fulfillment is a later fact.
 */
export interface OrderWorkflowSnapshot {
	orderStatus: OrderWorkflowStatus
	shippingStatus: ShippingWorkflowStatus | null
	payment: {
		requested: boolean
		attempted: boolean
		walletAcknowledged: boolean
		settledOrProven: boolean
		receiptPublished: boolean
		merchantConfirmed: boolean
		failed: boolean
		expired: boolean
		refunded: boolean
	}
	fulfilled: boolean
}

/** Host adapters own these operations; SDK contracts do not own keys or transports. */
export interface OrderWorkflowCapabilities<PrivateDelivery, SignedEvent> {
	preparePrivateDelivery(details: PrivateDelivery): Promise<SignedEvent>
	publishPrivateDelivery(event: SignedEvent): Promise<{ eventId: string }>
	publishOrderMarker(event: SignedEvent): Promise<{ eventId: string }>
	publishPaymentRequest(event: SignedEvent): Promise<{ eventId: string }>
}
