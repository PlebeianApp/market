import { NDKEvent, NDKUser, type NDKEncryptionScheme, type NDKSigner } from '@nostr-dev-kit/ndk'
import { describe, expect, test } from 'bun:test'
import { finalizeEvent, getPublicKey, nip44 } from 'nostr-tools'
import type { Event } from 'nostr-tools'
import { createEncryptedPrivateOrderMessage, type PrivateOrderDeliveryDetails } from '../../lib/orders/privateOrderMessage'
import {
	attachPrivateOrderDetailsToOrders,
	decryptSellerPrivateOrderGiftWraps,
	privateDetailsMatchPublicOrder,
	type OrderWithRelatedEvents,
	type SellerPrivateOrderDetailsCandidate,
} from '../orders'

const CREATED_AT = 1_700_000_000
const PII_SENTINELS = [
	'buyer@example.com',
	'123 Main Street',
	'Satoshi Nakamoto',
	'+15551234567',
	'Los Angeles',
	'90210',
	'United States',
	'Apt Secret Notes',
]

type KeyPair = {
	privateKey: Uint8Array
	pubkey: string
}

type MockSignerOptions = {
	supportsNip44?: boolean
	canDecrypt?: boolean
	onSign?: () => void
}

function keyPair(): KeyPair {
	const privateKey = crypto.getRandomValues(new Uint8Array(32))
	return { privateKey, pubkey: getPublicKey(privateKey) }
}

function signerFor(privateKey: Uint8Array, options: MockSignerOptions = {}): NDKSigner {
	const pubkey = getPublicKey(privateKey)
	const user = new NDKUser({ pubkey })
	return {
		get pubkey() {
			return pubkey
		},
		blockUntilReady: async () => user,
		user: async () => user,
		get userSync() {
			return user
		},
		encryptionEnabled: async (scheme?: NDKEncryptionScheme) => {
			if (options.supportsNip44 === false) return []
			if (!scheme || scheme === 'nip44') return ['nip44']
			return []
		},
		encrypt: async (recipient, value, scheme) => {
			if (scheme !== 'nip44') throw new Error('NIP-44 required')
			const conversationKey = nip44.v2.utils.getConversationKey(privateKey, recipient.pubkey)
			return nip44.v2.encrypt(value, conversationKey)
		},
		decrypt: async (sender, value, scheme) => {
			if (options.supportsNip44 === false || options.canDecrypt === false || scheme !== 'nip44') throw new Error('NIP-44 unavailable')
			const conversationKey = nip44.v2.utils.getConversationKey(privateKey, sender.pubkey)
			return nip44.v2.decrypt(value, conversationKey)
		},
		sign: async (event) => {
			options.onSign?.()
			return finalizeEvent(event as unknown as Parameters<typeof finalizeEvent>[0], privateKey).sig
		},
		toPayload: () => JSON.stringify({ type: 'mock' }),
	}
}

function privateOrderDetails(
	buyerPubkey: string,
	sellerPubkey: string,
	overrides: Partial<PrivateOrderDeliveryDetails> = {},
): PrivateOrderDeliveryDetails {
	return {
		orderId: 'order-123',
		buyerPubkey,
		sellerPubkey,
		totalAmountSats: 2100,
		shippingRef: `30406:${sellerPubkey}:standard`,
		items: [{ productRef: `30402:${sellerPubkey}:product-1`, quantity: 2 }],
		delivery: {
			name: 'Satoshi Nakamoto',
			email: 'buyer@example.com',
			phone: '+15551234567',
			address: {
				firstLineOfAddress: '123 Main Street',
				additionalInformation: 'Apt Secret Notes',
				city: 'Los Angeles',
				zipPostcode: '90210',
				country: 'United States',
			},
		},
		orderNotes: 'Apt Secret Notes',
		...overrides,
	}
}

