import { getEventHash } from 'nostr-tools'
import {
	GeneralCommunicationSchema,
	ORDER_GENERAL_KIND,
	ORDER_MESSAGE_TYPE,
	ORDER_PROCESS_KIND,
	ORDER_STATUS,
	OrderCreationSchema,
	PAYMENT_RECEIPT_KIND,
	PaymentReceiptSchema,
	PaymentRequestSchema,
	SHIPPING_STATUS,
	ShippingUpdateSchema,
	StatusUpdateSchema,
} from '../schemas/order'

type PaymentMedium = 'lightning' | 'bitcoin' | 'fiat' | 'other'

export type OrderMessageRumor = {
	id: string
	pubkey: string
	created_at: number
	kind: number
	tags: string[][]
	content: string
}

export type OrderItemInput = {
	productRef: string
	quantity: number
}

export type PaymentMethodInput = {
	type: PaymentMedium
	details: string
	proof?: string
}

export type PaymentReceiptInput = {
	medium: PaymentMedium
	reference: string
	proof: string
}

export type CreateOrderCreationRumorParams = {
	buyerPubkey: string
	merchantPubkey: string
	orderId: string
	amountSats: number
	items: OrderItemInput[]
	shippingRef?: string
	content?: string
	createdAt?: number
}

export type CreatePaymentRequestRumorParams = {
	merchantPubkey: string
	buyerPubkey: string
	orderId: string
	amountSats: number
	paymentMethods: PaymentMethodInput[]
	expirationTime?: number
	content?: string
	createdAt?: number
}

export type CreateStatusUpdateRumorParams = {
	senderPubkey: string
	recipientPubkey: string
	orderId: string
	status: (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS]
	content?: string
	createdAt?: number
}

export type CreateShippingUpdateRumorParams = {
	senderPubkey: string
	recipientPubkey: string
	orderId: string
	status: (typeof SHIPPING_STATUS)[keyof typeof SHIPPING_STATUS]
	tracking?: string
	carrier?: string
	eta?: string
	content?: string
	createdAt?: number
}

export type CreatePaymentReceiptRumorParams = {
	buyerPubkey: string
	merchantPubkey: string
	orderId: string
	payment: PaymentReceiptInput
	amountSats: number
	content?: string
	createdAt?: number
}

export type CreateOrderChatRumorParams = {
	senderPubkey: string
	recipientPubkey: string
	subject?: string
	content: string
	createdAt?: number
}

export function createOrderCreationRumor(params: CreateOrderCreationRumorParams): OrderMessageRumor {
	const tags: string[][] = [
		['p', params.merchantPubkey],
		['subject', 'order-info'],
		['type', ORDER_MESSAGE_TYPE.ORDER_CREATION],
		['order', params.orderId],
		['amount', params.amountSats.toString()],
	]

	for (const item of params.items) {
		tags.push(['item', item.productRef, item.quantity.toString()])
	}

	if (params.shippingRef) {
		tags.push(['shipping', params.shippingRef])
	}

	return createCanonicalRumor({
		kind: ORDER_PROCESS_KIND,
		pubkey: params.buyerPubkey,
		created_at: params.createdAt ?? unixNow(),
		content: params.content ?? 'Order created',
		tags,
	})
}

export function createPaymentRequestRumor(params: CreatePaymentRequestRumorParams): OrderMessageRumor {
	const tags: string[][] = [
		['p', params.buyerPubkey],
		['subject', 'order-payment'],
		['type', ORDER_MESSAGE_TYPE.PAYMENT_REQUEST],
		['order', params.orderId],
		['amount', params.amountSats.toString()],
	]

	for (const method of params.paymentMethods) {
		const tag = ['payment', method.type, method.details]
		if (method.proof !== undefined) tag.push(method.proof)
		tags.push(tag)
	}

	if (params.expirationTime !== undefined) {
		tags.push(['expiration', params.expirationTime.toString()])
	}

	return createCanonicalRumor({
		kind: ORDER_PROCESS_KIND,
		pubkey: params.merchantPubkey,
		created_at: params.createdAt ?? unixNow(),
		content: params.content ?? 'Payment request for your order',
		tags,
	})
}

export function createStatusUpdateRumor(params: CreateStatusUpdateRumorParams): OrderMessageRumor {
	return createCanonicalRumor({
		kind: ORDER_PROCESS_KIND,
		pubkey: params.senderPubkey,
		created_at: params.createdAt ?? unixNow(),
		content: params.content ?? `Order status updated to ${params.status}`,
		tags: [
			['p', params.recipientPubkey],
			['subject', 'order-info'],
			['type', ORDER_MESSAGE_TYPE.STATUS_UPDATE],
			['order', params.orderId],
			['status', params.status],
		],
	})
}

