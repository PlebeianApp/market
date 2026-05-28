import { describe, expect, test } from 'bun:test'
import { getEventHash, getPublicKey, verifyEvent } from 'nostr-tools'
import {
	createEncryptedPrivateOrderMessage,
	createPrivateOrderDetailsRumor,
	decryptPrivateOrderMessage,
	parsePrivateOrderDetailsRumor,
	serializeBuyerAddress,
	type PrivateOrderDeliveryDetails,
} from './privateOrderMessage'

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

function keyPair(): KeyPair {
	const privateKey = crypto.getRandomValues(new Uint8Array(32))
	return { privateKey, pubkey: getPublicKey(privateKey) }
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
		orderNotes: 'Leave the package behind the planter',
		...overrides,
	}
}

function tagValue(tags: string[][], name: string): string | undefined {
	return tags.find((tag) => tag[0] === name)?.[1]
}

function tagValues(tags: string[][], name: string): string[][] {
	return tags.filter((tag) => tag[0] === name)
}

function expectNoPii(value: unknown): void {
	const serialized = JSON.stringify(value)
	for (const sentinel of PII_SENTINELS) {
		expect(serialized).not.toContain(sentinel)
	}
}

function canonicalRumorId(rumor: { pubkey: string; created_at: number; kind: number; tags: string[][]; content: string }): string {
	return getEventHash({
		pubkey: rumor.pubkey,
		created_at: rumor.created_at,
		kind: rumor.kind,
		tags: rumor.tags,
		content: rumor.content,
	})
}

