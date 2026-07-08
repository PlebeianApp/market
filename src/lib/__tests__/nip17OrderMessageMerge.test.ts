import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getEventHash, getPublicKey, type Event } from 'nostr-tools'
import { ORDER_GENERAL_KIND, ORDER_MESSAGE_TYPE, ORDER_PROCESS_KIND, PAYMENT_RECEIPT_KIND } from '../schemas/order'
import { mergeOrderMessages, type MergedOrderMessageRecord } from '../orders/nip17OrderMessageMerge'
import type { UnwrappedNip17OrderMessage } from '../orders/nip17OrderRead'
import {
	createOrderChatRumor,
	createOrderCreationRumor,
	createPaymentReceiptRumor,
	type OrderMessageRumor,
} from '../orders/orderMessageRumor'

const buyerPrivateKey = generateSecretKey()
const sellerPrivateKey = generateSecretKey()
const otherPrivateKey = generateSecretKey()
const buyerPubkey = getPublicKey(buyerPrivateKey)
const sellerPubkey = getPublicKey(sellerPrivateKey)
const otherPubkey = getPublicKey(otherPrivateKey)

function event(params: Omit<Event, 'id' | 'sig'> & { id?: string; sig?: string }): Event {
	const unsigned = {
		content: params.content,
		tags: params.tags,
		created_at: params.created_at,
		kind: params.kind,
		pubkey: params.pubkey,
	}

	return {
		...unsigned,
		id: params.id ?? getEventHash(unsigned),
		sig: params.sig ?? 'f'.repeat(128),
	}
}

function signedRumor(rumor: OrderMessageRumor, privateKey: Uint8Array): Event {
	return finalizeEvent(
		{
			kind: rumor.kind,
			created_at: rumor.created_at,
			tags: rumor.tags,
			content: rumor.content,
		},
		privateKey,
	)
}

function signedLegacyEvent(params: { kind: number; createdAt: number; tags: string[][]; content: string; privateKey: Uint8Array }): Event {
	return finalizeEvent(
		{
			kind: params.kind,
			created_at: params.createdAt,
			tags: params.tags,
			content: params.content,
		},
		params.privateKey,
	)
}

function nip17Message(
	rumor: OrderMessageRumor,
	direction: UnwrappedNip17OrderMessage['direction'] = 'received',
): UnwrappedNip17OrderMessage {
	return {
		giftWrap: event({
			id: `gift-${rumor.id}`,
			kind: 1059,
			pubkey: otherPubkey,
			created_at: rumor.created_at + 10,
			tags: [['p', direction === 'sent' ? buyerPubkey : sellerPubkey]],
			content: '',
		}),
		seal: event({
			id: `seal-${rumor.id}`,
			kind: 13,
			pubkey: rumor.pubkey,
			created_at: rumor.created_at + 5,
			tags: [],
			content: '',
		}),
		rumor,
		direction,
		userPubkey: direction === 'sent' ? buyerPubkey : sellerPubkey,
		counterpartyPubkey: direction === 'sent' ? sellerPubkey : buyerPubkey,
		recipientPubkey: sellerPubkey,
	}
}

function legacyOrderCreationEvent(orderId: string, createdAt: number): Event {
	return signedRumor(
		createOrderCreationRumor({
			buyerPubkey,
			merchantPubkey: sellerPubkey,
			orderId,
			amountSats: 1000,
			items: [{ productRef: `30402:${sellerPubkey}:coffee`, quantity: 1 }],
			createdAt,
		}),
		buyerPrivateKey,
	)
}

function legacyChatEvent(params: {
	subject: string
	senderPrivateKey: Uint8Array
	recipientPubkey: string
	createdAt: number
	content?: string
}): Event {
	const senderPubkey = getPublicKey(params.senderPrivateKey)

	return signedRumor(
		createOrderChatRumor({
			senderPubkey,
			recipientPubkey: params.recipientPubkey,
			subject: params.subject,
			content: params.content ?? params.subject,
			createdAt: params.createdAt,
		}),
		params.senderPrivateKey,
	)
}

function ids(records: MergedOrderMessageRecord[]): string[] {
	return records.map((record) => `${record.transport}:${record.id}`)
}

