import { describe, expect, test } from 'bun:test'
import type { Event } from 'nostr-tools'
import { ORDER_GENERAL_KIND, ORDER_PROCESS_KIND } from '../schemas/order'
import { mergeOrderMessages, type MergedOrderMessageRecord } from '../orders/nip17OrderMessageMerge'
import type { UnwrappedNip17OrderMessage } from '../orders/nip17OrderRead'
import { createOrderCreationRumor, createPaymentReceiptRumor, type OrderMessageRumor } from '../orders/orderMessageRumor'

const buyerPubkey = 'b'.repeat(64)
const sellerPubkey = 'c'.repeat(64)
const otherPubkey = 'd'.repeat(64)

function event(params: Partial<Event> & Pick<Event, 'id' | 'kind' | 'pubkey' | 'created_at'>): Event {
	return {
		content: '',
		tags: [],
		sig: 'f'.repeat(128),
		...params,
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
		}),
		seal: event({
			id: `seal-${rumor.id}`,
			kind: 13,
			pubkey: rumor.pubkey,
			created_at: rumor.created_at + 5,
		}),
		rumor,
		direction,
		userPubkey: direction === 'sent' ? buyerPubkey : sellerPubkey,
		counterpartyPubkey: direction === 'sent' ? sellerPubkey : buyerPubkey,
		recipientPubkey: sellerPubkey,
	}
}

function ids(records: MergedOrderMessageRecord[]): string[] {
	return records.map((record) => `${record.transport}:${record.id}`)
}

describe('mergeOrderMessages', () => {
	test('merges legacy raw events and unwrapped NIP-17 order messages', () => {
		const legacy = event({
			id: 'legacy-order-create',
			kind: ORDER_PROCESS_KIND,
			pubkey: buyerPubkey,
			created_at: 100,
			tags: [['p', sellerPubkey]],
			content: 'legacy order create',
		})

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
		const legacyB = event({
			id: 'b',
			kind: ORDER_GENERAL_KIND,
			pubkey: buyerPubkey,
			created_at: 100,
			tags: [['p', sellerPubkey]],
		})
		const legacyA = event({
			id: 'a',
			kind: ORDER_GENERAL_KIND,
			pubkey: buyerPubkey,
			created_at: 100,
			tags: [['p', sellerPubkey]],
		})
		const rumor = createOrderCreationRumor({
			buyerPubkey,
			merchantPubkey: sellerPubkey,
			orderId: 'order-merge-sort',
			amountSats: 1000,
			items: [{ productRef: `30402:${sellerPubkey}:coffee`, quantity: 1 }],
			createdAt: 100,
		})
		const newer = event({
			id: 'newer',
			kind: ORDER_PROCESS_KIND,
			pubkey: buyerPubkey,
			created_at: 200,
			tags: [['p', sellerPubkey]],
		})

		const records = mergeOrderMessages({
			legacyEvents: [newer, legacyB, legacyA],
			nip17Messages: [nip17Message(rumor)],
			activeUserPubkey: sellerPubkey,
		})

		expect(ids(records)).toEqual([`legacy-raw:${legacyA.id}`, `legacy-raw:${legacyB.id}`, `nip17:${rumor.id}`, `legacy-raw:${newer.id}`])
	})

	test('dedupes duplicate legacy events by event id', () => {
		const first = event({
			id: 'same-legacy-id',
			kind: ORDER_PROCESS_KIND,
			pubkey: buyerPubkey,
			created_at: 100,
			tags: [['p', sellerPubkey]],
			content: 'first',
		})
		const duplicate = event({
			id: 'same-legacy-id',
			kind: ORDER_PROCESS_KIND,
			pubkey: buyerPubkey,
			created_at: 101,
			tags: [['p', sellerPubkey]],
			content: 'duplicate',
		})

		const records = mergeOrderMessages({
			legacyEvents: [first, duplicate],
			nip17Messages: [],
		})

		expect(records).toHaveLength(1)
		expect(records[0]?.content).toBe('first')
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
		const legacy = event({
			id: 'shared-looking-id',
			kind: ORDER_PROCESS_KIND,
			pubkey: buyerPubkey,
			created_at: 100,
			tags: [['p', sellerPubkey]],
		})
		const rumor = createOrderCreationRumor({
			buyerPubkey,
			merchantPubkey: sellerPubkey,
			orderId: 'order-merge-cross-transport',
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
		const sent = event({
			id: 'sent',
			kind: ORDER_GENERAL_KIND,
			pubkey: buyerPubkey,
			created_at: 100,
			tags: [['p', sellerPubkey]],
		})
		const received = event({
			id: 'received',
			kind: ORDER_GENERAL_KIND,
			pubkey: sellerPubkey,
			created_at: 101,
			tags: [['p', buyerPubkey]],
		})
		const unknown = event({
			id: 'unknown',
			kind: ORDER_GENERAL_KIND,
			pubkey: otherPubkey,
			created_at: 102,
			tags: [['p', sellerPubkey]],
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
			id: 'profile',
			kind: 0,
			pubkey: buyerPubkey,
			created_at: 100,
		})

		const records = mergeOrderMessages({
			legacyEvents: [profile],
			nip17Messages: [],
		})

		expect(records).toEqual([])
	})
})
