import { describe, expect, test } from 'bun:test'
import { getEventHash } from 'nostr-tools'
import {
	ORDER_GENERAL_KIND,
	ORDER_MESSAGE_TYPE,
	ORDER_PROCESS_KIND,
	ORDER_STATUS,
	PAYMENT_RECEIPT_KIND,
	SHIPPING_STATUS,
} from '../schemas/order'
import {
	assertOrderMessageRumor,
	createOrderChatRumor,
	createOrderCreationRumor,
	createPaymentReceiptRumor,
	createPaymentRequestRumor,
	createShippingUpdateRumor,
	createStatusUpdateRumor,
	type OrderMessageRumor,
} from '../orders/orderMessageRumor'

const CREATED_AT = 1_700_000_000
const BUYER_PUBKEY = 'a'.repeat(64)
const SELLER_PUBKEY = 'b'.repeat(64)
const PRODUCT_REF = `30402:${SELLER_PUBKEY}:product-1`
const SHIPPING_REF = `30406:${SELLER_PUBKEY}:standard`

function canonicalRumorId(rumor: OrderMessageRumor): string {
	return getEventHash({
		pubkey: rumor.pubkey,
		created_at: rumor.created_at,
		kind: rumor.kind,
		tags: rumor.tags,
		content: rumor.content,
	})
}

function tagValue(tags: string[][], name: string): string | undefined {
	return tags.find((tag) => tag[0] === name)?.[1]
}

function tagValues(tags: string[][], name: string): string[][] {
	return tags.filter((tag) => tag[0] === name)
}

function expectUnsignedCanonicalRumor(rumor: OrderMessageRumor): void {
	expect(rumor.id).toBe(canonicalRumorId(rumor))
	expect('sig' in rumor).toBe(false)
}

