import { NDKUser, type NDKEncryptionScheme, type NDKSigner } from '@nostr-dev-kit/ndk'
import { describe, expect, test } from 'bun:test'
import { finalizeEvent, getEventHash, getPublicKey, nip44, verifyEvent } from 'nostr-tools'
import { NIP59_GIFT_WRAP_KIND, NIP59_SEAL_KIND, unwrapNip59GiftWrapWithSigner, type UnsignedRumor } from '../nostr/nip59'
import { createNip17GiftWrapsWithSigner, randomizeNip17CreatedAt } from '../nostr/nip17'

const CREATED_AT = 1_700_000_000
const PUBLIC_DATA_SENTINELS = [
	'buyer@example.com',
	'123 Main Street',
	'Satoshi Nakamoto',
	'+15551234567',
	'order-123',
	'lnbc-secret-invoice',
	'preimage-secret',
]

type KeyPair = {
	privateKey: Uint8Array
	pubkey: string
}

type MockSignerOptions = {
	supportsNip44?: boolean
	canEncrypt?: boolean
	canDecrypt?: boolean
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
			if (options.supportsNip44 === false || options.canEncrypt === false || scheme !== 'nip44') {
				throw new Error('NIP-44 unavailable')
			}
			const conversationKey = nip44.v2.utils.getConversationKey(privateKey, recipient.pubkey)
			return nip44.v2.encrypt(value, conversationKey)
		},
		decrypt: async (sender, value, scheme) => {
			if (options.supportsNip44 === false || options.canDecrypt === false || scheme !== 'nip44') {
				throw new Error('NIP-44 unavailable')
			}
			const conversationKey = nip44.v2.utils.getConversationKey(privateKey, sender.pubkey)
			return nip44.v2.decrypt(value, conversationKey)
		},
		sign: async (event) => finalizeEvent(event as unknown as Parameters<typeof finalizeEvent>[0], privateKey).sig,
		toPayload: () => JSON.stringify({ type: 'mock' }),
	}
}

function rumorFor(buyerPubkey: string, sellerPubkey: string): UnsignedRumor {
	return {
		kind: 16,
		pubkey: buyerPubkey,
		created_at: CREATED_AT,
		tags: [
			['p', sellerPubkey],
			['subject', 'order-info'],
			['type', '1'],
			['order', 'order-123'],
			['amount', '2100'],
			['payment', 'lightning', 'lnbc-secret-invoice', 'preimage-secret'],
		],
		content: 'Satoshi Nakamoto buyer@example.com +15551234567 123 Main Street',
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

function expectNoPublicOrderData(value: unknown): void {
	const serialized = JSON.stringify(value)
	for (const sentinel of PUBLIC_DATA_SENTINELS) {
		expect(serialized).not.toContain(sentinel)
	}
}

describe('NIP-17 gift wrapping boundary', () => {
	test('creates recipient and sender self-wraps for the same unsigned rumor', async () => {
		const buyer = keyPair()
		const seller = keyPair()
		const recipientWrapper = keyPair()
		const senderWrapper = keyPair()
		const rumor = rumorFor(buyer.pubkey, seller.pubkey)

		const result = await createNip17GiftWrapsWithSigner({
			rumor,
			signer: signerFor(buyer.privateKey),
			recipientPubkey: seller.pubkey,
			recipientWrapperPrivateKey: recipientWrapper.privateKey,
			senderWrapperPrivateKey: senderWrapper.privateKey,
			createdAt: CREATED_AT,
		})

		expect(result.rumor.id).toBe(canonicalRumorId(rumor))
		expect(result.rumor.created_at).toBe(CREATED_AT)
		expect('sig' in result.rumor).toBe(false)

		expect(result.recipient.seal.kind).toBe(NIP59_SEAL_KIND)
		expect(result.recipient.seal.created_at).toBe(CREATED_AT)
		expect(result.recipient.seal.tags).toEqual([])
		expect(result.recipient.seal.pubkey).toBe(buyer.pubkey)
		expect(verifyEvent(result.recipient.seal)).toBe(true)

		expect(result.recipient.giftWrap.kind).toBe(NIP59_GIFT_WRAP_KIND)
		expect(result.recipient.giftWrap.created_at).toBe(CREATED_AT)
		expect(result.recipient.giftWrap.pubkey).toBe(recipientWrapper.pubkey)
		expect(result.recipient.giftWrap.tags).toEqual([['p', seller.pubkey]])
		expect(verifyEvent(result.recipient.giftWrap)).toBe(true)
		expectNoPublicOrderData(result.recipient.giftWrap)

		expect(result.sender.seal.kind).toBe(NIP59_SEAL_KIND)
		expect(result.sender.seal.created_at).toBe(CREATED_AT)
		expect(result.sender.seal.tags).toEqual([])
		expect(result.sender.seal.pubkey).toBe(buyer.pubkey)
		expect(verifyEvent(result.sender.seal)).toBe(true)

		expect(result.sender.giftWrap.kind).toBe(NIP59_GIFT_WRAP_KIND)
		expect(result.sender.giftWrap.created_at).toBe(CREATED_AT)
		expect(result.sender.giftWrap.pubkey).toBe(senderWrapper.pubkey)
		expect(result.sender.giftWrap.tags).toEqual([['p', buyer.pubkey]])
		expect(verifyEvent(result.sender.giftWrap)).toBe(true)
		expectNoPublicOrderData(result.sender.giftWrap)

		const recipientUnwrapped = await unwrapNip59GiftWrapWithSigner({
			giftWrap: result.recipient.giftWrap,
			signer: signerFor(seller.privateKey),
			expectedRecipientPubkey: seller.pubkey,
			expectedSenderPubkey: buyer.pubkey,
		})

		const senderUnwrapped = await unwrapNip59GiftWrapWithSigner({
			giftWrap: result.sender.giftWrap,
			signer: signerFor(buyer.privateKey),
			expectedRecipientPubkey: buyer.pubkey,
			expectedSenderPubkey: buyer.pubkey,
		})

		expect(recipientUnwrapped.seal.id).toBe(result.recipient.seal.id)
		expect(senderUnwrapped.seal.id).toBe(result.sender.seal.id)
		expect(recipientUnwrapped.rumor).toEqual(result.rumor)
		expect(senderUnwrapped.rumor).toEqual(result.rumor)
	})

	test('randomizes created_at up to two days in the past', () => {
		const now = 1_700_200_000

		expect(randomizeNip17CreatedAt(now, () => 0)).toBe(now)
		expect(randomizeNip17CreatedAt(now, () => 0.5)).toBe(now - 86_400)
		expect(randomizeNip17CreatedAt(now, () => 0.999999)).toBe(now - 172_800)
	})

	test('fails closed when signer does not support NIP-44 encrypt', async () => {
		const buyer = keyPair()
		const seller = keyPair()

		await expect(
			createNip17GiftWrapsWithSigner({
				rumor: rumorFor(buyer.pubkey, seller.pubkey),
				signer: signerFor(buyer.privateKey, { supportsNip44: false }),
				recipientPubkey: seller.pubkey,
				createdAt: CREATED_AT,
			}),
		).rejects.toThrow('Signer does not support NIP-44 encrypt')
	})
})