describe('mergeOrderMessages', () => {
	test('merges validated legacy raw events and unwrapped NIP-17 order messages', () => {
		const legacy = legacyOrderCreationEvent('order-merge-legacy', 100)
		const rumor = createPaymentReceiptRumor({
			buyerPubkey,
			merchantPubkey: sellerPubkey,
			orderId: 'order-merge-1',
			amountSats: 2100,
			payment: { medium: 'lightning', reference: 'lnbc-test', proof: 'preimage-test' },
			createdAt: 200,
		})

		const records = mergeOrderMessages({
			legacyEvents: [legacy],
			nip17Messages: [nip17Message(rumor)],
			activeUserPubkey: sellerPubkey,
		})

		expect(ids(records)).toEqual([`legacy-raw:${legacy.id}`, `nip17:${rumor.id}`])
		expect(records[0]?.direction).toBe('received')
		expect(records[1]?.direction).toBe('received')
	})

	test('preserves current raw legacy order creation events with decimal amount tags', () => {
		const legacy = signedLegacyEvent({
			kind: ORDER_PROCESS_KIND,
			createdAt: 100,
			privateKey: buyerPrivateKey,
			content: 'Order created',
			tags: [
				['p', sellerPubkey],
				['subject', 'order-info'],
				['type', ORDER_MESSAGE_TYPE.ORDER_CREATION],
				['order', 'legacy-decimal-amount'],
				['amount', '1000.00'],
				['item', `30402:${sellerPubkey}:coffee`, '1'],
			],
		})

		const records = mergeOrderMessages({
			legacyEvents: [legacy],
			nip17Messages: [],
			activeUserPubkey: sellerPubkey,
		})

		expect(ids(records)).toEqual([`legacy-raw:${legacy.id}`])
		expect(records[0]?.direction).toBe('received')
	})

	test('preserves current raw legacy payment requests with recipient tags', () => {
		const legacy = signedLegacyEvent({
			kind: ORDER_PROCESS_KIND,
			createdAt: 100,
			privateKey: sellerPrivateKey,
			content: 'Payment request for your order',
			tags: [
				['p', buyerPubkey],
				['recipient', sellerPubkey],
				['subject', 'order-payment'],
				['type', ORDER_MESSAGE_TYPE.PAYMENT_REQUEST],
				['order', 'legacy-payment-request'],
				['amount', '1000'],
				['payment', 'lightning', 'lnbc-test'],
			],
		})

		const records = mergeOrderMessages({
			legacyEvents: [legacy],
			nip17Messages: [],
			activeUserPubkey: buyerPubkey,
		})

		expect(ids(records)).toEqual([`legacy-raw:${legacy.id}`])
		expect(records[0]?.direction).toBe('received')
	})

	test('sorts deterministically by createdAt, transport, then id', () => {
		const older = legacyOrderCreationEvent('order-older', 100)
		const rumor = createOrderCreationRumor({
			buyerPubkey,
			merchantPubkey: sellerPubkey,
			orderId: 'order-middle',
			amountSats: 1000,
			items: [{ productRef: `30402:${sellerPubkey}:coffee`, quantity: 1 }],
			createdAt: 200,
		})
		const newer = legacyOrderCreationEvent('order-newer', 300)

		const records = mergeOrderMessages({
			legacyEvents: [newer, older],
			nip17Messages: [nip17Message(rumor)],
		})

		expect(ids(records)).toEqual([`legacy-raw:${older.id}`, `nip17:${rumor.id}`, `legacy-raw:${newer.id}`])
	})

	test('dedupes duplicate validated legacy events by event id', () => {
		const first = legacyOrderCreationEvent('order-dedupe-legacy', 100)
		const duplicate = { ...first }

		const records = mergeOrderMessages({
			legacyEvents: [first, duplicate],
			nip17Messages: [],
		})

		expect(records).toHaveLength(1)
		expect(records[0]?.legacyEvent?.sig).toBe(first.sig)
	})

	test('dedupes duplicate NIP-17 messages by inner rumor id', () => {
		const rumor = createOrderCreationRumor({
			buyerPubkey,
			merchantPubkey: sellerPubkey,
			orderId: 'order-merge-dedupe-nip17',
			amountSats: 1000,
			items: [{ productRef: `30402:${sellerPubkey}:coffee`, quantity: 1 }],
			createdAt: 100,
		})

		const records = mergeOrderMessages({
			legacyEvents: [],
			nip17Messages: [nip17Message(rumor), nip17Message(rumor, 'sent')],
		})

		expect(records).toHaveLength(1)
		expect(records[0]?.transport).toBe('nip17')
		expect(records[0]?.id).toBe(rumor.id)
		expect(records[0]?.direction).toBe('received')
	})

	test('preserves legacy and NIP-17 records when cross-transport identity is not proven identical', () => {
		const legacy = legacyOrderCreationEvent('order-merge-cross-transport-legacy', 100)
		const rumor = createOrderCreationRumor({
			buyerPubkey,
			merchantPubkey: sellerPubkey,
			orderId: 'order-merge-cross-transport-nip17',
			amountSats: 1000,
			items: [{ productRef: `30402:${sellerPubkey}:coffee`, quantity: 1 }],
			createdAt: 100,
		})

		const records = mergeOrderMessages({
			legacyEvents: [legacy],
			nip17Messages: [nip17Message(rumor)],
		})

		expect(records).toHaveLength(2)
		expect(ids(records)).toContain(`legacy-raw:${legacy.id}`)
		expect(ids(records)).toContain(`nip17:${rumor.id}`)
	})

	test('computes legacy sent, received, and unknown directions without throwing', () => {
		const sent = legacyChatEvent({
			subject: 'order-sent',
			senderPrivateKey: buyerPrivateKey,
			recipientPubkey: sellerPubkey,
			createdAt: 100,
		})
		const received = legacyChatEvent({
			subject: 'order-received',
			senderPrivateKey: sellerPrivateKey,
			recipientPubkey: buyerPubkey,
			createdAt: 101,
		})
		const unknown = legacyChatEvent({
			subject: 'order-unknown',
			senderPrivateKey: otherPrivateKey,
			recipientPubkey: sellerPubkey,
			createdAt: 102,
		})

		const records = mergeOrderMessages({
			legacyEvents: [sent, received, unknown],
			nip17Messages: [],
			activeUserPubkey: buyerPubkey,
		})

		expect(records.map((record) => record.direction)).toEqual(['sent', 'received', 'unknown'])
	})

	test('preserves legacy payment receipts with full payment proof tags', () => {
		const receipt = signedLegacyEvent({
			kind: PAYMENT_RECEIPT_KIND,
			createdAt: 100,
			privateKey: buyerPrivateKey,
			content: 'Payment confirmation',
			tags: [
				['p', sellerPubkey],
				['subject', 'order-receipt'],
				['order', 'legacy-receipt-full-proof'],
				['payment', 'lightning', 'lnbc-test', 'preimage-test'],
				['amount', '1000'],
			],
		})

		const records = mergeOrderMessages({
			legacyEvents: [receipt],
			nip17Messages: [],
			activeUserPubkey: sellerPubkey,
		})

		expect(ids(records)).toEqual([`legacy-raw:${receipt.id}`])
		expect(records[0]?.direction).toBe('received')
	})

	test('ignores legacy payment receipts without full payment proof tags', () => {
		const receipt = signedLegacyEvent({
			kind: PAYMENT_RECEIPT_KIND,
			createdAt: 100,
			privateKey: buyerPrivateKey,
			content: 'Payment confirmation',
			tags: [
				['p', sellerPubkey],
				['subject', 'order-receipt'],
				['order', 'legacy-receipt-missing-proof'],
				['payment', 'lightning'],
				['amount', '1000'],
			],
		})

		const records = mergeOrderMessages({
			legacyEvents: [receipt],
			nip17Messages: [],
		})

		expect(records).toEqual([])
	})

	test('ignores unsupported legacy event kinds', () => {
		const profile = event({
			kind: 0,
			pubkey: buyerPubkey,
			created_at: 100,
			tags: [],
			content: '{}',
		})

		const records = mergeOrderMessages({
			legacyEvents: [profile],
			nip17Messages: [],
		})

		expect(records).toEqual([])
	})

	test('ignores malformed legacy order process events', () => {
		const malformed = finalizeEvent(
			{
				kind: ORDER_PROCESS_KIND,
				created_at: 100,
				tags: [['p', sellerPubkey]],
				content: 'missing type and order tags',
			},
			buyerPrivateKey,
		)

		const records = mergeOrderMessages({
			legacyEvents: [malformed],
			nip17Messages: [],
		})

		expect(records).toEqual([])
	})

	test('ignores legacy general communication without subject context', () => {
		const genericDm = finalizeEvent(
			{
				kind: ORDER_GENERAL_KIND,
				created_at: 100,
				tags: [['p', sellerPubkey]],
				content: 'generic public DM',
			},
			buyerPrivateKey,
		)

		const records = mergeOrderMessages({
			legacyEvents: [genericDm],
			nip17Messages: [],
		})

		expect(records).toEqual([])
	})

	test('ignores legacy events with non-canonical event ids', () => {
		const valid = legacyOrderCreationEvent('order-non-canonical-id', 100)
		const tampered = {
			...valid,
			id: '0'.repeat(64),
		}

		const records = mergeOrderMessages({
			legacyEvents: [tampered],
			nip17Messages: [],
		})

		expect(records).toEqual([])
	})

	test('ignores legacy events with invalid signatures', () => {
		const valid = legacyOrderCreationEvent('order-invalid-signature', 100)
		const tampered = {
			...valid,
			sig: '0'.repeat(128),
		}

		const records = mergeOrderMessages({
			legacyEvents: [tampered],
			nip17Messages: [],
		})

		expect(records).toEqual([])
	})
})
