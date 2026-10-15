import type { EventTemplate } from 'nostr-tools/pure'
import { BUYER_ORDER_STATUSES, BUYER_SHIPPING_STATUSES } from './orderStatus'

export const ORDER_PROCESS_KIND = 16
export const PAYMENT_RECEIPT_KIND = 17

export const ORDER_MESSAGE_TYPE = {
	ORDER_CREATION: '1',
	PAYMENT_REQUEST: '2',
	STATUS_UPDATE: '3',
	SHIPPING_UPDATE: '4',
} as const

export const ORDER_STATUSES = BUYER_ORDER_STATUSES
export const SHIPPING_STATUSES = BUYER_SHIPPING_STATUSES
export type OrderWorkflowStatus = (typeof ORDER_STATUSES)[number]
export type ShippingWorkflowStatus = (typeof SHIPPING_STATUSES)[number]

export type BuyerOrderItem = {
	productRef: string
	quantity: number
}

export interface BuyerOrderTemplateInput {
	merchantPubkey: string
	orderId: string
	amountSats: number
	items: BuyerOrderItem[]
	shippingRef?: string
	createdAt: number
	content?: string
}

/** Builds the unsigned public order marker. Private delivery details are never accepted here. */
export function createBuyerOrderTemplate(input: BuyerOrderTemplateInput): EventTemplate {
	const tags: string[][] = [
		['p', input.merchantPubkey],
		['subject', 'order-info'],
		['type', ORDER_MESSAGE_TYPE.ORDER_CREATION],
		['order', input.orderId],
		['amount', String(input.amountSats)],
	]

	for (const item of input.items) tags.push(['item', item.productRef, String(item.quantity)])
	if (input.shippingRef) tags.push(['shipping', input.shippingRef])

	return {
		kind: ORDER_PROCESS_KIND,
		created_at: input.createdAt,
		content: input.content ?? 'Order created',
		tags,
	}
}

export interface BuyerPaymentRequestTemplateInput {
	buyerPubkey: string
	merchantPubkey: string
	orderId: string
	amountSats: number
	paymentMethods: Array<{ type: 'lightning' | 'bitcoin' | 'other'; details: string }>
	expirationTime?: number
	createdAt: number
	content?: string
}

/** Builds an unsigned payment request, preserving the current event/tag contract. */
export function createBuyerPaymentRequestTemplate(input: BuyerPaymentRequestTemplateInput): EventTemplate {
	const tags: string[][] = [
		['p', input.buyerPubkey],
		['recipient', input.merchantPubkey],
		['subject', 'order-payment'],
		['type', ORDER_MESSAGE_TYPE.PAYMENT_REQUEST],
		['order', input.orderId],
		['amount', String(input.amountSats)],
	]

	for (const method of input.paymentMethods) tags.push(['payment', method.type, method.details])
	if (input.expirationTime) tags.push(['expiration', String(input.expirationTime)])

	return {
		kind: ORDER_PROCESS_KIND,
		created_at: input.createdAt,
		content: input.content || 'Payment request for your order',
		tags,
	}
}

export interface BuyerPaymentReceiptTemplateInput {
	merchantPubkey: string
	orderId: string
	amountSats: number
	bolt11: string
	proof: string
	createdAt: number
	content?: string
}

export interface OrderPaymentReceiptTemplateInput {
	merchantPubkey: string
	orderId: string
	amountSats: number
	medium: 'lightning' | 'bitcoin' | 'fiat' | 'other'
	reference: string
	proof: string
	createdAt: number
	content?: string
}

export interface OrderStatusUpdateTemplateInput {
	recipientPubkey: string
	orderId: string
	status: OrderWorkflowStatus
	createdAt: number
	content?: string
}

export interface ShippingStatusUpdateTemplateInput {
	recipientPubkey: string
	orderId: string
	status: ShippingWorkflowStatus
	createdAt: number
	tracking?: string
	carrier?: string
	eta?: string
	content?: string
}

export interface GeneralOrderCommunicationTemplateInput {
	recipientPubkey: string
	subject: string
	content: string
	createdAt: number
}

/** Builds the current Lightning receipt template; this does not verify settlement. */
export function createBuyerPaymentReceiptTemplate(input: BuyerPaymentReceiptTemplateInput): EventTemplate {
	return {
		kind: PAYMENT_RECEIPT_KIND,
		created_at: input.createdAt,
		content: input.content || 'Payment confirmation',
		tags: [
			['p', input.merchantPubkey],
			['subject', 'order-receipt'],
			['order', input.orderId],
			['payment', 'lightning', input.bolt11, input.proof],
			['amount', String(input.amountSats)],
		],
	}
}

export interface BuyerChatTemplateInput {
	recipientPubkey: string
	content: string
	createdAt: number
	subject?: string
}

/** Builds the current unsigned kind-14 buyer/seller message template. */
export function createBuyerChatTemplate(input: BuyerChatTemplateInput): EventTemplate {
	const tags: string[][] = [['p', input.recipientPubkey]]
	if (input.subject) tags.push(['subject', input.subject])
	return { kind: 14, created_at: input.createdAt, content: input.content, tags }
}

/** Build an unsigned seller order-status update; this does not authorize a transition. */
export function createOrderStatusUpdateTemplate(input: OrderStatusUpdateTemplateInput): EventTemplate {
	return {
		kind: ORDER_PROCESS_KIND,
		created_at: input.createdAt,
		content: input.content || `Order status updated to ${input.status}`,
		tags: [
			['p', input.recipientPubkey],
			['subject', 'order-info'],
			['type', ORDER_MESSAGE_TYPE.STATUS_UPDATE],
			['order', input.orderId],
			['status', input.status],
		],
	}
}

/** Build an unsigned shipping update; shipping status is distinct from order/payment status. */
export function createShippingStatusUpdateTemplate(input: ShippingStatusUpdateTemplateInput): EventTemplate {
	const tags: string[][] = [
		['p', input.recipientPubkey],
		['subject', 'shipping-info'],
		['type', ORDER_MESSAGE_TYPE.SHIPPING_UPDATE],
		['order', input.orderId],
		['status', input.status],
	]
	if (input.tracking) tags.push(['tracking', input.tracking])
	if (input.carrier) tags.push(['carrier', input.carrier])
	if (input.eta) tags.push(['eta', input.eta])
	return { kind: ORDER_PROCESS_KIND, created_at: input.createdAt, content: input.content || 'Shipping update', tags }
}

/** Build the legacy kind-14 order communication event without signing/publishing it. */
export function createGeneralOrderCommunicationTemplate(input: GeneralOrderCommunicationTemplateInput): EventTemplate {
	return {
		kind: 14,
		created_at: input.createdAt,
		content: input.content,
		tags: [
			['p', input.recipientPubkey],
			['subject', input.subject],
		],
	}
}

/** Build a generic payment receipt; receipt publication does not prove settlement. */
export function createOrderPaymentReceiptTemplate(input: OrderPaymentReceiptTemplateInput): EventTemplate {
	return {
		kind: PAYMENT_RECEIPT_KIND,
		created_at: input.createdAt,
		content: input.content || 'Payment confirmation',
		tags: [
			['p', input.merchantPubkey],
			['subject', 'order-receipt'],
			['order', input.orderId],
			['payment', input.medium, input.reference, input.proof],
			['amount', String(input.amountSats)],
		],
	}
}
