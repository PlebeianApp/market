import { describe, expect, test } from 'bun:test'
import {
	createSellerOrderPublishFailure,
	executeSellerOrderPublishWorkflow,
	planSellerOrders,
	recordSellerOrderEventPublished,
} from './workflowContracts'
import { resolveCheckoutDeliveryRequirements } from '../checkout/deliveryRequirements'

const deliveryRequirements = (service: string) =>
	resolveCheckoutDeliveryRequirements({
		products: [{ id: 'product', shippingMethodId: `30406:seller:${service}` }],
		servicesByShippingRef: { [`30406:seller:${service}`]: service },
	})

describe('multi-seller order planning', () => {
	test('plans each seller independently in caller order with canonical product coordinates', () => {
		const result = planSellerOrders([
			{
				sellerPubkey: 'seller-a',
				orderId: 'order-a',
				amountSats: 1200,
				products: [{ productId: 'one:blue', quantity: 2 }],
				shippingRef: '30406:seller-a:standard',
				deliveryRequirements: deliveryRequirements('standard'),
			},
			{
				sellerPubkey: 'seller-b',
				orderId: 'order-b',
				amountSats: 400,
				products: [{ productId: 'two', quantity: 1 }],
				deliveryRequirements: deliveryRequirements('pickup'),
			},
		])

		expect(result.status).toBe('planned')
		if (result.status !== 'planned') throw new Error('Expected seller plans')
		expect(result.plans).toEqual([
			{
				sellerPubkey: 'seller-a',
				orderId: 'order-a',
				amountSats: 1200,
				items: [{ productRef: '30402:seller-a:one:blue', quantity: 2 }],
				shippingRef: '30406:seller-a:standard',
				deliveryRequirements: deliveryRequirements('standard'),
				requiresPrivateDelivery: true,
			},
			{
				sellerPubkey: 'seller-b',
				orderId: 'order-b',
				amountSats: 400,
				items: [{ productRef: '30402:seller-b:two', quantity: 1 }],
				deliveryRequirements: deliveryRequirements('pickup'),
				requiresPrivateDelivery: false,
			},
		])
	})

	test('fails planning with seller and unresolved shipping refs before any workflow adapters run', () => {
		const result = planSellerOrders([
			{
				sellerPubkey: 'seller-a',
				orderId: 'order-a',
				amountSats: 1200,
				products: [{ productId: 'item-a', quantity: 1 }],
				deliveryRequirements: deliveryRequirements('pickup'),
			},
			{
				sellerPubkey: 'seller-b',
				orderId: 'order-b',
				amountSats: 400,
				products: [{ productId: 'item-b', quantity: 1 }],
				deliveryRequirements: resolveCheckoutDeliveryRequirements({
					products: [{ id: 'item-b', shippingMethodId: '30406:seller-b:unknown' }],
					servicesByShippingRef: {},
				}),
			},
		])

		expect(result).toEqual({
			status: 'unresolved_delivery',
			failedSellerPubkey: 'seller-b',
			failedOrderId: 'order-b',
			unresolvedShippingRefs: ['30406:seller-b:unknown'],
		})
	})

	test('records per-seller publish progress and classifies partial failures without discarding published IDs', () => {
		const progress = [
			{ sellerPubkey: 'seller-a', orderId: 'order-a', completedPhases: [], publishedEventIds: [], paymentRequestFailures: 0 },
			{ sellerPubkey: 'seller-b', orderId: 'order-b', completedPhases: [], publishedEventIds: [], paymentRequestFailures: 0 },
		]
		const afterFirstOrder = recordSellerOrderEventPublished(progress, {
			sellerPubkey: 'seller-a',
			orderId: 'order-a',
			phase: 'order_marker',
			eventId: 'event-a',
		})
		const outcome = createSellerOrderPublishFailure({
			orderIds: ['order-a'],
			progress: afterFirstOrder,
			failedSellerPubkey: 'seller-b',
			failedOrderId: 'order-b',
			failedPhase: 'private_delivery',
			error: 'Private delivery could not be published',
			paymentRequestFailures: 0,
		})

		expect(outcome).toMatchObject({ status: 'partial', orderIds: ['order-a'], failedOrderId: 'order-b' })
		expect(outcome).toMatchObject({
			failure: {
				code: 'workflow_failed',
				workflow: 'seller_order_publish',
				phase: 'private_delivery',
			},
		})
		if (outcome.status === 'partial') expect(outcome.progress[0]?.publishedEventIds).toEqual(['event-a'])
	})

	test('executes private deliveries before markers then payment requests through injected ports', async () => {
		const sequence: string[] = []
		const work = [
			{
				sellerPubkey: 'seller-a',
				orderId: 'order-a',
				requiresPrivateDelivery: true,
				privateDelivery: 'private-a',
				orderMarker: 'marker-a',
			},
			{ sellerPubkey: 'seller-b', orderId: 'order-b', requiresPrivateDelivery: false, orderMarker: 'marker-b' },
		]
		const outcome = await executeSellerOrderPublishWorkflow(work, {
			publishPrivateDelivery: async (item) => {
				sequence.push(`private:${item.orderId}`)
				return { eventId: `private-event:${item.orderId}` }
			},
			publishOrderMarker: async (item) => {
				sequence.push(`marker:${item.orderId}`)
				return { eventId: `marker-event:${item.orderId}` }
			},
			publishPaymentRequests: async (item) => {
				sequence.push(`payment:${item.orderId}`)
				return { completed: 1, failed: item.orderId === 'order-b' ? 1 : 0 }
			},
		})

		expect(sequence).toEqual(['private:order-a', 'marker:order-a', 'payment:order-a', 'marker:order-b', 'payment:order-b'])
		expect(outcome).toMatchObject({ status: 'published', orderIds: ['order-a', 'order-b'], paymentRequestFailures: 1 })
	})

	test('returns partial outcome with published IDs when later marker publish fails', async () => {
		const outcome = await executeSellerOrderPublishWorkflow(
			[
				{ sellerPubkey: 'seller-a', orderId: 'order-a', requiresPrivateDelivery: false, orderMarker: 'marker-a' },
				{ sellerPubkey: 'seller-b', orderId: 'order-b', requiresPrivateDelivery: false, orderMarker: 'marker-b' },
			],
			{
				publishPrivateDelivery: async () => ({ eventId: 'unused' }),
				publishOrderMarker: async (item) => {
					if (item.orderId === 'order-b') throw new Error('relay unavailable')
					return { eventId: 'marker-event:order-a' }
				},
				publishPaymentRequests: async () => ({ completed: 0, failed: 0 }),
			},
		)

		expect(outcome).toMatchObject({
			status: 'partial',
			orderIds: ['order-a'],
			failedSellerPubkey: 'seller-b',
			failedOrderId: 'order-b',
			failedPhase: 'order_marker',
			error: 'relay unavailable',
		})
	})
})
