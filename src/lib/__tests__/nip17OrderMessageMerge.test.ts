import { describe, expect, test } from 'bun:test'
import { getEventHash, type Event } from 'nostr-tools'
import { ORDER_GENERAL_KIND, ORDER_PROCESS_KIND } from '../schemas/order'
import { mergeOrderMessages, type MergedOrderMessageRecord } from '../orders/nip17OrderMessageMerge'
import type { UnwrappedNip17OrderMessage } from '../orders/nip17OrderRead'
import {
	createOrderChatRumor,
	createOrderCreationRumor,
	createPaymentReceiptRumor,
	type OrderMessageRumor,
} from '../orders/orderMessageRumor'

const buyerPubkey = 'b'.repeat(64)
const sellerPubkey = 'c'.repeat(64)
const otherPubkey = 'd'.repeat(64)

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

function signedRumor(rumor: OrderMessageRumor, sig = 'f'.repeat(128)): Event {
	return {
		...rumor,
		sig,
	}
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
	)
}

function legacyChatEvent(params: {
	subject: string
	senderPubkey: string
	recipientPubkey: string
	createdAt: number
	content?: string
}): Event {
	return signedRumor(
		createOrderChatRumor({
			senderPubkey: params.senderPubkey,
			recipientPubkey: params.recipientPubkey,
			subject: params.subject,
			content: params.content ?? params.subject,
			createdAt: params.createdAt,
		}),
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
		const duplicate = signedRumor(first, 'e'.repeat(128))

		const records = mergeOrderMessages({
			legacyEvents: [first, duplicate],
			nip17Messages: [],
		})

		expect(records).toHaveLength(1)
		expect(records[0]?.legacyEvent?.sig).toBe('f'.repeat(128))
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
			senderPubkey: buyerPubkey,
			recipientPubkey: sellerPubkey,
			createdAt: 100,
		})
		const received = legacyChatEvent({
			subject: 'order-received',
			senderPubkey: sellerPubkey,
			recipientPubkey: buyerPubkey,
			createdAt: 101,
		})
		const unknown = legacyChatEvent({
			subject: 'order-unknown',
			senderPubkey: otherPubkey,
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
		const malformed = event({
			kind: ORDER_PROCESS_KIND,
			pubkey: buyerPubkey,
			created_at: 100,
			tags: [['p', sellerPubkey]],
			content: 'missing type and order tags',
		})

		const records = mergeOrderMessages({
			legacyEvents: [malformed],
			nip17Messages: [],
		})

		expect(records).toEqual([])
	})

	test('ignores legacy general communication without subject context', () => {
		const genericDm = event({
			kind: ORDER_GENERAL_KIND,
			pubkey: buyerPubkey,
			created_at: 100,
			tags: [['p', sellerPubkey]],
			content: 'generic public DM',
		})

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
})
