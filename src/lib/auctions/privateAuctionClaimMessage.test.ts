import { NDKUser, type NDKEncryptionScheme, type NDKSigner } from '@nostr-dev-kit/ndk'
import { describe, expect, test } from 'bun:test'
import { finalizeEvent, getPublicKey, nip44 } from 'nostr-tools'
import {
	buildAuctionClaimPublicMarkerTags,
	buildPrivateAuctionClaimPayload,
	createPrivateAuctionClaimMessage,
	createPrivateAuctionClaimMessageWithSigner,
	decryptPrivateAuctionClaimMessage,
	type AuctionClaimMessageFields,
} from './privateAuctionClaimMessage'

const CREATED_AT = 1_700_000_000
const AUCTION_EVENT_ID = 'a'.repeat(64)
const SETTLEMENT_EVENT_ID = 'b'.repeat(64)
const ORDER_ID = 'order-123'

const PII_SENTINELS = [
	'Satoshi Nakamoto',
	'123 Main Street',
	'Los Angeles',
	'90210',
	'United States',
	'Apt Secret Notes',
	'buyer@example.com',
	'+15551234567',
	'Leave at the citadel gate',
]

type KeyPair = {
	privateKey: Uint8Array
	pubkey: string
}

function keyPair(): KeyPair {
	const privateKey = crypto.getRandomValues(new Uint8Array(32))
	return { privateKey, pubkey: getPublicKey(privateKey) }
}

function baseFields(overrides: Partial<AuctionClaimMessageFields> = {}): AuctionClaimMessageFields {
	const buyer = keyPair()
	const seller = keyPair()
	return {
		orderId: ORDER_ID,
		auctionCoordinates: `30408:${seller.pubkey}:auction-1`,
		auctionEventId: AUCTION_EVENT_ID,
		settlementEventId: SETTLEMENT_EVENT_ID,
		buyerPubkey: buyer.pubkey,
		sellerPubkey: seller.pubkey,
		totalAmountSats: 21_000,
		shippingAddress: {
			name: 'Satoshi Nakamoto',
			firstLineOfAddress: '123 Main Street',
			city: 'Los Angeles',
			zipPostcode: '90210',
			country: 'United States',
			additionalInformation: 'Apt Secret Notes',
		},
		email: 'buyer@example.com',
		phone: '+15551234567',
		notes: 'Leave at the citadel gate',
		createdAt: CREATED_AT,
		...overrides,
	}
}

function signerFor(privateKey: Uint8Array): NDKSigner {
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
		encryptionEnabled: async (scheme?: NDKEncryptionScheme) => (!scheme || scheme === 'nip44' ? ['nip44'] : []),
		encrypt: async (recipient, value, scheme) => {
			if (scheme !== 'nip44') throw new Error('NIP-44 unavailable')
			return encryptForRecipient(value, privateKey, recipient.pubkey)
		},
		decrypt: async (sender, value, scheme) => {
			if (scheme !== 'nip44') throw new Error('NIP-44 unavailable')
			return decryptFromSender(value, privateKey, sender.pubkey)
		},
		sign: async (event) => finalizeEvent(event as unknown as Parameters<typeof finalizeEvent>[0], privateKey).sig,
		toPayload: () => JSON.stringify({ type: 'mock' }),
	}
}

function encryptForRecipient(plaintext: string, senderPrivateKey: Uint8Array, recipientPubkey: string): string {
	const conversationKey = nip44.v2.utils.getConversationKey(senderPrivateKey, recipientPubkey)
	return nip44.v2.encrypt(plaintext, conversationKey)
}

function decryptFromSender(ciphertext: string, recipientPrivateKey: Uint8Array, senderPubkey: string): string {
	const conversationKey = nip44.v2.utils.getConversationKey(recipientPrivateKey, senderPubkey)
	return nip44.v2.decrypt(ciphertext, conversationKey)
}

function expectNoPii(value: unknown): void {
	const serialized = JSON.stringify(value)
	for (const sentinel of PII_SENTINELS) {
		expect(serialized).not.toContain(sentinel)
	}
}

