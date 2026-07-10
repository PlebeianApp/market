import { verifyEvent, type Event } from 'nostr-tools'
import {
	ORDER_GENERAL_KIND,
	ORDER_MESSAGE_TYPE,
	ORDER_PROCESS_KIND,
	ORDER_STATUS,
	PAYMENT_RECEIPT_KIND,
	SHIPPING_STATUS,
} from '../schemas/order'
import type { UnwrappedNip17OrderMessage } from './nip17OrderRead'

export type OrderMessageTransport = 'legacy-raw' | 'nip17'
export type OrderMessageDirection = 'sent' | 'received' | 'unknown'
export type OrderMessageKind = 14 | 16 | 17

export type MergedOrderMessageRecord = {
	transport: OrderMessageTransport
	id: string
	createdAt: number
	kind: OrderMessageKind
	pubkey: string
	tags: string[][]
	content: string
	direction: OrderMessageDirection
	legacyEvent?: Event
	nip17Message?: UnwrappedNip17OrderMessage
}

export type MergeOrderMessagesParams = {
	legacyEvents: Event[]
	nip17Messages: UnwrappedNip17OrderMessage[]
	activeUserPubkey?: string
}

export function mergeOrderMessages(params: MergeOrderMessagesParams): MergedOrderMessageRecord[] {
	const recordsByKey = new Map<string, MergedOrderMessageRecord>()

	for (const event of params.legacyEvents) {
		if (!isValidLegacyOrderMessageEvent(event)) continue

		const key = event.id
		if (recordsByKey.has(key)) continue

		recordsByKey.set(key, {
			transport: 'legacy-raw',
			id: event.id,
			createdAt: event.created_at,
			kind: event.kind,
			pubkey: event.pubkey,
			tags: event.tags,
			content: event.content,
			direction: directionForLegacyEvent(event, params.activeUserPubkey),
			legacyEvent: event,
		})
	}

	for (const message of params.nip17Messages) {
		const rumor = message.rumor
		if (!isOrderMessageKind(rumor.kind)) continue

		const key = rumor.id
		const existing = recordsByKey.get(key)
		if (existing?.transport === 'nip17') continue

		recordsByKey.set(key, {
			transport: 'nip17',
			id: rumor.id,
			createdAt: rumor.created_at,
			kind: rumor.kind,
			pubkey: rumor.pubkey,
			tags: rumor.tags,
			content: rumor.content,
			direction: message.direction,
			nip17Message: message,
		})
	}

	return Array.from(recordsByKey.values()).sort(compareMergedOrderMessages)
}

function isValidLegacyOrderMessageEvent(event: Event): event is Event & { kind: OrderMessageKind } {
	if (!isOrderMessageKind(event.kind)) return false

	const eventForVerification: Event & { kind: OrderMessageKind } = {
		id: event.id,
		pubkey: event.pubkey,
		created_at: event.created_at,
		kind: event.kind,
		tags: event.tags,
		content: event.content,
		sig: event.sig,
	}

	try {
		if (!verifyEvent(eventForVerification)) return false
	} catch {
		return false
	}

	return hasLegacyOrderMessageShape(eventForVerification)
}

function hasLegacyOrderMessageShape(event: Event & { kind: OrderMessageKind }): boolean {
	if (event.kind === ORDER_GENERAL_KIND) {
		return hasNonEmptyTag(event, 'p') && hasNonEmptyTag(event, 'subject')
	}

	if (event.kind === PAYMENT_RECEIPT_KIND) {
		return (
			hasNonEmptyTag(event, 'p') &&
			hasNonEmptyTag(event, 'subject') &&
			hasNonEmptyTag(event, 'order') &&
			hasPaymentProofTag(event) &&
			hasNonEmptyTag(event, 'amount')
		)
	}

	return hasLegacyOrderProcessShape(event)
}