function publicOrderEvent(
	details: PrivateOrderDeliveryDetails,
	buyerPrivateKey: Uint8Array,
	overrides?: { kind?: number; tags?: string[][] },
): NDKEvent {
	const tags: string[][] = [
		['p', details.sellerPubkey],
		['subject', 'order-info'],
		['type', '1'],
		['order', details.orderId],
		['amount', String(details.totalAmountSats)],
		...details.items.map((item) => ['item', item.productRef, String(item.quantity)]),
	]
	if (details.shippingRef) tags.push(['shipping', details.shippingRef])

	return ndkEvent(
		finalizeEvent(
			{
				kind: overrides?.kind ?? 16,
				content: '',
				created_at: CREATED_AT,
				tags: overrides?.tags ?? tags,
			},
			buyerPrivateKey,
		),
	)
}

function orderWithRelatedEvents(order: NDKEvent): OrderWithRelatedEvents {
	return {
		order,
		paymentRequests: [],
		statusUpdates: [],
		shippingUpdates: [],
		generalMessages: [],
		paymentReceipts: [],
	}
}

function encryptedPrivateOrderGiftWrapEvent(
	details: PrivateOrderDeliveryDetails,
	buyerPrivateKey: Uint8Array,
	createdAt = CREATED_AT + 1,
): NDKEvent {
	const { giftWrap } = createEncryptedPrivateOrderMessage({
		details,
		buyerPrivateKey,
		createdAt,
	})
	return ndkEvent(giftWrap)
}

function ndkEvent(event: Event): NDKEvent {
	return new NDKEvent(undefined, event)
}

function candidateEvent(id: string, createdAt: number): NDKEvent {
	return new NDKEvent(undefined, {
		id,
		pubkey: '0'.repeat(64),
		created_at: createdAt,
		kind: 1059,
		tags: [],
		content: '',
		sig: '0'.repeat(128),
	})
}

function expectNoPii(value: unknown): void {
	const serialized = JSON.stringify(value)
	for (const sentinel of PII_SENTINELS) {
		expect(serialized).not.toContain(sentinel)
	}
}