export function createShippingUpdateRumor(params: CreateShippingUpdateRumorParams): OrderMessageRumor {
	const tags: string[][] = [
		['p', params.recipientPubkey],
		['subject', 'shipping-info'],
		['type', ORDER_MESSAGE_TYPE.SHIPPING_UPDATE],
		['order', params.orderId],
		['status', params.status],
	]

	if (params.tracking) tags.push(['tracking', params.tracking])
	if (params.carrier) tags.push(['carrier', params.carrier])
	if (params.eta) tags.push(['eta', params.eta])

	return createCanonicalRumor({
		kind: ORDER_PROCESS_KIND,
		pubkey: params.senderPubkey,
		created_at: params.createdAt ?? unixNow(),
		content: params.content ?? 'Shipping update',
		tags,
	})
}

export function createPaymentReceiptRumor(params: CreatePaymentReceiptRumorParams): OrderMessageRumor {
	return createCanonicalRumor({
		kind: PAYMENT_RECEIPT_KIND,
		pubkey: params.buyerPubkey,
		created_at: params.createdAt ?? unixNow(),
		content: params.content ?? 'Payment confirmation',
		tags: [
			['p', params.merchantPubkey],
			['subject', 'order-receipt'],
			['order', params.orderId],
			['payment', params.payment.medium, params.payment.reference, params.payment.proof],
			['amount', params.amountSats.toString()],
		],
	})
}

export function createOrderChatRumor(params: CreateOrderChatRumorParams): OrderMessageRumor {
	const tags: string[][] = [['p', params.recipientPubkey]]

	if (params.subject) {
		tags.push(['subject', params.subject])
	}

	return createCanonicalRumor({
		kind: ORDER_GENERAL_KIND,
		pubkey: params.senderPubkey,
		created_at: params.createdAt ?? unixNow(),
		content: params.content,
		tags,
	})
}

export function assertOrderMessageRumor(value: unknown): asserts value is OrderMessageRumor {
	try {
		if (!isRecord(value)) throw new Error('not an object')
		if (typeof value.id !== 'string') throw new Error('missing id')
		if (typeof value.pubkey !== 'string') throw new Error('missing pubkey')
		if (typeof value.created_at !== 'number') throw new Error('missing created_at')
		if (typeof value.kind !== 'number') throw new Error('missing kind')
		if (typeof value.content !== 'string') throw new Error('missing content')
		if (!Array.isArray(value.tags)) throw new Error('missing tags')
		if ('sig' in value) throw new Error('rumor must be unsigned')

		const schemaInput = {
			kind: value.kind,
			created_at: value.created_at,
			content: value.content,
			tags: value.tags,
		}

		if (value.kind === ORDER_GENERAL_KIND) {
			GeneralCommunicationSchema.parse(schemaInput)
		} else if (value.kind === ORDER_PROCESS_KIND) {
			const messageType = value.tags.find((tag) => tag[0] === 'type')?.[1]
			if (messageType === ORDER_MESSAGE_TYPE.ORDER_CREATION) {
				OrderCreationSchema.parse(schemaInput)
			} else if (messageType === ORDER_MESSAGE_TYPE.PAYMENT_REQUEST) {
				PaymentRequestSchema.parse(schemaInput)
			} else if (messageType === ORDER_MESSAGE_TYPE.STATUS_UPDATE) {
				StatusUpdateSchema.parse(schemaInput)
			} else if (messageType === ORDER_MESSAGE_TYPE.SHIPPING_UPDATE) {
				ShippingUpdateSchema.parse(schemaInput)
			} else {
				throw new Error('unknown order process message type')
			}
		} else if (value.kind === PAYMENT_RECEIPT_KIND) {
			PaymentReceiptSchema.parse(schemaInput)
		} else {
			throw new Error('unsupported order message kind')
		}

		if (value.id !== canonicalRumorId(value as OrderMessageRumor)) {
			throw new Error('non-canonical rumor id')
		}
	} catch {
		throw new Error('Invalid order message rumor')
	}
}

function createCanonicalRumor(rumor: Omit<OrderMessageRumor, 'id'>): OrderMessageRumor {
	const withId = {
		...rumor,
		id: canonicalRumorId(rumor),
	}

	assertOrderMessageRumor(withId)
	return withId
}

function canonicalRumorId(rumor: Omit<OrderMessageRumor, 'id'>): string {
	return getEventHash({
		pubkey: rumor.pubkey,
		created_at: rumor.created_at,
		kind: rumor.kind,
		tags: rumor.tags,
		content: rumor.content,
	})
}

function unixNow(): number {
	return Math.floor(Date.now() / 1000)
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}