describe('private auction claim message', () => {
	test('rejects invalid auction coordinate', () => {
		const fields = baseFields()

		expect(() => buildPrivateAuctionClaimPayload({ ...fields, auctionCoordinates: `30402:${fields.sellerPubkey}:auction-1` })).toThrow(
			'Invalid auction coordinate',
		)
		expect(() => buildPrivateAuctionClaimPayload({ ...fields, auctionCoordinates: `30408:${'f'.repeat(64)}:auction-1` })).toThrow(
			'Auction coordinate seller pubkey does not match seller pubkey',
		)
		expect(() => buildPrivateAuctionClaimPayload({ ...fields, auctionCoordinates: `30408:${fields.sellerPubkey}:` })).toThrow(
			'Invalid auction coordinate d tag',
		)
	})

	test('rejects invalid buyer or seller pubkey', () => {
		const fields = baseFields()

		expect(() => buildPrivateAuctionClaimPayload({ ...fields, buyerPubkey: 'not-a-pubkey' })).toThrow('Invalid buyer pubkey')
		expect(() =>
			buildPrivateAuctionClaimPayload({
				...fields,
				sellerPubkey: 'not-a-pubkey',
				auctionCoordinates: '30408:not-a-pubkey:auction-1',
			}),
		).toThrow('Invalid seller pubkey')
	})

	test('rejects invalid auction or settlement event id', () => {
		const fields = baseFields()

		expect(() => buildPrivateAuctionClaimPayload({ ...fields, auctionEventId: 'not-an-event-id' })).toThrow('Invalid auction event id')
		expect(() => buildPrivateAuctionClaimPayload({ ...fields, settlementEventId: 'not-an-event-id' })).toThrow(
			'Invalid settlement event id',
		)
	})

	test('rejects invalid non-positive amount', () => {
		const fields = baseFields()

		for (const totalAmountSats of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
			expect(() => buildPrivateAuctionClaimPayload({ ...fields, totalAmountSats })).toThrow('Invalid total amount sats')
		}
	})

	test('encrypted gift wrap decrypts for the seller with auction claim details and PII', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const wrapper = keyPair()
		const fields = baseFields({
			buyerPubkey: buyer.pubkey,
			sellerPubkey: seller.pubkey,
			auctionCoordinates: `30408:${seller.pubkey}:auction-1`,
		})

		const wrapped = createPrivateAuctionClaimMessage({
			...fields,
			senderPrivateKey: buyer.privateKey,
			wrapperPrivateKey: wrapper.privateKey,
		})

		expectNoPii(wrapped.giftWrap)

		const decrypted = decryptPrivateAuctionClaimMessage({
			giftWrap: wrapped.giftWrap,
			recipientPrivateKey: seller.privateKey,
			expectedBuyerPubkey: buyer.pubkey,
			expectedSellerPubkey: seller.pubkey,
			expectedOrderId: ORDER_ID,
		})

		expect(decrypted.payload.auctionCoordinates).toBe(fields.auctionCoordinates)
		expect(decrypted.payload.auctionEventId).toBe(AUCTION_EVENT_ID)
		expect(decrypted.payload.settlementEventId).toBe(SETTLEMENT_EVENT_ID)
		expect(decrypted.payload.orderId).toBe(ORDER_ID)
		expect(decrypted.payload.totalAmountSats).toBe(21_000)
		expect(decrypted.payload.shippingAddress).toEqual(fields.shippingAddress)
		expect(decrypted.payload.email).toBe('buyer@example.com')
		expect(decrypted.payload.phone).toBe('+15551234567')
		expect(decrypted.payload.notes).toBe('Leave at the citadel gate')
	})

	test('signer-backed helper creates a seller-readable private auction claim', async () => {
		const buyer = keyPair()
		const seller = keyPair()
		const fields = baseFields({
			buyerPubkey: buyer.pubkey,
			sellerPubkey: seller.pubkey,
			auctionCoordinates: `30408:${seller.pubkey}:auction-1`,
		})

		const wrapped = await createPrivateAuctionClaimMessageWithSigner({
			...fields,
			signer: signerFor(buyer.privateKey),
		})
		const decrypted = decryptPrivateAuctionClaimMessage({
			giftWrap: wrapped.giftWrap,
			recipientPrivateKey: seller.privateKey,
			expectedBuyerPubkey: buyer.pubkey,
			expectedSellerPubkey: seller.pubkey,
		})

		expect(decrypted.payload.orderId).toBe(ORDER_ID)
		expect(decrypted.payload.shippingAddress.name).toBe('Satoshi Nakamoto')
	})

	test('public auction claim marker contains no delivery or contact data', () => {
		const fields = baseFields()
		const tags = buildAuctionClaimPublicMarkerTags(fields)

		expect(tags).toEqual([
			['p', fields.sellerPubkey],
			['subject', 'auction-claim'],
			['type', '1'],
			['order', ORDER_ID],
			['amount', '21000'],
			['a', fields.auctionCoordinates],
			['e', AUCTION_EVENT_ID],
			['e', SETTLEMENT_EVENT_ID, '', 'settlement'],
		])
		expectNoPii({ content: '', tags })
	})
})
