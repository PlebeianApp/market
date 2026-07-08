import type { Event } from 'nostr-tools'
import { ORDER_GENERAL_KIND, ORDER_PROCESS_KIND, PAYMENT_RECEIPT_KIND } from '../schemas/order'
import { assertOrderMessageRumor, type OrderMessageRumor } from './orderMessageRumor'
import type { UnwrappedNip17OrderMessage } from './nip17OrderRead'

export type OrderMessageTransport = 'legacy-raw' | 'nip17'
export type OrderMessageDirection = 'sent' | 'received' | 'unknown'
export type OrderMessageKind = typeof ORDER_GENERAL_KIND | typeof ORDER_PROCESS_KIND | typeof PAYMENT_RECEIPT_KIND

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

		const key = `legacy-raw:${event.id}`
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

		const key = `nip17:${rumor.id}`
		if (recordsByKey.has(key)) continue

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

	const rumorCandidate: OrderMessageRumor = {
		id: event.id,
		pubkey: event.pubkey,
		created_at: event.created_at,
		kind: event.kind,
		tags: event.tags,
		content: event.content,
	}

	try {
		assertOrderMessageRumor(rumorCandidate)
	} catch {
		return false
	}

	if (event.kind === ORDER_GENERAL_KIND && !hasNonEmptyTag(event, 'subject')) {
		return false
	}

	return true
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
