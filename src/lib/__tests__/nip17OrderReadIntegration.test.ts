import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getEventHash, getPublicKey, type Event } from 'nostr-tools'
import { ORDER_GENERAL_KIND, ORDER_PROCESS_KIND, ORDER_STATUS, PAYMENT_RECEIPT_KIND, SHIPPING_STATUS } from '../schemas/order'
import { mergeOrderMessageReads, type LegacyOrderMessageEvent, type OrderMessageReadRecord } from '../orders/nip17OrderReadIntegration'
import type { UnwrappedNip17OrderMessage } from '../orders/nip17OrderRead'
import {
	createOrderChatRumor,
	createOrderCreationRumor,
	createPaymentReceiptRumor,
	createPaymentRequestRumor,
	createShippingUpdateRumor,
	createStatusUpdateRumor,
	type OrderMessageRumor,
} from '../orders/orderMessageRumor'

const CREATED_AT = 1_700_000_000
const BUYER_PRIVATE_KEY = generateSecretKey()
const SELLER_PRIVATE_KEY = generateSecretKey()
const BUYER_PUBKEY = getPublicKey(BUYER_PRIVATE_KEY)
const SELLER_PUBKEY = getPublicKey(SELLER_PRIVATE_KEY)
const USER_PUBKEY = BUYER_PUBKEY
const COUNTERPARTY_PUBKEY = SELLER_PUBKEY
const PRODUCT_REF = `30402:${SELLER_PUBKEY}:product-1`

function legacyEventFromRumor(rumor: OrderMessageRumor, overrides: Partial<LegacyOrderMessageEvent> = {}): LegacyOrderMessageEvent {
	const event = {
		pubkey: overrides.pubkey ?? rumor.pubkey,
		created_at: overrides.created_at ?? rumor.created_at,
		kind: overrides.kind ?? rumor.kind,
		tags: overrides.tags ?? rumor.tags,
		content: overrides.content ?? rumor.content,
	}
	const signed = finalizeEvent(event, privateKeyForPubkey(event.pubkey))

	return {
		id: overrides.id ?? signed.id,
		pubkey: signed.pubkey,
		created_at: signed.created_at,
		kind: signed.kind,
		tags: signed.tags,
		content: signed.content,
		sig: overrides.sig ?? signed.sig,
	}
}

function privateKeyForPubkey(pubkey: string): Uint8Array {
	if (pubkey === BUYER_PUBKEY) return BUYER_PRIVATE_KEY
	if (pubkey === SELLER_PUBKEY) return SELLER_PRIVATE_KEY
	throw new Error(`No test private key for pubkey ${pubkey}`)
}

function fakeEvent(id: string, tags: string[][]): Event {
	return {
		id,
		pubkey: 'c'.repeat(64),
		created_at: CREATED_AT + 10,
		kind: 1059,
		tags,
		content: 'encrypted wrapper payload',
		sig: 'e'.repeat(128),
	}
}

function unwrappedMessage(
	rumor: OrderMessageRumor,
	overrides: Partial<Omit<UnwrappedNip17OrderMessage, 'rumor'>> = {},
): UnwrappedNip17OrderMessage {
	const recipientPubkey = rumor.tags.find((tag) => tag[0] === 'p')?.[1] ?? COUNTERPARTY_PUBKEY

	return {
		giftWrap: fakeEvent(`${rumor.id}-wrap`, [
			['p', USER_PUBKEY],
			['payment', 'wrapper-leak'],
			['order', 'wrapper-order'],
		]),
		seal: fakeEvent(`${rumor.id}-seal`, [
			['payment', 'seal-leak'],
			['order', 'seal-order'],
		]),
		rumor,
		direction: 'sent',
		userPubkey: USER_PUBKEY,
		counterpartyPubkey: COUNTERPARTY_PUBKEY,
		recipientPubkey,
		...overrides,
	}
}

function expectProtocolRecord(record: OrderMessageReadRecord): void {
	if (record.source === 'nip17') {
		expect(record.transport.rumorId).toBe(record.id)
	} else {
		expect(record.transport).toBeUndefined()
	}

	expect('sig' in record).toBe(false)
	expect('giftWrap' in record).toBe(false)
	expect('seal' in record).toBe(false)
	expect('rawEvent' in record).toBe(false)
	expect('toNostrEvent' in record).toBe(false)
	expect('sign' in record).toBe(false)
}