function hasLegacyOrderProcessShape(event: Event): boolean {
	if (!hasNonEmptyTag(event, 'p') || !hasNonEmptyTag(event, 'subject') || !hasNonEmptyTag(event, 'order')) {
		return false
	}

	const messageType = event.tags.find((tag) => tag[0] === 'type')?.[1]

	switch (messageType) {
		case ORDER_MESSAGE_TYPE.ORDER_CREATION:
			return hasNonEmptyTag(event, 'amount') && hasItemTag(event)
		case ORDER_MESSAGE_TYPE.PAYMENT_REQUEST:
			return hasNonEmptyTag(event, 'amount')
		case ORDER_MESSAGE_TYPE.STATUS_UPDATE:
			return hasKnownOrderStatusTag(event)
		case ORDER_MESSAGE_TYPE.SHIPPING_UPDATE:
			return hasKnownShippingStatusTag(event)
		default:
			return false
	}
}

function hasItemTag(event: Event): boolean {
	return event.tags.some(
		(tag) => tag[0] === 'item' && typeof tag[1] === 'string' && tag[1].length > 0 && typeof tag[2] === 'string' && tag[2].length > 0,
	)
}

function hasPaymentProofTag(event: Event): boolean {
	return event.tags.some(
		(tag) =>
			tag[0] === 'payment' && isPaymentMedium(tag[1]) && typeof tag[2] === 'string' && tag[2].length > 0 && typeof tag[3] === 'string',
	)
}

function hasKnownOrderStatusTag(event: Event): boolean {
	return event.tags.some((tag) => tag[0] === 'status' && isOrderStatus(tag[1]))
}

function isOrderStatus(value: unknown): value is (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS] {
	return (
		value === ORDER_STATUS.PENDING ||
		value === ORDER_STATUS.CONFIRMED ||
		value === ORDER_STATUS.PROCESSING ||
		value === ORDER_STATUS.COMPLETED ||
		value === ORDER_STATUS.CANCELLED
	)
}

function hasKnownShippingStatusTag(event: Event): boolean {
	return event.tags.some((tag) => tag[0] === 'status' && isShippingStatus(tag[1]))
}

function isShippingStatus(value: unknown): value is (typeof SHIPPING_STATUS)[keyof typeof SHIPPING_STATUS] {
	return (
		value === SHIPPING_STATUS.PROCESSING ||
		value === SHIPPING_STATUS.SHIPPED ||
		value === SHIPPING_STATUS.DELIVERED ||
		value === SHIPPING_STATUS.EXCEPTION
	)
}

function isPaymentMedium(value: unknown): value is 'lightning' | 'bitcoin' | 'fiat' | 'other' {
	return value === 'lightning' || value === 'bitcoin' || value === 'fiat' || value === 'other'
}

function isOrderMessageKind(kind: number): kind is OrderMessageKind {
	return kind === ORDER_GENERAL_KIND || kind === ORDER_PROCESS_KIND || kind === PAYMENT_RECEIPT_KIND
}

function hasNonEmptyTag(event: Event, tagName: string): boolean {
	return event.tags.some((tag) => tag[0] === tagName && typeof tag[1] === 'string' && tag[1].length > 0)
}

function directionForLegacyEvent(event: Event, activeUserPubkey?: string): OrderMessageDirection {
	if (!activeUserPubkey) return 'unknown'
	if (event.pubkey === activeUserPubkey) return 'sent'

	const recipientPubkey = event.tags.find((tag) => tag[0] === 'p')?.[1]
	if (recipientPubkey === activeUserPubkey) return 'received'

	return 'unknown'
}

function compareMergedOrderMessages(a: MergedOrderMessageRecord, b: MergedOrderMessageRecord): number {
	const createdAtDiff = a.createdAt - b.createdAt
	if (createdAtDiff !== 0) return createdAtDiff

	const transportDiff = a.transport.localeCompare(b.transport)
	if (transportDiff !== 0) return transportDiff

	return a.id.localeCompare(b.id)
}
