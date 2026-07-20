import { verifyEvent, type Event as NostrEvent } from 'nostr-tools'
import {
	GeneralCommunicationSchema,
	ORDER_GENERAL_KIND,
	ORDER_MESSAGE_TYPE,
	ORDER_PROCESS_KIND,
	OrderCreationSchema,
	PAYMENT_RECEIPT_KIND,
	PaymentReceiptSchema,
	PaymentRequestSchema,
	ShippingUpdateSchema,
	StatusUpdateSchema,
} from '../schemas/order'
import type { UnwrappedNip17OrderMessage } from './nip17OrderRead'
import { assertOrderMessageRumor, type OrderMessageRumor } from './orderMessageRumor'

const INTEGER_AMOUNT_RE = /^\d+$/
const LEGACY_FIXED_TWO_DECIMAL_AMOUNT_RE = /^\d+\.\d{2}$/

export type OrderMessageReadSource = 'legacy' | 'nip17'

export type LegacyOrderMessageEvent = {
	id: string
	pubkey: string
	created_at: number
	kind: number
	tags: string[][]
	content: string
	sig: string
}

export type OrderMessageReadRecord = {
	source: OrderMessageReadSource
	id: string
	pubkey: string
	created_at: number
	kind: number
	tags: string[][]
	content: string
	transport?: {
		rumorId?: string
		giftWrapId?: string
		direction?: 'sent' | 'received'
		userPubkey?: string
		counterpartyPubkey?: string
		recipientPubkey?: string
	}
}

export type MergeOrderMessageReadsParams = {
	legacyEvents?: unknown[]
	nip17Messages?: unknown[]
}

export type MergeOrderMessageReadsResult = {
	records: OrderMessageReadRecord[]
}

export function mergeOrderMessageReads(params: MergeOrderMessageReadsParams): MergeOrderMessageReadsResult {
	const recordsById = new Map<string, OrderMessageReadRecord>()

	for (const value of params.legacyEvents ?? []) {
		const record = normalizeLegacyOrderMessage(value)
		if (!record) continue
		if (!recordsById.has(record.id)) recordsById.set(record.id, record)
	}

	for (const value of params.nip17Messages ?? []) {
		const record = normalizeNip17OrderMessage(value)
		if (!record) continue

		const existing = recordsById.get(record.id)
		if (existing?.source === 'nip17') continue
		recordsById.set(record.id, record)
	}

	return {
		records: Array.from(recordsById.values()).sort(compareOrderMessageReadRecords),
	}
}

function normalizeLegacyOrderMessage(value: unknown): OrderMessageReadRecord | null {
	if (!isLegacyOrderMessageEvent(value)) return null
	if (!isVerifiedLegacyOrderMessageEvent(value)) return null
	if (!isSupportedOrderMessageKind(value.kind)) return null
	if (!isValidOrderMessageSchema(value)) return null

	return {
		source: 'legacy',
		id: value.id,
		pubkey: value.pubkey,
		created_at: value.created_at,
		kind: value.kind,
		tags: cloneTags(value.tags),
		content: value.content,
	}
}

function normalizeNip17OrderMessage(value: unknown): OrderMessageReadRecord | null {
	if (!isUnwrappedNip17OrderMessage(value)) return null

	try {
		const rumorValue: unknown = value.rumor
		assertOrderMessageRumor(rumorValue)
		const rumor = rumorValue
		const recipientPubkey = getOrderRumorRecipientPubkey(rumor)
		if (!recipientPubkey) return null
		if (rumor.pubkey === recipientPubkey) return null
		if (value.recipientPubkey !== recipientPubkey) return null

		if (value.direction === 'sent') {
			if (value.userPubkey !== rumor.pubkey) return null
			if (value.counterpartyPubkey !== recipientPubkey) return null
		} else {
			if (value.userPubkey !== recipientPubkey) return null
			if (value.counterpartyPubkey !== rumor.pubkey) return null
		}

		return {
			source: 'nip17',
			id: rumor.id,
			pubkey: rumor.pubkey,
			created_at: rumor.created_at,
			kind: rumor.kind,
			tags: cloneTags(rumor.tags),
			content: rumor.content,
			transport: nip17TransportMetadata(value, rumor),
		}
	} catch {
		return null
	}
}

function isLegacyOrderMessageEvent(value: unknown): value is LegacyOrderMessageEvent {
	if (!isRecord(value)) return false
	if (!nonEmptyString(value.id)) return false
	if (!nonEmptyString(value.pubkey)) return false
	if (!Number.isInteger(value.created_at)) return false
	if (!Number.isInteger(value.kind)) return false
	if (typeof value.content !== 'string') return false
	if (!isStringTags(value.tags)) return false
	if (!nonEmptyString(value.sig)) return false
	return true
}

function isVerifiedLegacyOrderMessageEvent(event: LegacyOrderMessageEvent): boolean {
	try {
		return verifyEvent({
			id: event.id,
			pubkey: event.pubkey,
			created_at: event.created_at,
			kind: event.kind,
			tags: event.tags,
			content: event.content,
			sig: event.sig,
		} satisfies NostrEvent)
	} catch {
		return false
	}
}