describe('private order message helper', () => {
	test('creates valid Gamma-compatible unsigned kind 16/type=1 order details rumor', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const details = privateOrderDetails(buyer.pubkey, seller.pubkey)

		const rumor = createPrivateOrderDetailsRumor({ details, createdAt: CREATED_AT })

		expect(rumor.kind).toBe(16)
		expect(rumor.pubkey).toBe(buyer.pubkey)
		expect(rumor.created_at).toBe(CREATED_AT)
		expect('sig' in rumor).toBe(false)
		expect(rumor.id).toBe(canonicalRumorId(rumor))
		expect(rumor.tags).toContainEqual(['p', seller.pubkey])
		expect(rumor.tags).toContainEqual(['subject', 'order-info'])
		expect(rumor.tags).toContainEqual(['type', '1'])
		expect(rumor.tags).toContainEqual(['order', 'order-123'])
		expect(rumor.tags).toContainEqual(['amount', '2100'])
		expect(rumor.tags).toContainEqual(['item', `30402:${seller.pubkey}:product-1`, '2'])
		expect(rumor.tags).toContainEqual(['shipping', `30406:${seller.pubkey}:standard`])
		expect(rumor.tags).toContainEqual(['name', 'Satoshi Nakamoto'])
		expect(rumor.tags).toContainEqual(['address', '123 Main Street\nApt Secret Notes\nLos Angeles\n90210\nUnited States'])
		expect(rumor.tags).toContainEqual(['email', 'buyer@example.com'])
		expect(rumor.tags).toContainEqual(['phone', '+15551234567'])
		expect(rumor.content).toBe('Leave the package behind the planter')
	})

	test('wraps private order details without exposing buyer PII in kind 1059', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const wrapper = keyPair()
		const details = privateOrderDetails(buyer.pubkey, seller.pubkey)

		const { rumor, seal, giftWrap } = createEncryptedPrivateOrderMessage({
			details,
			buyerPrivateKey: buyer.privateKey,
			wrapperPrivateKey: wrapper.privateKey,
			createdAt: CREATED_AT,
		})

		expect(rumor.kind).toBe(16)
		expect('sig' in rumor).toBe(false)
		expect(seal.kind).toBe(13)
		expect(seal.tags).toEqual([])
		expect(seal.pubkey).toBe(buyer.pubkey)
		expect(verifyEvent(seal)).toBe(true)
		expect(giftWrap.kind).toBe(1059)
		expect(giftWrap.tags).toEqual([['p', seller.pubkey]])
		expect(verifyEvent(giftWrap)).toBe(true)
		expectNoPii(giftWrap)
		expect(JSON.stringify(giftWrap)).not.toContain('Satoshi Nakamoto')
	})

	test('seller decrypts gift wrap to seal to rumor to order details', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const details = privateOrderDetails(buyer.pubkey, seller.pubkey)
		const { giftWrap, rumor } = createEncryptedPrivateOrderMessage({
			details,
			buyerPrivateKey: buyer.privateKey,
			createdAt: CREATED_AT,
		})

		const decrypted = decryptPrivateOrderMessage({
			giftWrap,
			sellerPrivateKey: seller.privateKey,
			expectedSellerPubkey: seller.pubkey,
			expectedBuyerPubkey: buyer.pubkey,
		})

		expect(decrypted.rumor).toEqual(rumor)
		expect(decrypted.seal.pubkey).toBe(buyer.pubkey)
		expect(decrypted.details).toEqual(details)
	})

	test('non-recipient cannot decrypt private order details', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const nonRecipient = keyPair()
		const details = privateOrderDetails(buyer.pubkey, seller.pubkey)
		const { giftWrap } = createEncryptedPrivateOrderMessage({
			details,
			buyerPrivateKey: buyer.privateKey,
			createdAt: CREATED_AT,
		})

		expect(() =>
			decryptPrivateOrderMessage({
				giftWrap,
				sellerPrivateKey: nonRecipient.privateKey,
				expectedSellerPubkey: nonRecipient.pubkey,
				expectedBuyerPubkey: buyer.pubkey,
			}),
		).toThrow()
	})

	test('rejects signed rumor', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const details = privateOrderDetails(buyer.pubkey, seller.pubkey)
		const rumor = { ...createPrivateOrderDetailsRumor({ details, createdAt: CREATED_AT }), sig: '0'.repeat(128) }

		expect(() => parsePrivateOrderDetailsRumor(rumor)).toThrow('Private order rumor must be unsigned')
	})

	test('private order parser rejects a rumor with an incorrect id', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const details = privateOrderDetails(buyer.pubkey, seller.pubkey)
		const rumor = { ...createPrivateOrderDetailsRumor({ details, createdAt: CREATED_AT }), id: '0'.repeat(64) }

		expect(() => parsePrivateOrderDetailsRumor(rumor)).toThrow('NIP-59 rumor id is invalid')
	})

	test('rejects mismatched seller pubkey', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const otherSeller = keyPair()
		const details = privateOrderDetails(buyer.pubkey, seller.pubkey)
		const rumor = createPrivateOrderDetailsRumor({ details, createdAt: CREATED_AT })

		expect(() => parsePrivateOrderDetailsRumor(rumor, { expectedSellerPubkey: otherSeller.pubkey })).toThrow(
			'Private order seller pubkey mismatch',
		)
	})

	test('rejects mismatched buyer pubkey', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const otherBuyer = keyPair()
		const details = privateOrderDetails(buyer.pubkey, seller.pubkey)
		const { giftWrap } = createEncryptedPrivateOrderMessage({
			details,
			buyerPrivateKey: buyer.privateKey,
			createdAt: CREATED_AT,
		})

		expect(() =>
			decryptPrivateOrderMessage({
				giftWrap,
				sellerPrivateKey: seller.privateKey,
				expectedSellerPubkey: seller.pubkey,
				expectedBuyerPubkey: otherBuyer.pubkey,
			}),
		).toThrow()
	})

	test('rejects invalid shippingRef', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const otherSeller = keyPair()

		expect(() =>
			createPrivateOrderDetailsRumor({
				details: privateOrderDetails(buyer.pubkey, seller.pubkey, {
					shippingRef: `30406:${otherSeller.pubkey}:standard`,
				}),
				createdAt: CREATED_AT,
			}),
		).toThrow('Private order shipping ref is invalid')
	})

	test('rejects invalid item refs and quantities', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const otherSeller = keyPair()

		expect(() =>
			createPrivateOrderDetailsRumor({
				details: privateOrderDetails(buyer.pubkey, seller.pubkey, {
					items: [{ productRef: `30402:${otherSeller.pubkey}:product-1`, quantity: 1 }],
				}),
				createdAt: CREATED_AT,
			}),
		).toThrow('Private order item ref is invalid')

		expect(() =>
			createPrivateOrderDetailsRumor({
				details: privateOrderDetails(buyer.pubkey, seller.pubkey, {
					items: [{ productRef: `30402:${seller.pubkey}:product-1`, quantity: 0 }],
				}),
				createdAt: CREATED_AT,
			}),
		).toThrow('Private order item quantity is invalid')
	})

	test('multi-seller payloads are scoped per seller', () => {
		const buyer = keyPair()
		const sellerA = keyPair()
		const sellerB = keyPair()
		const sellerAProductRef = `30402:${sellerA.pubkey}:product-a`
		const sellerBProductRef = `30402:${sellerB.pubkey}:product-b`

		const sellerARumor = createPrivateOrderDetailsRumor({
			details: privateOrderDetails(buyer.pubkey, sellerA.pubkey, {
				orderId: 'order-a',
				shippingRef: `30406:${sellerA.pubkey}:pickup`,
				items: [{ productRef: sellerAProductRef, quantity: 1 }],
			}),
			createdAt: CREATED_AT,
		})
		const sellerBRumor = createPrivateOrderDetailsRumor({
			details: privateOrderDetails(buyer.pubkey, sellerB.pubkey, {
				orderId: 'order-b',
				shippingRef: `30406:${sellerB.pubkey}:pickup`,
				items: [{ productRef: sellerBProductRef, quantity: 3 }],
			}),
			createdAt: CREATED_AT,
		})

		expect(tagValues(sellerARumor.tags, 'item')).toEqual([['item', sellerAProductRef, '1']])
		expect(tagValues(sellerBRumor.tags, 'item')).toEqual([['item', sellerBProductRef, '3']])
		expect(JSON.stringify(sellerARumor)).not.toContain(sellerBProductRef)
		expect(JSON.stringify(sellerBRumor)).not.toContain(sellerAProductRef)
		expect(() =>
			createPrivateOrderDetailsRumor({
				details: privateOrderDetails(buyer.pubkey, sellerA.pubkey, {
					items: [{ productRef: sellerBProductRef, quantity: 1 }],
				}),
				createdAt: CREATED_AT,
			}),
		).toThrow('Private order item ref is invalid')
	})

	test('serializes typed address deterministically at the private message boundary', () => {
		const addressString = serializeBuyerAddress({
			firstLineOfAddress: '123 Main Street',
			additionalInformation: 'Apt Secret Notes',
			city: 'Los Angeles',
			zipPostcode: '90210',
			country: 'United States',
		})

		expect(addressString).toBe('123 Main Street\nApt Secret Notes\nLos Angeles\n90210\nUnited States')
	})

	test('private order details can omit optional buyer fields', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const details = privateOrderDetails(buyer.pubkey, seller.pubkey, {
			delivery: {},
			orderNotes: '',
			shippingRef: undefined,
		})

		const rumor = createPrivateOrderDetailsRumor({ details, createdAt: CREATED_AT })

		expect(tagValue(rumor.tags, 'name')).toBeUndefined()
		expect(tagValue(rumor.tags, 'address')).toBeUndefined()
		expect(tagValue(rumor.tags, 'email')).toBeUndefined()
		expect(tagValue(rumor.tags, 'phone')).toBeUndefined()
		expect(tagValue(rumor.tags, 'shipping')).toBeUndefined()
	})
})