function orderCreationTagsWithAmount(rumor: OrderMessageRumor, amount: string): string[][] {
	return rumor.tags.map((tag) => (tag[0] === 'amount' ? ['amount', amount] : tag))
}

describe('NIP-17 order read integration helper', () => {
	test('normalizes legacy raw kind 14, 16, and 17 events', () => {
		const chat = createOrderChatRumor({
			senderPubkey: BUYER_PUBKEY,
			recipientPubkey: SELLER_PUBKEY,
			subject: 'order-123',
			content: 'Question about my order',
			createdAt: CREATED_AT,
		})
		const order = createOrderCreationRumor({
			buyerPubkey: BUYER_PUBKEY,
			merchantPubkey: SELLER_PUBKEY,
			orderId: 'order-123',
			amountSats: 2100,
			items: [{ productRef: PRODUCT_REF, quantity: 2 }],
			createdAt: CREATED_AT + 1,
		})
		const receipt = createPaymentReceiptRumor({
			buyerPubkey: BUYER_PUBKEY,
			merchantPubkey: SELLER_PUBKEY,
			orderId: 'order-123',
			payment: { medium: 'lightning', reference: 'lnbc-test', proof: 'preimage-test' },
			amountSats: 2100,
			createdAt: CREATED_AT + 2,
		})

		const result = mergeOrderMessageReads({
			legacyEvents: [legacyEventFromRumor(receipt), legacyEventFromRumor(order), legacyEventFromRumor(chat)],
		})

		expect(result.records.map((record) => record.kind)).toEqual([ORDER_GENERAL_KIND, ORDER_PROCESS_KIND, PAYMENT_RECEIPT_KIND])
		expect(result.records.map((record) => record.source)).toEqual(['legacy', 'legacy', 'legacy'])
		expect(result.records.map((record) => record.id)).toEqual([chat.id, order.id, receipt.id])
		expect(result.records[0]?.tags).toEqual(chat.tags)
		expect(result.records[1]?.content).toBe(order.content)
		expect(result.records[2]?.pubkey).toBe(receipt.pubkey)
		result.records.forEach(expectProtocolRecord)
	})

	test('accepts kind 14 messages without optional subject tags', () => {
		const legacyRumor = createOrderChatRumor({
			senderPubkey: BUYER_PUBKEY,
			recipientPubkey: SELLER_PUBKEY,
			content: 'Legacy message without a subject',
			createdAt: CREATED_AT,
		})
		const nip17Rumor = createOrderChatRumor({
			senderPubkey: BUYER_PUBKEY,
			recipientPubkey: SELLER_PUBKEY,
			content: 'NIP-17 message without a subject',
			createdAt: CREATED_AT + 1,
		})

		const result = mergeOrderMessageReads({
			legacyEvents: [legacyEventFromRumor(legacyRumor)],
			nip17Messages: [unwrappedMessage(nip17Rumor)],
		})

		expect(result.records.map((record) => record.id)).toEqual([legacyRumor.id, nip17Rumor.id])
		expect(result.records.map((record) => record.source)).toEqual(['legacy', 'nip17'])
		expect(result.records.every((record) => record.tags.every((tag) => tag[0] !== 'subject'))).toBe(true)
	})

	test('rejects malformed legacy events', () => {
		const valid = createPaymentRequestRumor({
			merchantPubkey: SELLER_PUBKEY,
			buyerPubkey: BUYER_PUBKEY,
			orderId: 'order-valid',
			amountSats: 2100,
			paymentMethods: [],
			createdAt: CREATED_AT,
		})
		const validEvent = legacyEventFromRumor(valid)
		const invalidKind16 = legacyEventFromRumor(valid, {
			tags: [
				['p', BUYER_PUBKEY],
				['order', 'order-valid'],
			],
		})
		const unsignedEvent = { ...validEvent }
		delete (unsignedEvent as Partial<LegacyOrderMessageEvent>).sig

		const result = mergeOrderMessageReads({
			legacyEvents: [
				null,
				{ ...validEvent, id: '' },
				legacyEventFromRumor(valid, { kind: 1 }),
				{ ...validEvent, tags: [['p', 123]] },
				{ ...validEvent, sig: 123 },
				{ ...validEvent, id: '0'.repeat(64) },
				{ ...validEvent, sig: '0'.repeat(128) },
				unsignedEvent,
				invalidKind16,
				validEvent,
			],
		})

		expect(result.records).toHaveLength(1)
		expect(result.records[0]?.id).toBe(valid.id)
		expect(result.records[0]?.source).toBe('legacy')
	})

	test('accepts legacy payment request recipient tag but keeps legacy tag validation narrow', () => {
		const paymentRequest = createPaymentRequestRumor({
			merchantPubkey: SELLER_PUBKEY,
			buyerPubkey: BUYER_PUBKEY,
			orderId: 'order-legacy-recipient',
			amountSats: 2100,
			paymentMethods: [{ type: 'lightning', details: 'lnbc-test' }],
			createdAt: CREATED_AT,
		})
		const tagsWithRecipient = [...paymentRequest.tags, ['recipient', SELLER_PUBKEY]]
		const validPaymentRequest = legacyEventFromRumor(paymentRequest, { tags: tagsWithRecipient })

		const result = mergeOrderMessageReads({
			legacyEvents: [
				legacyEventFromRumor(paymentRequest, {
					tags: [...paymentRequest.tags, ['recipient']],
				}),
				legacyEventFromRumor(paymentRequest, {
					tags: [...paymentRequest.tags, ['recipient', SELLER_PUBKEY], ['recipient', BUYER_PUBKEY]],
				}),
				legacyEventFromRumor(paymentRequest, {
					tags: [...paymentRequest.tags, ['unsupported', 'legacy-extra']],
				}),
				validPaymentRequest,
			],
		})

		expect(result.records).toHaveLength(1)
		expect(result.records[0]?.id).toBe(validPaymentRequest.id)
		expect(result.records[0]?.source).toBe('legacy')
		expect(result.records[0]?.tags).toEqual(tagsWithRecipient)
		expect(result.records[0]?.tags).toContainEqual(['recipient', SELLER_PUBKEY])
	})

	test('rejects legacy payment requests without the required amount tag', () => {
		const paymentRequest = createPaymentRequestRumor({
			merchantPubkey: SELLER_PUBKEY,
			buyerPubkey: BUYER_PUBKEY,
			orderId: 'order-missing-amount',
			amountSats: 2100,
			paymentMethods: [{ type: 'lightning', details: 'lnbc-test' }],
			createdAt: CREATED_AT,
		})
		const missingAmount = legacyEventFromRumor(paymentRequest, {
			tags: paymentRequest.tags.filter((tag) => tag[0] !== 'amount'),
		})

		const result = mergeOrderMessageReads({ legacyEvents: [missingAmount] })

		expect(result.records).toEqual([])
	})

	test('accepts legacy order creation fixed-two-decimal amount but keeps legacy tag validation narrow', () => {
		const orderCreation = createOrderCreationRumor({
			buyerPubkey: BUYER_PUBKEY,
			merchantPubkey: SELLER_PUBKEY,
			orderId: 'order-legacy-decimal',
			amountSats: 1000,
			items: [{ productRef: PRODUCT_REF, quantity: 1 }],
			createdAt: CREATED_AT,
		})
		const wholeDecimalAmountTags = orderCreationTagsWithAmount(orderCreation, '1000.00')
		const fractionalDecimalAmountTags = orderCreationTagsWithAmount(orderCreation, '12.50')
		const wholeDecimalOrderCreation = legacyEventFromRumor(orderCreation, { tags: wholeDecimalAmountTags })
		const fractionalDecimalOrderCreation = legacyEventFromRumor(orderCreation, { tags: fractionalDecimalAmountTags })
		const unsupportedExtraOrderCreation = legacyEventFromRumor(orderCreation, {
			tags: [...fractionalDecimalAmountTags, ['unsupported', 'legacy-extra']],
		})
		const duplicateAmountOrderCreation = legacyEventFromRumor(orderCreation, {
			tags: [...fractionalDecimalAmountTags, ['amount', '1250']],
		})
		const malformedDecimalEvents = ['12.5', '12.500', '.50', '12.', '12.345'].map((amount) =>
			legacyEventFromRumor(orderCreation, { tags: orderCreationTagsWithAmount(orderCreation, amount) }),
		)

		const result = mergeOrderMessageReads({
			legacyEvents: [
				unsupportedExtraOrderCreation,
				duplicateAmountOrderCreation,
				...malformedDecimalEvents,
				wholeDecimalOrderCreation,
				fractionalDecimalOrderCreation,
			],
		})

		const wholeDecimalRecord = result.records.find((record) => record.id === wholeDecimalOrderCreation.id)
		const fractionalDecimalRecord = result.records.find((record) => record.id === fractionalDecimalOrderCreation.id)

		expect(result.records).toHaveLength(2)
		expect(wholeDecimalRecord?.source).toBe('legacy')
		expect(wholeDecimalRecord?.tags).toEqual(wholeDecimalAmountTags)
		expect(wholeDecimalRecord?.tags).toContainEqual(['amount', '1000.00'])
		expect(fractionalDecimalRecord?.source).toBe('legacy')
		expect(fractionalDecimalRecord?.tags).toEqual(fractionalDecimalAmountTags)
		expect(fractionalDecimalRecord?.tags).toContainEqual(['amount', '12.50'])
		expect(result.records.map((record) => record.id)).not.toContain(unsupportedExtraOrderCreation.id)
		expect(result.records.map((record) => record.id)).not.toContain(duplicateAmountOrderCreation.id)
		for (const malformedDecimalEvent of malformedDecimalEvents) {
			expect(result.records.map((record) => record.id)).not.toContain(malformedDecimalEvent.id)
		}
	})

	test('accepts known legacy shipping statuses and rejects unknown values', () => {
		const shippingUpdate = createShippingUpdateRumor({
			senderPubkey: SELLER_PUBKEY,
			recipientPubkey: BUYER_PUBKEY,
			orderId: 'order-shipping-status',
			status: SHIPPING_STATUS.SHIPPED,
			createdAt: CREATED_AT,
		})
		const validShippingUpdate = legacyEventFromRumor(shippingUpdate)
		const invalidShippingUpdate = legacyEventFromRumor(shippingUpdate, {
			tags: shippingUpdate.tags.map((tag) => (tag[0] === 'status' ? ['status', 'teleported'] : tag)),
		})

		const result = mergeOrderMessageReads({
			legacyEvents: [invalidShippingUpdate, validShippingUpdate],
		})

		expect(result.records).toHaveLength(1)
		expect(result.records[0]?.id).toBe(validShippingUpdate.id)
		expect(result.records[0]?.tags).toContainEqual(['status', SHIPPING_STATUS.SHIPPED])
	})

	test('preserves legacy empty-proof receipts as read data without deriving settlement', () => {
		const receipt = createPaymentReceiptRumor({
			buyerPubkey: BUYER_PUBKEY,
			merchantPubkey: SELLER_PUBKEY,
			orderId: 'order-empty-proof',
			payment: { medium: 'lightning', reference: 'lnbc-test', proof: '' },
			amountSats: 2100,
			createdAt: CREATED_AT,
		})

		const result = mergeOrderMessageReads({ legacyEvents: [legacyEventFromRumor(receipt)] })

		expect(result.records).toHaveLength(1)
		expect(result.records[0]?.tags).toContainEqual(['payment', 'lightning', 'lnbc-test', ''])
		expect('paid' in result.records[0]!).toBe(false)
		expect('settled' in result.records[0]!).toBe(false)
	})

	test('normalizes unwrapped NIP-17 messages', () => {
		const rumor = createOrderCreationRumor({
			buyerPubkey: BUYER_PUBKEY,
			merchantPubkey: SELLER_PUBKEY,
			orderId: 'order-nip17',
			amountSats: 2100,
			items: [{ productRef: PRODUCT_REF, quantity: 1 }],
			createdAt: CREATED_AT,
		})

		const result = mergeOrderMessageReads({
			nip17Messages: [
				unwrappedMessage(rumor, {
					direction: 'received',
					userPubkey: SELLER_PUBKEY,
					counterpartyPubkey: BUYER_PUBKEY,
				}),
			],
		})

		expect(result.records).toEqual([
			{
				source: 'nip17',
				id: rumor.id,
				pubkey: rumor.pubkey,
				created_at: rumor.created_at,
				kind: rumor.kind,
				tags: rumor.tags,
				content: rumor.content,
				transport: {
					rumorId: rumor.id,
					giftWrapId: `${rumor.id}-wrap`,
					direction: 'received',
					userPubkey: SELLER_PUBKEY,
					counterpartyPubkey: BUYER_PUBKEY,
					recipientPubkey: SELLER_PUBKEY,
				},
			},
		])
		expectProtocolRecord(result.records[0]!)
	})

	test('rejects malformed NIP-17 records defensively', () => {
		const validRumor = createOrderCreationRumor({
			buyerPubkey: BUYER_PUBKEY,
			merchantPubkey: SELLER_PUBKEY,
			orderId: 'order-nip17-valid',
			amountSats: 2100,
			items: [{ productRef: PRODUCT_REF, quantity: 1 }],
			createdAt: CREATED_AT,
		})
		const recipientMismatchRumor = createOrderCreationRumor({
			buyerPubkey: BUYER_PUBKEY,
			merchantPubkey: SELLER_PUBKEY,
			orderId: 'order-nip17-recipient-mismatch',
			amountSats: 2100,
			items: [{ productRef: PRODUCT_REF, quantity: 1 }],
			createdAt: CREATED_AT + 1,
		})
		const sentWrongUserRumor = createOrderCreationRumor({
			buyerPubkey: BUYER_PUBKEY,
			merchantPubkey: SELLER_PUBKEY,
			orderId: 'order-nip17-sent-wrong-user',
			amountSats: 2100,
			items: [{ productRef: PRODUCT_REF, quantity: 1 }],
			createdAt: CREATED_AT + 2,
		})
		const receivedWrongCounterpartyRumor = createOrderCreationRumor({
			buyerPubkey: BUYER_PUBKEY,
			merchantPubkey: SELLER_PUBKEY,
			orderId: 'order-nip17-received-wrong-counterparty',
			amountSats: 2100,
			items: [{ productRef: PRODUCT_REF, quantity: 1 }],
			createdAt: CREATED_AT + 3,
		})
		const selfAddressedRumor = createOrderChatRumor({
			senderPubkey: SELLER_PUBKEY,
			recipientPubkey: SELLER_PUBKEY,
			subject: 'order-nip17-self-addressed',
			content: 'Self-addressed order message',
			createdAt: CREATED_AT + 4,
		})
		const selfAddressedNip17 = unwrappedMessage(selfAddressedRumor, {
			userPubkey: SELLER_PUBKEY,
			counterpartyPubkey: SELLER_PUBKEY,
			recipientPubkey: SELLER_PUBKEY,
		})
		const paymentRequestRumor = createPaymentRequestRumor({
			merchantPubkey: SELLER_PUBKEY,
			buyerPubkey: BUYER_PUBKEY,
			orderId: 'order-nip17-recipient-tag',
			amountSats: 2100,
			paymentMethods: [{ type: 'lightning', details: 'lnbc-test' }],
			createdAt: CREATED_AT + 5,
		})
		const decimalOrderCreationRumor = createOrderCreationRumor({
			buyerPubkey: BUYER_PUBKEY,
			merchantPubkey: SELLER_PUBKEY,
			orderId: 'order-nip17-decimal-amount',
			amountSats: 1250,
			items: [{ productRef: PRODUCT_REF, quantity: 1 }],
			createdAt: CREATED_AT + 6,
		})
		const decimalOrderCreationNip17 = unwrappedMessage({
			...decimalOrderCreationRumor,
			tags: orderCreationTagsWithAmount(decimalOrderCreationRumor, '12.50'),
		})
		const multiRecipientUnsigned = {
			...validRumor,
			tags: [...validRumor.tags, ['p', 'f'.repeat(64)]],
		}
		const multiRecipientRumor: OrderMessageRumor = {
			...multiRecipientUnsigned,
			id: getEventHash(multiRecipientUnsigned),
		}

		const result = mergeOrderMessageReads({
			nip17Messages: [
				null,
				{ ...unwrappedMessage(validRumor), direction: 'sideways' },
				{ ...unwrappedMessage(validRumor), userPubkey: '' },
				{ ...unwrappedMessage(validRumor), rumor: { ...validRumor, sig: 'f'.repeat(128) } },
				unwrappedMessage(recipientMismatchRumor, { recipientPubkey: 'c'.repeat(64) }),
				unwrappedMessage(sentWrongUserRumor, { userPubkey: 'd'.repeat(64) }),
				unwrappedMessage(receivedWrongCounterpartyRumor, {
					direction: 'received',
					userPubkey: SELLER_PUBKEY,
					counterpartyPubkey: 'e'.repeat(64),
				}),
				selfAddressedNip17,
				unwrappedMessage(multiRecipientRumor),
				unwrappedMessage({
					...paymentRequestRumor,
					tags: [...paymentRequestRumor.tags, ['recipient', SELLER_PUBKEY]],
				}),
				decimalOrderCreationNip17,
				unwrappedMessage(validRumor),
			],
		})

		expect(result.records).toHaveLength(1)
		expect(result.records[0]?.id).toBe(validRumor.id)
		expect(result.records[0]?.source).toBe('nip17')
		expect(result.records.map((record) => record.id)).not.toContain(selfAddressedNip17.rumor.id)
		expect(result.records.map((record) => record.id)).not.toContain(multiRecipientRumor.id)
		expect(result.records.map((record) => record.id)).not.toContain(decimalOrderCreationNip17.rumor.id)
		expect(result.records[0]?.transport).toMatchObject({
			direction: 'sent',
			userPubkey: BUYER_PUBKEY,
			counterpartyPubkey: SELLER_PUBKEY,
			recipientPubkey: SELLER_PUBKEY,
		})
	})

	test('rejects already-unwrapped NIP-17 messages with non-order rumor kinds', () => {
		const unsignedReaction = {
			pubkey: BUYER_PUBKEY,
			created_at: CREATED_AT,
			kind: 7,
			tags: [['p', SELLER_PUBKEY]],
			content: '+',
		}
		const reactionRumor: OrderMessageRumor = {
			...unsignedReaction,
			id: getEventHash(unsignedReaction),
		}

		const result = mergeOrderMessageReads({
			nip17Messages: [unwrappedMessage(reactionRumor)],
		})

		expect(result.records).toEqual([])
	})

	test('does not expose wrapper or gift-wrap tags as order-message tags', () => {
		const rumor = createOrderChatRumor({
			senderPubkey: BUYER_PUBKEY,
			recipientPubkey: SELLER_PUBKEY,
			subject: 'order-private',
			content: 'Encrypted chat content',
			createdAt: CREATED_AT,
		})

		const result = mergeOrderMessageReads({ nip17Messages: [unwrappedMessage(rumor)] })

		expect(result.records[0]?.tags).toEqual(rumor.tags)
		expect(result.records[0]?.tags).not.toContainEqual(['payment', 'wrapper-leak'])
		expect(result.records[0]?.tags).not.toContainEqual(['order', 'wrapper-order'])
		expect(result.records[0]?.tags).not.toContainEqual(['payment', 'seal-leak'])
		expect(result.records[0]?.tags).not.toContainEqual(['order', 'seal-order'])
	})

	test('merges legacy and NIP-17 records', () => {
		const legacy = createStatusUpdateRumor({
			senderPubkey: SELLER_PUBKEY,
			recipientPubkey: BUYER_PUBKEY,
			orderId: 'order-mixed',
			status: ORDER_STATUS.CONFIRMED,
			createdAt: CREATED_AT,
		})
		const encrypted = createPaymentReceiptRumor({
			buyerPubkey: BUYER_PUBKEY,
			merchantPubkey: SELLER_PUBKEY,
			orderId: 'order-mixed',
			payment: { medium: 'lightning', reference: 'lnbc-test', proof: 'preimage-test' },
			amountSats: 2100,
			createdAt: CREATED_AT + 1,
		})

		const result = mergeOrderMessageReads({
			legacyEvents: [legacyEventFromRumor(legacy)],
			nip17Messages: [unwrappedMessage(encrypted)],
		})

		expect(result.records.map((record) => record.source)).toEqual(['legacy', 'nip17'])
		expect(result.records.map((record) => record.id)).toEqual([legacy.id, encrypted.id])
	})

	test('prefers NIP-17 when legacy and NIP-17 share the same canonical id', () => {
		const rumor = createOrderChatRumor({
			senderPubkey: BUYER_PUBKEY,
			recipientPubkey: SELLER_PUBKEY,
			subject: 'order-duplicate',
			content: 'NIP-17 content wins',
			createdAt: CREATED_AT,
		})
		const legacy = legacyEventFromRumor(rumor)

		const result = mergeOrderMessageReads({
			legacyEvents: [legacy],
			nip17Messages: [unwrappedMessage(rumor)],
		})

		expect(result.records).toHaveLength(1)
		expect(result.records[0]?.source).toBe('nip17')
		expect(result.records[0]?.content).toBe('NIP-17 content wins')
		expect(result.records[0]?.tags).toEqual(rumor.tags)
	})

	test('dedupes duplicate NIP-17 wrappers and directions by inner rumor id', () => {
		const rumor = createOrderChatRumor({
			senderPubkey: BUYER_PUBKEY,
			recipientPubkey: SELLER_PUBKEY,
			subject: 'order-duplicate-nip17',
			content: 'Only one encrypted record',
			createdAt: CREATED_AT,
		})

		const result = mergeOrderMessageReads({
			nip17Messages: [
				unwrappedMessage(rumor, { giftWrap: fakeEvent('wrap-a', [['p', USER_PUBKEY]]) }),
				unwrappedMessage(rumor, {
					giftWrap: fakeEvent('wrap-b', [['p', SELLER_PUBKEY]]),
					direction: 'received',
					userPubkey: SELLER_PUBKEY,
					counterpartyPubkey: BUYER_PUBKEY,
				}),
			],
		})

		expect(result.records).toHaveLength(1)
		expect(result.records[0]?.id).toBe(rumor.id)
		expect(result.records[0]?.source).toBe('nip17')
	})

	test('sorts deterministically by created_at, then id', () => {
		const first = createOrderChatRumor({
			senderPubkey: BUYER_PUBKEY,
			recipientPubkey: SELLER_PUBKEY,
			subject: 'sort-a',
			content: 'first',
			createdAt: CREATED_AT,
		})
		const second = createOrderChatRumor({
			senderPubkey: BUYER_PUBKEY,
			recipientPubkey: SELLER_PUBKEY,
			subject: 'sort-b',
			content: 'second',
			createdAt: CREATED_AT,
		})
		const third = createOrderChatRumor({
			senderPubkey: BUYER_PUBKEY,
			recipientPubkey: SELLER_PUBKEY,
			subject: 'sort-c',
			content: 'third',
			createdAt: CREATED_AT + 1,
		})
		const firstEvent = legacyEventFromRumor(first)
		const secondEvent = legacyEventFromRumor(second)
		const thirdEvent = legacyEventFromRumor(third)
		const sameTimestampIds = [firstEvent.id, secondEvent.id].sort((a, b) => a.localeCompare(b))

		const result = mergeOrderMessageReads({
			legacyEvents: [thirdEvent, secondEvent, firstEvent],
		})

		expect(result.records.map((record) => record.id)).toEqual([...sameTimestampIds, thirdEvent.id])
	})

	test('keeps legacy-only records so existing raw orders still render', () => {
		const legacyOnly = createPaymentRequestRumor({
			merchantPubkey: SELLER_PUBKEY,
			buyerPubkey: BUYER_PUBKEY,
			orderId: 'order-legacy-only',
			amountSats: 2100,
			paymentMethods: [],
			content: 'Payment details pending',
			createdAt: CREATED_AT,
		})

		const result = mergeOrderMessageReads({ legacyEvents: [legacyEventFromRumor(legacyOnly)] })

		expect(result.records).toHaveLength(1)
		expect(result.records[0]?.source).toBe('legacy')
		expect(result.records[0]?.id).toBe(legacyOnly.id)
		expect(result.records[0]?.content).toBe('Payment details pending')
	})

	test('returns protocol/domain records, not NDKEvent instances or wrappers', () => {
		const legacyOnly = createOrderChatRumor({
			senderPubkey: BUYER_PUBKEY,
			recipientPubkey: SELLER_PUBKEY,
			subject: 'order-protocol-record',
			content: 'Plain public chat',
			createdAt: CREATED_AT,
		})
		const encrypted = createOrderChatRumor({
			senderPubkey: BUYER_PUBKEY,
			recipientPubkey: SELLER_PUBKEY,
			subject: 'order-protocol-record',
			content: 'Encrypted chat',
			createdAt: CREATED_AT + 1,
		})

		const result = mergeOrderMessageReads({
			legacyEvents: [legacyEventFromRumor(legacyOnly)],
			nip17Messages: [unwrappedMessage(encrypted)],
		})

		result.records.forEach(expectProtocolRecord)
		expect(result.records.every((record) => record.source === 'legacy' || record.source === 'nip17')).toBe(true)
		expect(result.records.every((record) => record.transport === undefined || record.transport.rumorId === record.id)).toBe(true)
		expect(result.records.some((record) => record.kind === ORDER_GENERAL_KIND)).toBe(true)
	})
})