function isUnwrappedNip17OrderMessage(value: unknown): value is UnwrappedNip17OrderMessage {
	if (!isRecord(value)) return false
	if (!isRecord(value.giftWrap)) return false
	if (!isRecord(value.seal)) return false
	if (value.direction !== 'sent' && value.direction !== 'received') return false
	if (!nonEmptyString(value.userPubkey)) return false
	if (!nonEmptyString(value.counterpartyPubkey)) return false
	if (!nonEmptyString(value.recipientPubkey)) return false
	return true
}

function isSupportedOrderMessageKind(kind: number): boolean {
	return kind === ORDER_GENERAL_KIND || kind === ORDER_PROCESS_KIND || kind === PAYMENT_RECEIPT_KIND
}

function isValidOrderMessageSchema(event: LegacyOrderMessageEvent): boolean {
	const validationTags = tagsForLegacySchemaValidation(event)
	if (!validationTags) return false

	const schemaInput = {
		kind: event.kind,
		created_at: event.created_at,
		content: event.content,
		tags: validationTags,
	}

	try {
		if (event.kind === ORDER_GENERAL_KIND) {
			GeneralCommunicationSchema.parse(schemaInput)
			return true
		}

		if (event.kind === ORDER_PROCESS_KIND) {
			const messageType = event.tags.find((tag) => tag[0] === 'type')?.[1]
			if (messageType === ORDER_MESSAGE_TYPE.ORDER_CREATION) {
				OrderCreationSchema.parse(schemaInput)
				return true
			}
			if (messageType === ORDER_MESSAGE_TYPE.PAYMENT_REQUEST) {
				PaymentRequestSchema.parse(schemaInput)
				return true
			}
			if (messageType === ORDER_MESSAGE_TYPE.STATUS_UPDATE) {
				StatusUpdateSchema.parse(schemaInput)
				return true
			}
			if (messageType === ORDER_MESSAGE_TYPE.SHIPPING_UPDATE) {
				ShippingUpdateSchema.parse(schemaInput)
				return true
			}
			return false
		}

		if (event.kind === PAYMENT_RECEIPT_KIND) {
			PaymentReceiptSchema.parse(schemaInput)
			return true
		}

		return false
	} catch {
		return false
	}
}

function tagsForLegacySchemaValidation(event: LegacyOrderMessageEvent): string[][] | null {
	const messageType = event.tags.find((tag) => tag[0] === 'type')?.[1]

	if (event.kind === ORDER_PROCESS_KIND && messageType === ORDER_MESSAGE_TYPE.PAYMENT_REQUEST) {
		const recipientTags = event.tags.filter((tag) => tag[0] === 'recipient')
		if (recipientTags.length > 1) return null

		const recipientTag = recipientTags[0]
		if (recipientTag && (recipientTag.length !== 2 || !nonEmptyString(recipientTag[1]))) {
			return null
		}

		return event.tags.filter((tag) => tag[0] !== 'recipient')
	}

	if (event.kind === ORDER_PROCESS_KIND && messageType === ORDER_MESSAGE_TYPE.ORDER_CREATION) {
		return tagsForLegacyOrderCreationSchemaValidation(event.tags)
	}

	return event.tags
}

function tagsForLegacyOrderCreationSchemaValidation(tags: string[][]): string[][] | null {
	const amountTags = tags.filter((tag) => tag[0] === 'amount')
	if (amountTags.length !== 1) return null

	const amountTag = amountTags[0]
	const amountValue = amountTag?.[1]
	if (!nonEmptyString(amountValue)) return null

	if (INTEGER_AMOUNT_RE.test(amountValue)) return tags
	if (!LEGACY_FIXED_TWO_DECIMAL_AMOUNT_RE.test(amountValue)) return tags

	return tags.map((tag) => (tag === amountTag ? ['amount', amountValue.replace('.', '')] : tag))
}

function getOrderRumorRecipientPubkey(rumor: OrderMessageRumor): string | null {
	// NIP-17 supports group rooms, but Gamma's order flow uses one buyer/merchant
	// counterparty; this two-party integration rejects multiple recipient p tags.
	const recipientTags = rumor.tags.filter((tag) => tag[0] === 'p')
	if (recipientTags.length !== 1) return null

	const recipientPubkey = recipientTags[0]?.[1]
	return nonEmptyString(recipientPubkey) ? recipientPubkey : null
}

function nip17TransportMetadata(
	message: UnwrappedNip17OrderMessage,
	rumor: OrderMessageRumor,
): NonNullable<OrderMessageReadRecord['transport']> {
	const giftWrapId = eventId(message.giftWrap)

	return {
		rumorId: rumor.id,
		...(giftWrapId ? { giftWrapId } : {}),
		direction: message.direction,
		userPubkey: message.userPubkey,
		counterpartyPubkey: message.counterpartyPubkey,
		recipientPubkey: message.recipientPubkey,
	}
}

function eventId(value: unknown): string | undefined {
	if (!isRecord(value)) return undefined
	return nonEmptyString(value.id) ? value.id : undefined
}

function compareOrderMessageReadRecords(a: OrderMessageReadRecord, b: OrderMessageReadRecord): number {
	const createdAtDiff = a.created_at - b.created_at
	if (createdAtDiff !== 0) return createdAtDiff

	return a.id.localeCompare(b.id)
}

function cloneTags(tags: string[][]): string[][] {
	return tags.map((tag) => [...tag])
}

function isStringTags(value: unknown): value is string[][] {
	return Array.isArray(value) && value.every((tag) => Array.isArray(tag) && tag.every((item) => typeof item === 'string'))
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}