describe('seller private order details query helpers', () => {
	test('valid kind 1059 gift wrap decrypts and attaches private details to the matching public order', async () => {
		const buyer = keyPair()
		const seller = keyPair()
		const details = privateOrderDetails(buyer.pubkey, seller.pubkey)
		const order = publicOrderEvent(details, buyer.privateKey)
		const giftWrapEvent = encryptedPrivateOrderGiftWrapEvent(details, buyer.privateKey)

		const candidates = await decryptSellerPrivateOrderGiftWraps({
			giftWrapEvents: [giftWrapEvent],
			sellerPubkey: seller.pubkey,
			signer: signerFor(seller.privateKey),
		})
		const [enrichedOrder] = attachPrivateOrderDetailsToOrders([orderWithRelatedEvents(order)], candidates)

		expect(candidates).toHaveLength(1)
		expect(enrichedOrder.privateOrderDetails).toEqual(details)
		expect(enrichedOrder.privateOrderDetailsEvent?.id).toBe(giftWrapEvent.id)
	})

	test('non-matching order id does not attach private details', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const details = privateOrderDetails(buyer.pubkey, seller.pubkey)
		const order = publicOrderEvent({ ...details, orderId: 'other-order' }, buyer.privateKey)

		expect(privateDetailsMatchPublicOrder(details, order)).toBe(false)
	})

	test('matching private details attach only to expected public order marker shape', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const details = privateOrderDetails(buyer.pubkey, seller.pubkey)
		const validOrder = publicOrderEvent(details, buyer.privateKey)
		const wrongKindOrder = publicOrderEvent(details, buyer.privateKey, { kind: 14 })
		const missingTypeOrder = publicOrderEvent(details, buyer.privateKey, {
			tags: [
				['p', seller.pubkey],
				['subject', 'order-info'],
				['order', details.orderId],
				['amount', String(details.totalAmountSats)],
				['item', details.items[0].productRef, String(details.items[0].quantity)],
				['shipping', details.shippingRef!],
			],
		})
		const wrongTypeOrder = publicOrderEvent(details, buyer.privateKey, {
			tags: [
				['p', seller.pubkey],
				['subject', 'order-info'],
				['type', '2'],
				['order', details.orderId],
				['amount', String(details.totalAmountSats)],
				['item', details.items[0].productRef, String(details.items[0].quantity)],
				['shipping', details.shippingRef!],
			],
		})

		expect(privateDetailsMatchPublicOrder(details, validOrder)).toBe(true)
		expect(privateDetailsMatchPublicOrder(details, wrongKindOrder)).toBe(false)
		expect(privateDetailsMatchPublicOrder(details, missingTypeOrder)).toBe(false)
		expect(privateDetailsMatchPublicOrder(details, wrongTypeOrder)).toBe(false)
	})

	test('duplicate type, order, amount, or p tags do not attach private details', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const details = privateOrderDetails(buyer.pubkey, seller.pubkey)
		const baseTags: string[][] = [
			['p', seller.pubkey],
			['subject', 'order-info'],
			['type', '1'],
			['order', details.orderId],
			['amount', String(details.totalAmountSats)],
			['item', details.items[0].productRef, String(details.items[0].quantity)],
			['shipping', details.shippingRef!],
		]

		for (const duplicateTag of [
			['type', '1'],
			['order', details.orderId],
			['amount', String(details.totalAmountSats)],
			['p', seller.pubkey],
		]) {
			const order = publicOrderEvent(details, buyer.privateKey, { tags: [...baseTags, duplicateTag] })
			expect(privateDetailsMatchPublicOrder(details, order)).toBe(false)
		}
	})

	test('missing or wrong subject tag does not attach private details', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const details = privateOrderDetails(buyer.pubkey, seller.pubkey)
		const tagsWithoutSubject: string[][] = [
			['p', seller.pubkey],
			['type', '1'],
			['order', details.orderId],
			['amount', String(details.totalAmountSats)],
			['item', details.items[0].productRef, String(details.items[0].quantity)],
			['shipping', details.shippingRef!],
		]
		const wrongSubjectOrder = publicOrderEvent(details, buyer.privateKey, {
			tags: [['subject', 'not-order-info'], ...tagsWithoutSubject],
		})
		const duplicateSubjectOrder = publicOrderEvent(details, buyer.privateKey, {
			tags: [['subject', 'order-info'], ['subject', 'order-info'], ...tagsWithoutSubject],
		})

		expect(privateDetailsMatchPublicOrder(details, publicOrderEvent(details, buyer.privateKey, { tags: tagsWithoutSubject }))).toBe(false)
		expect(privateDetailsMatchPublicOrder(details, wrongSubjectOrder)).toBe(false)
		expect(privateDetailsMatchPublicOrder(details, duplicateSubjectOrder)).toBe(false)
	})

	test('non-matching buyer pubkey does not attach private details', () => {
		const buyer = keyPair()
		const otherBuyer = keyPair()
		const seller = keyPair()
		const details = privateOrderDetails(buyer.pubkey, seller.pubkey)
		const order = publicOrderEvent({ ...details, buyerPubkey: otherBuyer.pubkey }, otherBuyer.privateKey)

		expect(privateDetailsMatchPublicOrder(details, order)).toBe(false)
	})

	test('non-matching seller pubkey does not attach private details', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const otherSeller = keyPair()
		const details = privateOrderDetails(buyer.pubkey, seller.pubkey)
		const order = publicOrderEvent(details, buyer.privateKey, {
			tags: [
				['p', otherSeller.pubkey],
				['subject', 'order-info'],
				['type', '1'],
				['order', details.orderId],
				['amount', String(details.totalAmountSats)],
				['item', `30402:${otherSeller.pubkey}:product-1`, '2'],
				['shipping', `30406:${otherSeller.pubkey}:standard`],
			],
		})

		expect(privateDetailsMatchPublicOrder(details, order)).toBe(false)
	})

	test('non-matching amount does not attach private details', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const details = privateOrderDetails(buyer.pubkey, seller.pubkey)
		const order = publicOrderEvent({ ...details, totalAmountSats: details.totalAmountSats + 1 }, buyer.privateKey)

		expect(privateDetailsMatchPublicOrder(details, order)).toBe(false)
	})

	test('non-matching item refs and quantities do not attach private details', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const details = privateOrderDetails(buyer.pubkey, seller.pubkey)

		const differentRefOrder = publicOrderEvent(details, buyer.privateKey, {
			tags: [
				['p', seller.pubkey],
				['subject', 'order-info'],
				['type', '1'],
				['order', details.orderId],
				['amount', String(details.totalAmountSats)],
				['item', `30402:${seller.pubkey}:other-product`, '2'],
				['shipping', details.shippingRef!],
			],
		})
		const differentQuantityOrder = publicOrderEvent({ ...details, items: [{ ...details.items[0], quantity: 3 }] }, buyer.privateKey)

		expect(privateDetailsMatchPublicOrder(details, differentRefOrder)).toBe(false)
		expect(privateDetailsMatchPublicOrder(details, differentQuantityOrder)).toBe(false)
	})

	test('item refs and quantities match independent of array order', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const productA = `30402:${seller.pubkey}:product-a`
		const productB = `30402:${seller.pubkey}:product-b`
		const details = privateOrderDetails(buyer.pubkey, seller.pubkey, {
			items: [
				{ productRef: productA, quantity: 2 },
				{ productRef: productB, quantity: 1 },
			],
		})
		const order = publicOrderEvent(details, buyer.privateKey, {
			tags: [
				['p', seller.pubkey],
				['subject', 'order-info'],
				['type', '1'],
				['order', details.orderId],
				['amount', String(details.totalAmountSats)],
				['item', productB, '1'],
				['item', productA, '2'],
				['shipping', details.shippingRef!],
			],
		})

		expect(privateDetailsMatchPublicOrder(details, order)).toBe(true)
	})

	test('duplicate item refs and quantities are handled deterministically', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const productRef = `30402:${seller.pubkey}:product-1`
		const details = privateOrderDetails(buyer.pubkey, seller.pubkey, {
			items: [
				{ productRef, quantity: 1 },
				{ productRef, quantity: 2 },
			],
		})
		const matchingOrder = publicOrderEvent(details, buyer.privateKey, {
			tags: [
				['p', seller.pubkey],
				['subject', 'order-info'],
				['type', '1'],
				['order', details.orderId],
				['amount', String(details.totalAmountSats)],
				['item', productRef, '3'],
				['shipping', details.shippingRef!],
			],
		})
		const nonMatchingOrder = publicOrderEvent({ ...details, items: [{ productRef, quantity: 2 }] }, buyer.privateKey)

		expect(privateDetailsMatchPublicOrder(details, matchingOrder)).toBe(true)
		expect(privateDetailsMatchPublicOrder(details, nonMatchingOrder)).toBe(false)
	})

	test('non-matching shipping ref and one-sided shipping ref presence do not attach private details', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const details = privateOrderDetails(buyer.pubkey, seller.pubkey)
		const differentShippingOrder = publicOrderEvent({ ...details, shippingRef: `30406:${seller.pubkey}:express` }, buyer.privateKey)
		const noPublicShippingOrder = publicOrderEvent(details, buyer.privateKey, {
			tags: [
				['p', seller.pubkey],
				['subject', 'order-info'],
				['type', '1'],
				['order', details.orderId],
				['amount', String(details.totalAmountSats)],
				['item', details.items[0].productRef, String(details.items[0].quantity)],
			],
		})
		const privateWithoutShipping = privateOrderDetails(buyer.pubkey, seller.pubkey, { shippingRef: undefined })
		const publicWithShipping = publicOrderEvent(details, buyer.privateKey)

		expect(privateDetailsMatchPublicOrder(details, differentShippingOrder)).toBe(false)
		expect(privateDetailsMatchPublicOrder(details, noPublicShippingOrder)).toBe(false)
		expect(privateDetailsMatchPublicOrder(privateWithoutShipping, publicWithShipping)).toBe(false)
	})

	test('malformed public shipping metadata does not attach private details', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const details = privateOrderDetails(buyer.pubkey, seller.pubkey, { shippingRef: undefined })
		const baseTags: string[][] = [
			['p', seller.pubkey],
			['subject', 'order-info'],
			['type', '1'],
			['order', details.orderId],
			['amount', String(details.totalAmountSats)],
			['item', details.items[0].productRef, String(details.items[0].quantity)],
		]

		const missingValueOrder = publicOrderEvent(details, buyer.privateKey, { tags: [...baseTags, ['shipping']] })
		const emptyValueOrder = publicOrderEvent(details, buyer.privateKey, { tags: [...baseTags, ['shipping', '']] })
		const duplicateShippingOrder = publicOrderEvent(details, buyer.privateKey, {
			tags: [...baseTags, ['shipping', `30406:${seller.pubkey}:standard`], ['shipping', `30406:${seller.pubkey}:express`]],
		})

		expect(privateDetailsMatchPublicOrder(details, missingValueOrder)).toBe(false)
		expect(privateDetailsMatchPublicOrder(details, emptyValueOrder)).toBe(false)
		expect(privateDetailsMatchPublicOrder(details, duplicateShippingOrder)).toBe(false)
	})

	test('orders without shipping on both sides still match', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const details = privateOrderDetails(buyer.pubkey, seller.pubkey, { shippingRef: undefined })
		const order = publicOrderEvent(details, buyer.privateKey)

		expect(privateDetailsMatchPublicOrder(details, order)).toBe(true)
	})

	test('malformed kind 1059 gift wrap does not leak PII or attach details', async () => {
		const buyer = keyPair()
		const seller = keyPair()
		const wrapper = keyPair()
		const details = privateOrderDetails(buyer.pubkey, seller.pubkey)
		const order = publicOrderEvent(details, buyer.privateKey)
		const malformedGiftWrap = ndkEvent(
			finalizeEvent(
				{
					kind: 1059,
					content: 'not encrypted Satoshi Nakamoto buyer@example.com 123 Main Street',
					created_at: CREATED_AT,
					tags: [['p', seller.pubkey]],
				},
				wrapper.privateKey,
			),
		)

		const candidates = await decryptSellerPrivateOrderGiftWraps({
			giftWrapEvents: [malformedGiftWrap],
			sellerPubkey: seller.pubkey,
			signer: signerFor(seller.privateKey),
		})
		const [enrichedOrder] = attachPrivateOrderDetailsToOrders([orderWithRelatedEvents(order)], candidates)

		expect(candidates).toEqual([])
		expect(enrichedOrder.privateOrderDetails).toBeUndefined()
		expectNoPii(enrichedOrder)
	})

	test('signer without NIP-44 decrypt support fails closed', async () => {
		const buyer = keyPair()
		const seller = keyPair()
		const details = privateOrderDetails(buyer.pubkey, seller.pubkey)
		const giftWrapEvent = encryptedPrivateOrderGiftWrapEvent(details, buyer.privateKey)

		const candidates = await decryptSellerPrivateOrderGiftWraps({
			giftWrapEvents: [giftWrapEvent],
			sellerPubkey: seller.pubkey,
			signer: signerFor(seller.privateKey, { supportsNip44: false }),
		})

		expect(candidates).toEqual([])
	})

	test('active signer pubkey mismatch fails closed and returns public orders without private details', async () => {
		const buyer = keyPair()
		const seller = keyPair()
		const otherSeller = keyPair()
		const details = privateOrderDetails(buyer.pubkey, seller.pubkey)
		const order = orderWithRelatedEvents(publicOrderEvent(details, buyer.privateKey))
		const giftWrapEvent = encryptedPrivateOrderGiftWrapEvent(details, buyer.privateKey)

		const candidates = await decryptSellerPrivateOrderGiftWraps({
			giftWrapEvents: [giftWrapEvent],
			sellerPubkey: seller.pubkey,
			signer: signerFor(otherSeller.privateKey),
		})
		const [enrichedOrder] = attachPrivateOrderDetailsToOrders([order], candidates)

		expect(candidates).toEqual([])
		expect(enrichedOrder.order.id).toBe(order.order.id)
		expect(enrichedOrder.privateOrderDetails).toBeUndefined()
	})

	test('seller decrypt/read path does not call signer.sign', async () => {
		const buyer = keyPair()
		const seller = keyPair()
		const details = privateOrderDetails(buyer.pubkey, seller.pubkey)
		const giftWrapEvent = encryptedPrivateOrderGiftWrapEvent(details, buyer.privateKey)
		let signCalls = 0

		const candidates = await decryptSellerPrivateOrderGiftWraps({
			giftWrapEvents: [giftWrapEvent],
			sellerPubkey: seller.pubkey,
			signer: signerFor(seller.privateKey, { onSign: () => signCalls++ }),
		})

		expect(candidates).toHaveLength(1)
		expect(signCalls).toBe(0)
	})

	test('public kind 16 order data contains no PII sentinels', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const details = privateOrderDetails(buyer.pubkey, seller.pubkey)
		const order = publicOrderEvent(details, buyer.privateKey)

		expectNoPii(order.rawEvent())
	})

	test('public orders are unchanged when no private gift wraps or no signer are available', async () => {
		const buyer = keyPair()
		const seller = keyPair()
		const details = privateOrderDetails(buyer.pubkey, seller.pubkey)
		const order = orderWithRelatedEvents(publicOrderEvent(details, buyer.privateKey))

		const noSignerCandidates = await decryptSellerPrivateOrderGiftWraps({
			giftWrapEvents: [encryptedPrivateOrderGiftWrapEvent(details, buyer.privateKey)],
			sellerPubkey: seller.pubkey,
			signer: null,
		})

		expect(attachPrivateOrderDetailsToOrders([order], [])).toEqual([order])
		expect(noSignerCandidates).toEqual([])
		expect(attachPrivateOrderDetailsToOrders([order], noSignerCandidates)).toEqual([order])
	})

	test('newest matching private payload wins with deterministic event-id tie-breaker', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const details = privateOrderDetails(buyer.pubkey, seller.pubkey)
		const order = orderWithRelatedEvents(publicOrderEvent(details, buyer.privateKey))
		const oldDetails = { ...details, delivery: { ...details.delivery, email: 'old@example.com' } }
		const newDetails = { ...details, delivery: { ...details.delivery, email: 'new@example.com' } }
		const tieWinnerDetails = { ...details, delivery: { ...details.delivery, email: 'tie-winner@example.com' } }
		const candidates: SellerPrivateOrderDetailsCandidate[] = [
			{ details: oldDetails, event: candidateEvent('b'.repeat(64), CREATED_AT + 1) },
			{ details: newDetails, event: candidateEvent('a'.repeat(64), CREATED_AT + 2) },
			{ details: tieWinnerDetails, event: candidateEvent('c'.repeat(64), CREATED_AT + 2) },
		]

		const [enrichedOrder] = attachPrivateOrderDetailsToOrders([order], candidates)

		expect(enrichedOrder.privateOrderDetails?.delivery.email).toBe('tie-winner@example.com')
	})
})
