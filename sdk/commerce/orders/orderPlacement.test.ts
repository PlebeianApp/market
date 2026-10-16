import { describe, expect, test } from 'bun:test'
import { createCartIntent } from '../cart/cartIntent'
import { resolveBuyerOrderStatus } from './orderStatus'
import { ORDER_PLACEMENT_ASSUMPTIONS, placeBuyerOrdersFromCartIntent } from './orderPlacement'

const sellerA = 'a'.repeat(64)
const sellerB = 'b'.repeat(64)

const shipA = `30406:${sellerA}:standard`
const shipB = `30406:${sellerB}:pickup`

const resolvedServices = { [shipA]: 'standard', [shipB]: 'pickup' }

function twoSellerIntent() {
	return createCartIntent(
		[
			{ id: 'product-a', amount: 2, sellerPubkey: sellerA, shippingMethodId: shipA },
			{ id: 'product-b', amount: 1, sellerPubkey: sellerB, shippingMethodId: shipB },
		],
		15000,
	)
}

describe('cart intent to placed order', () => {
	test('places one order per seller through the module template, deriving a pending unpaid status', () => {
		const outcome = placeBuyerOrdersFromCartIntent({
			intent: twoSellerIntent(),
			sellerTerms: {
				[sellerA]: { orderId: 'order-a', amountSats: 1200 },
				[sellerB]: { orderId: 'order-b', amountSats: 400 },
			},
			servicesByShippingRef: resolvedServices,
			createdAt: 200,
		})

		expect(outcome.status).toBe('placed')
		if (outcome.status !== 'placed') throw new Error('expected placed orders')
		expect(outcome.orders).toHaveLength(2)

		const [first, second] = outcome.orders
		expect(first?.sellerPubkey).toBe(sellerA)
		expect(first?.orderId).toBe('order-a')
		expect(first?.amountSats).toBe(1200)
		expect(first?.order).toEqual({
			kind: 16,
			created_at: 200,
			content: 'Order created',
			tags: [
				['p', sellerA],
				['subject', 'order-info'],
				['type', '1'],
				['order', 'order-a'],
				['amount', '1200'],
				['item', `30402:${sellerA}:product-a`, '2'],
				['shipping', shipA],
			],
		})
		expect(second?.order.tags).toContainEqual(['item', `30402:${sellerB}:product-b`, '1'])

		// The status is DERIVED from the event's own tags, and it says pending — not paid.
		for (const placed of outcome.orders) {
			expect(placed.orderStatus).toBe(resolveBuyerOrderStatus(placed.order.tags))
			expect(placed.orderStatus).toBe('pending')
			expect(placed.shippingStatus).toBeNull()
			// A placed order raises no invoice and settles nothing.
			expect(placed.payment).toBe('not-requested')
			// No event tag implies settlement or even a payment request.
			expect(placed.order.tags.some((tag) => tag[0] === 'status')).toBe(false)
			expect(placed.order.tags.some((tag) => tag[0] === 'payment')).toBe(false)
		}
	})

	test('refuses a cart whose lines carry no resolved shipping, naming the checkout gap refs', () => {
		const outcome = placeBuyerOrdersFromCartIntent({
			intent: twoSellerIntent(),
			sellerTerms: {
				[sellerA]: { orderId: 'order-a', amountSats: 1200 },
				[sellerB]: { orderId: 'order-b', amountSats: 400 },
			},
			// Empty on purpose: no shipping record read ⇒ every chosen ref is unresolved.
			servicesByShippingRef: {},
			createdAt: 200,
		})

		expect(outcome.status).toBe('refused')
		if (outcome.status !== 'refused' || outcome.reason !== 'unresolved_delivery') {
			throw new Error(`expected an unresolved_delivery refusal, got ${JSON.stringify(outcome)}`)
		}
		expect(outcome.unresolvedShippingRefs).toEqual([shipA])
	})

	test('refuses an empty cart by name', () => {
		const outcome = placeBuyerOrdersFromCartIntent({
			intent: createCartIntent([], 15000),
			sellerTerms: {},
			createdAt: 200,
		})
		expect(outcome).toEqual({ status: 'refused', reason: 'empty_cart' })
	})

	test('refuses a cart with a seller the host did not price, naming the seller', () => {
		const outcome = placeBuyerOrdersFromCartIntent({
			intent: twoSellerIntent(),
			sellerTerms: { [sellerA]: { orderId: 'order-a', amountSats: 1200 } },
			servicesByShippingRef: resolvedServices,
			createdAt: 200,
		})
		expect(outcome).toEqual({ status: 'refused', reason: 'unresolved-sats-price', sellerPubkeys: [sellerB] })
	})

	test('every placement assumption names what would falsify it', () => {
		expect(ORDER_PLACEMENT_ASSUMPTIONS.length).toBeGreaterThan(0)
		for (const entry of ORDER_PLACEMENT_ASSUMPTIONS) {
			expect(entry.assumption.length).toBeGreaterThan(0)
			expect(entry.falsifiedBy.length).toBeGreaterThan(0)
		}
	})
})