describe('order message rumors', () => {
	test('creates a Gamma-shaped kind 16 order creation rumor', () => {
		const rumor = createOrderCreationRumor({
			buyerPubkey: BUYER_PUBKEY,
			merchantPubkey: SELLER_PUBKEY,
			orderId: 'order-123',
			amountSats: 2100,
			items: [{ productRef: PRODUCT_REF, quantity: 2 }],
			shippingRef: SHIPPING_REF,
			content: 'Order created',
			createdAt: CREATED_AT,
		})

		expect(rumor.kind).toBe(ORDER_PROCESS_KIND)
		expect(rumor.pubkey).toBe(BUYER_PUBKEY)
		expect(rumor.created_at).toBe(CREATED_AT)
		expect(rumor.content).toBe('Order created')
		expect(tagValue(rumor.tags, 'p')).toBe(SELLER_PUBKEY)
		expect(tagValue(rumor.tags, 'subject')).toBe('order-info')
		expect(tagValue(rumor.tags, 'type')).toBe(ORDER_MESSAGE_TYPE.ORDER_CREATION)
		expect(tagValue(rumor.tags, 'order')).toBe('order-123')
		expect(tagValue(rumor.tags, 'amount')).toBe('2100')
		expect(tagValue(rumor.tags, 'shipping')).toBe(SHIPPING_REF)
		expect(tagValues(rumor.tags, 'item')).toEqual([['item', PRODUCT_REF, '2']])
		expectUnsignedCanonicalRumor(rumor)
		expect(() => assertOrderMessageRumor(rumor)).not.toThrow()
	})

	test('creates Gamma-shaped payment request, status update, shipping update, receipt, and chat rumors', () => {
		const paymentRequest = createPaymentRequestRumor({
			merchantPubkey: SELLER_PUBKEY,
			buyerPubkey: BUYER_PUBKEY,
			orderId: 'order-123',
			amountSats: 2100,
			paymentMethods: [{ type: 'lightning', details: 'lnbc-secret-invoice' }],
			expirationTime: CREATED_AT + 3600,
			content: 'Payment request for your order',
			createdAt: CREATED_AT,
		})

		expect(paymentRequest.kind).toBe(ORDER_PROCESS_KIND)
		expect(paymentRequest.pubkey).toBe(SELLER_PUBKEY)
		expect(tagValue(paymentRequest.tags, 'p')).toBe(BUYER_PUBKEY)
		expect(tagValue(paymentRequest.tags, 'subject')).toBe('order-payment')
		expect(tagValue(paymentRequest.tags, 'type')).toBe(ORDER_MESSAGE_TYPE.PAYMENT_REQUEST)
		expect(tagValue(paymentRequest.tags, 'order')).toBe('order-123')
		expect(tagValue(paymentRequest.tags, 'amount')).toBe('2100')
		expect(tagValues(paymentRequest.tags, 'payment')).toEqual([['payment', 'lightning', 'lnbc-secret-invoice']])
		expect(tagValue(paymentRequest.tags, 'expiration')).toBe(String(CREATED_AT + 3600))
		expect(tagValue(paymentRequest.tags, 'recipient')).toBeUndefined()
		expectUnsignedCanonicalRumor(paymentRequest)
		expect(() => assertOrderMessageRumor(paymentRequest)).not.toThrow()

		const statusUpdate = createStatusUpdateRumor({
			senderPubkey: SELLER_PUBKEY,
			recipientPubkey: BUYER_PUBKEY,
			orderId: 'order-123',
			status: ORDER_STATUS.CONFIRMED,
			content: 'Order status updated to confirmed',
			createdAt: CREATED_AT,
		})

		expect(statusUpdate.kind).toBe(ORDER_PROCESS_KIND)
		expect(statusUpdate.pubkey).toBe(SELLER_PUBKEY)
		expect(tagValue(statusUpdate.tags, 'p')).toBe(BUYER_PUBKEY)
		expect(tagValue(statusUpdate.tags, 'subject')).toBe('order-info')
		expect(tagValue(statusUpdate.tags, 'type')).toBe(ORDER_MESSAGE_TYPE.STATUS_UPDATE)
		expect(tagValue(statusUpdate.tags, 'order')).toBe('order-123')
		expect(tagValue(statusUpdate.tags, 'status')).toBe(ORDER_STATUS.CONFIRMED)
		expectUnsignedCanonicalRumor(statusUpdate)
		expect(() => assertOrderMessageRumor(statusUpdate)).not.toThrow()

		const shippingUpdate = createShippingUpdateRumor({
			senderPubkey: SELLER_PUBKEY,
			recipientPubkey: BUYER_PUBKEY,
			orderId: 'order-123',
			status: SHIPPING_STATUS.SHIPPED,
			tracking: 'tracking-123',
			carrier: 'UPS',
			eta: '2026-07-01',
			content: 'Order shipped',
			createdAt: CREATED_AT,
		})

		expect(shippingUpdate.kind).toBe(ORDER_PROCESS_KIND)
		expect(shippingUpdate.pubkey).toBe(SELLER_PUBKEY)
		expect(tagValue(shippingUpdate.tags, 'p')).toBe(BUYER_PUBKEY)
		expect(tagValue(shippingUpdate.tags, 'subject')).toBe('shipping-info')
		expect(tagValue(shippingUpdate.tags, 'type')).toBe(ORDER_MESSAGE_TYPE.SHIPPING_UPDATE)
		expect(tagValue(shippingUpdate.tags, 'order')).toBe('order-123')
		expect(tagValue(shippingUpdate.tags, 'status')).toBe(SHIPPING_STATUS.SHIPPED)
		expect(tagValue(shippingUpdate.tags, 'tracking')).toBe('tracking-123')
		expect(tagValue(shippingUpdate.tags, 'carrier')).toBe('UPS')
		expect(tagValue(shippingUpdate.tags, 'eta')).toBe('2026-07-01')
		expectUnsignedCanonicalRumor(shippingUpdate)
		expect(() => assertOrderMessageRumor(shippingUpdate)).not.toThrow()

		const receipt = createPaymentReceiptRumor({
			buyerPubkey: BUYER_PUBKEY,
			merchantPubkey: SELLER_PUBKEY,
			orderId: 'order-123',
			payment: {
				medium: 'lightning',
				reference: 'lnbc-secret-invoice',
				proof: 'preimage-secret',
			},
			amountSats: 2100,
			content: 'Payment confirmation',
			createdAt: CREATED_AT,
		})

		expect(receipt.kind).toBe(PAYMENT_RECEIPT_KIND)
		expect(receipt.pubkey).toBe(BUYER_PUBKEY)
		expect(tagValue(receipt.tags, 'p')).toBe(SELLER_PUBKEY)
		expect(tagValue(receipt.tags, 'subject')).toBe('order-receipt')
		expect(tagValue(receipt.tags, 'order')).toBe('order-123')
		expect(tagValues(receipt.tags, 'payment')).toEqual([['payment', 'lightning', 'lnbc-secret-invoice', 'preimage-secret']])
		expect(tagValue(receipt.tags, 'amount')).toBe('2100')
		expectUnsignedCanonicalRumor(receipt)
		expect(() => assertOrderMessageRumor(receipt)).not.toThrow()

		const chat = createOrderChatRumor({
			senderPubkey: BUYER_PUBKEY,
			recipientPubkey: SELLER_PUBKEY,
			subject: 'order-123',
			content: 'Question about my order',
			createdAt: CREATED_AT,
		})

		expect(chat.kind).toBe(ORDER_GENERAL_KIND)
		expect(chat.pubkey).toBe(BUYER_PUBKEY)
		expect(tagValue(chat.tags, 'p')).toBe(SELLER_PUBKEY)
		expect(tagValue(chat.tags, 'subject')).toBe('order-123')
		expect(chat.content).toBe('Question about my order')
		expectUnsignedCanonicalRumor(chat)
		expect(() => assertOrderMessageRumor(chat)).not.toThrow()
	})

	test('rejects invalid order message rumors', () => {
		const valid = createOrderCreationRumor({
			buyerPubkey: BUYER_PUBKEY,
			merchantPubkey: SELLER_PUBKEY,
			orderId: 'order-123',
			amountSats: 2100,
			items: [{ productRef: PRODUCT_REF, quantity: 2 }],
			content: 'Order created',
			createdAt: CREATED_AT,
		})

		const missingRecipient = {
			...valid,
			tags: valid.tags.filter((tag) => tag[0] !== 'p'),
		}

		expect(() => assertOrderMessageRumor(missingRecipient)).toThrow('Invalid order message rumor')
	})
})
