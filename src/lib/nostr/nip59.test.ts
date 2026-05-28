import { describe, expect, test } from 'bun:test'
import { finalizeEvent, getEventHash, getPublicKey, nip44, verifyEvent } from 'nostr-tools'
import type { Event } from 'nostr-tools'
import {
	createNip59GiftWrap,
	NIP59_GIFT_WRAP_KIND,
	NIP59_SEAL_KIND,
	normalizeUnsignedRumorId,
	unwrapNip59GiftWrap,
	type UnsignedRumor,
} from './nip59'

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

function rumorFor(buyerPubkey: string): UnsignedRumor {
	return {
		kind: 16,
		pubkey: buyerPubkey,
		created_at: CREATED_AT,
		tags: [
			['p', 'seller'],
			['subject', 'order-info'],
		],
		content: 'Satoshi Nakamoto buyer@example.com 123 Main Street Apt Secret Notes',
	}
}

function canonicalRumorId(rumor: UnsignedRumor): string {
	return getEventHash({
		pubkey: rumor.pubkey,
		created_at: rumor.created_at,
		kind: rumor.kind,
		tags: rumor.tags,
		content: rumor.content,
	})
}

function encryptForRecipient(plaintext: string, senderPrivateKey: Uint8Array, recipientPubkey: string): string {
	const conversationKey = nip44.v2.utils.getConversationKey(senderPrivateKey, recipientPubkey)
	return nip44.v2.encrypt(plaintext, conversationKey)
}

function giftWrapForSeal(seal: unknown, wrapperPrivateKey: Uint8Array, sellerPubkey: string): Event {
	return finalizeEvent(
		{
			kind: NIP59_GIFT_WRAP_KIND,
			content: encryptForRecipient(JSON.stringify(seal), wrapperPrivateKey, sellerPubkey),
			created_at: CREATED_AT,
			tags: [['p', sellerPubkey]],
		},
		wrapperPrivateKey,
	)
}

function sealForRumor(rumor: unknown, buyerPrivateKey: Uint8Array, sellerPubkey: string, tags: string[][] = []): Event {
	return finalizeEvent(
		{
			kind: NIP59_SEAL_KIND,
			content: encryptForRecipient(JSON.stringify(rumor), buyerPrivateKey, sellerPubkey),
			created_at: CREATED_AT,
			tags,
		},
		buyerPrivateKey,
	)
}

function expectNoPii(value: unknown): void {
	const serialized = JSON.stringify(value)
	for (const sentinel of PII_SENTINELS) {
		expect(serialized).not.toContain(sentinel)
	}
}

describe('NIP-59 helper', () => {
	test('wraps an unsigned rumor as a signed kind 13 seal and signed kind 1059 gift wrap', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const wrapper = keyPair()
		const rumor = rumorFor(buyer.pubkey)

		const {
			rumor: normalizedRumor,
			seal,
			giftWrap,
		} = createNip59GiftWrap({
			rumor,
			senderPrivateKey: buyer.privateKey,
			recipientPubkey: seller.pubkey,
			wrapperPrivateKey: wrapper.privateKey,
			createdAt: CREATED_AT,
		})

		expect('sig' in rumor).toBe(false)
		expect(rumor.id).toBeUndefined()
		expect(normalizedRumor.id).toBe(canonicalRumorId(rumor))
		expect(seal.kind).toBe(NIP59_SEAL_KIND)
		expect(seal.tags).toEqual([])
		expect(seal.pubkey).toBe(buyer.pubkey)
		expect(verifyEvent(seal)).toBe(true)

		expect(giftWrap.kind).toBe(NIP59_GIFT_WRAP_KIND)
		expect(giftWrap.pubkey).toBe(wrapper.pubkey)
		expect(verifyEvent(giftWrap)).toBe(true)
		expect(giftWrap.tags).toEqual([['p', seller.pubkey]])
		expectNoPii(giftWrap)
		expect(JSON.stringify(giftWrap)).not.toContain('Satoshi Nakamoto')

		const unwrapped = unwrapNip59GiftWrap({
			giftWrap,
			recipientPrivateKey: seller.privateKey,
			expectedRecipientPubkey: seller.pubkey,
			expectedSenderPubkey: buyer.pubkey,
		})

		expect(unwrapped.seal.id).toBe(seal.id)
		expect(unwrapped.rumor).toEqual(normalizedRumor)
		expect(unwrapped.seal.pubkey).toBe(unwrapped.rumor.pubkey)
	})

	test('accepts a rumor with a correct id', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const rumor = rumorFor(buyer.pubkey)
		const rumorWithId = { ...rumor, id: canonicalRumorId(rumor) }

		const { rumor: normalizedRumor } = createNip59GiftWrap({
			rumor: rumorWithId,
			senderPrivateKey: buyer.privateKey,
			recipientPubkey: seller.pubkey,
			createdAt: CREATED_AT,
		})

		expect(normalizedRumor).toEqual(rumorWithId)
	})

	test('normalizes a missing rumor id before encrypting the seal', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const rawRumor = rumorFor(buyer.pubkey)

		const { rumor: normalizedRumor, giftWrap } = createNip59GiftWrap({
			rumor: rawRumor,
			senderPrivateKey: buyer.privateKey,
			recipientPubkey: seller.pubkey,
			createdAt: CREATED_AT,
		})
		const unwrapped = unwrapNip59GiftWrap({
			giftWrap,
			recipientPrivateKey: seller.privateKey,
			expectedRecipientPubkey: seller.pubkey,
			expectedSenderPubkey: buyer.pubkey,
		})

		expect(rawRumor.id).toBeUndefined()
		expect(normalizedRumor.id).toBe(canonicalRumorId(rawRumor))
		expect(unwrapped.rumor).toEqual(normalizedRumor)
		expect(unwrapped.rumor).not.toEqual(rawRumor)
	})

	test('rejects a rumor with an incorrect id', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const invalidRumor = { ...rumorFor(buyer.pubkey), id: '0'.repeat(64) }

		expect(() =>
			createNip59GiftWrap({
				rumor: invalidRumor,
				senderPrivateKey: buyer.privateKey,
				recipientPubkey: seller.pubkey,
				createdAt: CREATED_AT,
			}),
		).toThrow('NIP-59 rumor id is invalid')
	})

	test('rejects decrypted rumor with an incorrect id', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const wrapper = keyPair()
		const invalidRumor = { ...rumorFor(buyer.pubkey), id: '0'.repeat(64) }
		const seal = sealForRumor(invalidRumor, buyer.privateKey, seller.pubkey)
		const giftWrap = giftWrapForSeal(seal, wrapper.privateKey, seller.pubkey)

		expect(() =>
			unwrapNip59GiftWrap({
				giftWrap,
				recipientPrivateKey: seller.privateKey,
				expectedRecipientPubkey: seller.pubkey,
				expectedSenderPubkey: buyer.pubkey,
			}),
		).toThrow('NIP-59 rumor id is invalid')
	})

	test('normalizes without mutating caller-owned rumor objects', () => {
		const buyer = keyPair()
		const rumor = rumorFor(buyer.pubkey)
		const normalizedRumor = normalizeUnsignedRumorId(rumor)

		expect(rumor.id).toBeUndefined()
		expect(normalizedRumor.id).toBe(canonicalRumorId(rumor))
		expect(normalizedRumor).not.toBe(rumor)
		expect(normalizedRumor.tags).not.toBe(rumor.tags)
	})

	test('non-recipient cannot decrypt', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const nonRecipient = keyPair()
		const { giftWrap } = createNip59GiftWrap({
			rumor: rumorFor(buyer.pubkey),
			senderPrivateKey: buyer.privateKey,
			recipientPubkey: seller.pubkey,
			createdAt: CREATED_AT,
		})

		expect(() =>
			unwrapNip59GiftWrap({
				giftWrap,
				recipientPrivateKey: nonRecipient.privateKey,
				expectedRecipientPubkey: nonRecipient.pubkey,
				expectedSenderPubkey: buyer.pubkey,
			}),
		).toThrow()
	})

	test('rejects malformed seal', () => {
		const seller = keyPair()
		const wrapper = keyPair()
		const malformedGiftWrap = giftWrapForSeal({ kind: NIP59_SEAL_KIND }, wrapper.privateKey, seller.pubkey)

		expect(() =>
			unwrapNip59GiftWrap({
				giftWrap: malformedGiftWrap,
				recipientPrivateKey: seller.privateKey,
				expectedRecipientPubkey: seller.pubkey,
			}),
		).toThrow('Malformed NIP-59 seal')
	})

	test('rejects seal with non-empty tags', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const wrapper = keyPair()
		const seal = sealForRumor(rumorFor(buyer.pubkey), buyer.privateKey, seller.pubkey, [['p', seller.pubkey]])
		const giftWrap = giftWrapForSeal(seal, wrapper.privateKey, seller.pubkey)

		expect(() =>
			unwrapNip59GiftWrap({
				giftWrap,
				recipientPrivateKey: seller.privateKey,
				expectedRecipientPubkey: seller.pubkey,
				expectedSenderPubkey: buyer.pubkey,
			}),
		).toThrow('NIP-59 seal tags must be empty')
	})

	test('rejects invalid seal signature', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const wrapper = keyPair()
		const seal = sealForRumor(rumorFor(buyer.pubkey), buyer.privateKey, seller.pubkey)
		const tamperedSeal = { ...seal, content: `${seal.content}x` }
		const giftWrap = giftWrapForSeal(tamperedSeal, wrapper.privateKey, seller.pubkey)

		expect(() =>
			unwrapNip59GiftWrap({
				giftWrap,
				recipientPrivateKey: seller.privateKey,
				expectedRecipientPubkey: seller.pubkey,
				expectedSenderPubkey: buyer.pubkey,
			}),
		).toThrow('Invalid NIP-59 seal signature')
	})

	test('rejects invalid gift wrap signature', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const { giftWrap } = createNip59GiftWrap({
			rumor: rumorFor(buyer.pubkey),
			senderPrivateKey: buyer.privateKey,
			recipientPubkey: seller.pubkey,
			createdAt: CREATED_AT,
		})

		const tamperedGiftWrap = { ...giftWrap, content: `${giftWrap.content}x` }

		expect(() =>
			unwrapNip59GiftWrap({
				giftWrap: tamperedGiftWrap,
				recipientPrivateKey: seller.privateKey,
				expectedRecipientPubkey: seller.pubkey,
				expectedSenderPubkey: buyer.pubkey,
			}),
		).toThrow('Invalid NIP-59 gift wrap signature')
	})

	test('rejects signed rumor', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const signedRumor = { ...rumorFor(buyer.pubkey), sig: '0'.repeat(128) }

		expect(() =>
			createNip59GiftWrap({
				rumor: signedRumor,
				senderPrivateKey: buyer.privateKey,
				recipientPubkey: seller.pubkey,
				createdAt: CREATED_AT,
			}),
		).toThrow('NIP-59 rumor must be unsigned')

		const wrapper = keyPair()
		const seal = sealForRumor(signedRumor, buyer.privateKey, seller.pubkey)
		const giftWrap = giftWrapForSeal(seal, wrapper.privateKey, seller.pubkey)

		expect(() =>
			unwrapNip59GiftWrap({
				giftWrap,
				recipientPrivateKey: seller.privateKey,
				expectedRecipientPubkey: seller.pubkey,
				expectedSenderPubkey: buyer.pubkey,
			}),
		).toThrow('NIP-59 rumor must be unsigned')
	})

	test('rejects mismatched seller pubkey', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const otherSeller = keyPair()
		const { giftWrap } = createNip59GiftWrap({
			rumor: rumorFor(buyer.pubkey),
			senderPrivateKey: buyer.privateKey,
			recipientPubkey: seller.pubkey,
			createdAt: CREATED_AT,
		})

		expect(() =>
			unwrapNip59GiftWrap({
				giftWrap,
				recipientPrivateKey: seller.privateKey,
				expectedRecipientPubkey: otherSeller.pubkey,
				expectedSenderPubkey: buyer.pubkey,
			}),
		).toThrow('NIP-59 gift wrap recipient mismatch')
	})

	test('rejects mismatched buyer pubkey', () => {
		const buyer = keyPair()
		const seller = keyPair()
		const otherBuyer = keyPair()
		const { giftWrap } = createNip59GiftWrap({
			rumor: rumorFor(buyer.pubkey),
			senderPrivateKey: buyer.privateKey,
			recipientPubkey: seller.pubkey,
			createdAt: CREATED_AT,
		})

		expect(() =>
			unwrapNip59GiftWrap({
				giftWrap,
				recipientPrivateKey: seller.privateKey,
				expectedRecipientPubkey: seller.pubkey,
				expectedSenderPubkey: otherBuyer.pubkey,
			}),
		).toThrow('NIP-59 seal sender mismatch')
	})
})
