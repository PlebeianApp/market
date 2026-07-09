import { NDKUser, type NDKEncryptionScheme, type NDKSigner } from '@nostr-dev-kit/ndk'
import { describe, expect, test } from 'bun:test'
import { finalizeEvent, getEventHash, getPublicKey, nip44, verifyEvent } from 'nostr-tools'
import type { Event } from 'nostr-tools'
import {
	createNip59GiftWrap,
	createNip59GiftWrapWithSigner,
	NIP59_GIFT_WRAP_KIND,
	NIP59_SEAL_KIND,
	normalizeUnsignedRumorId,
	signerSupportsNip44,
	unwrapNip59GiftWrap,
	unwrapNip59GiftWrapWithSigner,
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

type MockSignerOptions = {
	supportsNip44?: boolean
	canEncrypt?: boolean
	canDecrypt?: boolean
	encryptionEnabledThrows?: boolean
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
			if (options.encryptionEnabledThrows) throw new Error('capability check failed')
			if (options.supportsNip44 === false) return []
			if (!scheme || scheme === 'nip44') return ['nip44']
			return []
		},
		encrypt: async (recipient, value, scheme) => {
			if (options.supportsNip44 === false || options.canEncrypt === false || scheme !== 'nip44') throw new Error('NIP-44 unavailable')
			return encryptForRecipient(value, privateKey, recipient.pubkey)
		},
		decrypt: async (sender, value, scheme) => {
			if (options.supportsNip44 === false || options.canDecrypt === false || scheme !== 'nip44') throw new Error('NIP-44 unavailable')
			return decryptFromSender(value, privateKey, sender.pubkey)
		},
		sign: async (event) => finalizeEvent(event as unknown as Parameters<typeof finalizeEvent>[0], privateKey).sig,
		toPayload: () => JSON.stringify({ type: 'mock' }),
	}
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

function decryptFromSender(ciphertext: string, recipientPrivateKey: Uint8Array, senderPubkey: string): string {
	const conversationKey = nip44.v2.utils.getConversationKey(recipientPrivateKey, senderPubkey)
	return nip44.v2.decrypt(ciphertext, conversationKey)
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

	test('signer-backed helper creates a valid kind 13 seal and kind 1059 gift wrap', async () => {
		const buyer = keyPair()
		const seller = keyPair()
		const wrapper = keyPair()
		const rumor = rumorFor(buyer.pubkey)
		const signer = signerFor(buyer.privateKey)

		const {
			rumor: normalizedRumor,
			seal,
			giftWrap,
		} = await createNip59GiftWrapWithSigner({
			rumor,
			signer,
			recipientPubkey: seller.pubkey,
			wrapperPrivateKey: wrapper.privateKey,
			createdAt: CREATED_AT,
		})

		expect(normalizedRumor.id).toBe(canonicalRumorId(rumor))
		expect(seal.kind).toBe(NIP59_SEAL_KIND)
		expect(seal.tags).toEqual([])
		expect(seal.pubkey).toBe(buyer.pubkey)
		expect(verifyEvent(seal)).toBe(true)
		expect(giftWrap.kind).toBe(NIP59_GIFT_WRAP_KIND)
		expect(giftWrap.pubkey).toBe(wrapper.pubkey)
		expect(giftWrap.tags).toEqual([['p', seller.pubkey]])
		expect(verifyEvent(giftWrap)).toBe(true)
		expectNoPii(giftWrap)

		const unwrapped = await unwrapNip59GiftWrapWithSigner({
			giftWrap,
			signer: signerFor(seller.privateKey),
			expectedRecipientPubkey: seller.pubkey,
			expectedSenderPubkey: buyer.pubkey,
		})

		expect(unwrapped.seal.id).toBe(seal.id)
		expect(unwrapped.rumor).toEqual(normalizedRumor)
	})

	test('signer with encrypt support but no decrypt support can create a valid gift wrap', async () => {
		const buyer = keyPair()
		const seller = keyPair()
		const signer = { ...signerFor(buyer.privateKey), decrypt: undefined } as unknown as NDKSigner

		await expect(signerSupportsNip44(signer, 'encrypt')).resolves.toBe(true)
		await expect(signerSupportsNip44(signer, 'decrypt')).resolves.toBe(false)

		const { giftWrap, seal } = await createNip59GiftWrapWithSigner({
			rumor: rumorFor(buyer.pubkey),
			signer,
			recipientPubkey: seller.pubkey,
			createdAt: CREATED_AT,
		})

		expect(seal.kind).toBe(NIP59_SEAL_KIND)
		expect(verifyEvent(seal)).toBe(true)
		expect(giftWrap.kind).toBe(NIP59_GIFT_WRAP_KIND)
		expect(giftWrap.tags).toEqual([['p', seller.pubkey]])
		expectNoPii(giftWrap)
	})

	test('signer with decrypt support but no encrypt support can unwrap a valid gift wrap', async () => {
		const buyer = keyPair()
		const seller = keyPair()
		const { giftWrap, rumor } = createNip59GiftWrap({
			rumor: rumorFor(buyer.pubkey),
			senderPrivateKey: buyer.privateKey,
			recipientPubkey: seller.pubkey,
			createdAt: CREATED_AT,
		})
		const signer = { ...signerFor(seller.privateKey), encrypt: undefined } as unknown as NDKSigner

		await expect(signerSupportsNip44(signer, 'encrypt')).resolves.toBe(false)
		await expect(signerSupportsNip44(signer, 'decrypt')).resolves.toBe(true)

		const unwrapped = await unwrapNip59GiftWrapWithSigner({
			giftWrap,
			signer,
			expectedRecipientPubkey: seller.pubkey,
			expectedSenderPubkey: buyer.pubkey,
		})

		expect(unwrapped.rumor).toEqual(rumor)
		expect(unwrapped.seal.pubkey).toBe(buyer.pubkey)
	})

	test('signer-backed helper fails closed when NIP-44 encrypt is unavailable', async () => {
		const buyer = keyPair()
		const seller = keyPair()
		const signer = signerFor(buyer.privateKey, { supportsNip44: false })

		await expect(signerSupportsNip44(signer, 'encrypt')).resolves.toBe(false)
		await expect(
			createNip59GiftWrapWithSigner({
				rumor: rumorFor(buyer.pubkey),
				signer,
				recipientPubkey: seller.pubkey,
				createdAt: CREATED_AT,
			}),
		).rejects.toThrow('Signer does not support NIP-44 encrypt')
	})

	test('signer-backed helper fails closed when NIP-44 encrypt throws', async () => {
		const buyer = keyPair()
		const seller = keyPair()
		const signer = signerFor(buyer.privateKey, { canEncrypt: false })

		await expect(signerSupportsNip44(signer, 'encrypt')).resolves.toBe(true)
		await expect(
			createNip59GiftWrapWithSigner({
				rumor: rumorFor(buyer.pubkey),
				signer,
				recipientPubkey: seller.pubkey,
				createdAt: CREATED_AT,
			}),
		).rejects.toThrow('NIP-44 encryption failed for NIP-59 seal')
	})

	test('signer-backed helper fails closed when NIP-44 capability checks are unavailable', async () => {
		const buyer = keyPair()
		const seller = keyPair()
		const signer: NDKSigner = { ...signerFor(buyer.privateKey), encryptionEnabled: undefined }

		await expect(signerSupportsNip44(signer, 'encrypt')).resolves.toBe(false)
		await expect(
			createNip59GiftWrapWithSigner({
				rumor: rumorFor(buyer.pubkey),
				signer,
				recipientPubkey: seller.pubkey,
				createdAt: CREATED_AT,
			}),
		).rejects.toThrow('Signer does not support NIP-44 encrypt')
	})

	test('operation-specific capability helper returns false when NIP-44 capability check throws', async () => {
		const buyer = keyPair()
		const signer = signerFor(buyer.privateKey, { encryptionEnabledThrows: true })

		await expect(signerSupportsNip44(signer, 'encrypt')).resolves.toBe(false)
		await expect(signerSupportsNip44(signer, 'decrypt')).resolves.toBe(false)
	})

	test('signer-backed unwrap fails closed when NIP-44 decrypt is unavailable', async () => {
		const buyer = keyPair()
		const seller = keyPair()
		const { giftWrap } = createNip59GiftWrap({
			rumor: rumorFor(buyer.pubkey),
			senderPrivateKey: buyer.privateKey,
			recipientPubkey: seller.pubkey,
			createdAt: CREATED_AT,
		})

		await expect(
			unwrapNip59GiftWrapWithSigner({
				giftWrap,
				signer: signerFor(seller.privateKey, { supportsNip44: false }),
				expectedRecipientPubkey: seller.pubkey,
				expectedSenderPubkey: buyer.pubkey,
			}),
		).rejects.toThrow('Signer does not support NIP-44 decrypt')
	})

	test('signer-backed unwrap fails closed when NIP-44 decrypt throws', async () => {
		const buyer = keyPair()
		const seller = keyPair()
		const { giftWrap } = createNip59GiftWrap({
			rumor: rumorFor(buyer.pubkey),
			senderPrivateKey: buyer.privateKey,
			recipientPubkey: seller.pubkey,
			createdAt: CREATED_AT,
		})
		const signer = signerFor(seller.privateKey, { canDecrypt: false })

		await expect(signerSupportsNip44(signer, 'decrypt')).resolves.toBe(true)
		await expect(
			unwrapNip59GiftWrapWithSigner({
				giftWrap,
				signer,
				expectedRecipientPubkey: seller.pubkey,
				expectedSenderPubkey: buyer.pubkey,
			}),
		).rejects.toThrow('NIP-44 decryption failed for NIP-59 gift wrap')
	})

	test('signer-backed helper requires signer pubkey to match rumor pubkey', async () => {
		const buyer = keyPair()
		const otherBuyer = keyPair()
		const seller = keyPair()

		await expect(
			createNip59GiftWrapWithSigner({
				rumor: rumorFor(buyer.pubkey),
				signer: signerFor(otherBuyer.privateKey),
				recipientPubkey: seller.pubkey,
				createdAt: CREATED_AT,
			}),
		).rejects.toThrow('NIP-59 rumor pubkey must match the signer pubkey')
	})

	test('signer-backed creation fails closed when signing is unavailable or invalid', async () => {
		const buyer = keyPair()
		const seller = keyPair()
		const signerWithoutSign = { ...signerFor(buyer.privateKey), sign: undefined } as unknown as NDKSigner

		await expect(
			createNip59GiftWrapWithSigner({
				rumor: rumorFor(buyer.pubkey),
				signer: signerWithoutSign,
				recipientPubkey: seller.pubkey,
				createdAt: CREATED_AT,
			}),
		).rejects.toThrow('Signer does not support signing NIP-59 seal')

		await expect(
			createNip59GiftWrapWithSigner({
				rumor: rumorFor(buyer.pubkey),
				signer: { ...signerFor(buyer.privateKey), sign: async () => Promise.reject(new Error('sign failed')) },
				recipientPubkey: seller.pubkey,
				createdAt: CREATED_AT,
			}),
		).rejects.toThrow('Failed to sign NIP-59 seal')

		await expect(
			createNip59GiftWrapWithSigner({
				rumor: rumorFor(buyer.pubkey),
				signer: { ...signerFor(buyer.privateKey), sign: async () => '0'.repeat(128) },
				recipientPubkey: seller.pubkey,
				createdAt: CREATED_AT,
			}),
		).rejects.toThrow('Invalid NIP-59 seal signature')
	})

	test('signer-backed unwrap does not call signer.sign', async () => {
		const buyer = keyPair()
		const seller = keyPair()
		const { giftWrap, rumor } = createNip59GiftWrap({
			rumor: rumorFor(buyer.pubkey),
			senderPrivateKey: buyer.privateKey,
			recipientPubkey: seller.pubkey,
			createdAt: CREATED_AT,
		})
		let signCalls = 0
		const signer = {
			...signerFor(seller.privateKey),
			encrypt: undefined,
			sign: async () => {
				signCalls += 1
				throw new Error('unwrap must not sign')
			},
		} as unknown as NDKSigner

		const unwrapped = await unwrapNip59GiftWrapWithSigner({
			giftWrap,
			signer,
			expectedRecipientPubkey: seller.pubkey,
			expectedSenderPubkey: buyer.pubkey,
		})

		expect(unwrapped.rumor).toEqual(rumor)
		expect(signCalls).toBe(0)
	})

	test('signer-backed unwrap verifies signatures and canonical rumor id', async () => {
		const buyer = keyPair()
		const seller = keyPair()
		const wrapper = keyPair()
		const invalidRumor = { ...rumorFor(buyer.pubkey), id: '0'.repeat(64) }
		const sealWithInvalidRumor = sealForRumor(invalidRumor, buyer.privateKey, seller.pubkey)
		const giftWrapWithInvalidRumor = giftWrapForSeal(sealWithInvalidRumor, wrapper.privateKey, seller.pubkey)

		await expect(
			unwrapNip59GiftWrapWithSigner({
				giftWrap: giftWrapWithInvalidRumor,
				signer: signerFor(seller.privateKey),
				expectedRecipientPubkey: seller.pubkey,
				expectedSenderPubkey: buyer.pubkey,
			}),
		).rejects.toThrow('NIP-59 rumor id is invalid')

		const seal = sealForRumor(rumorFor(buyer.pubkey), buyer.privateKey, seller.pubkey)
		const giftWrapWithInvalidSeal = giftWrapForSeal({ ...seal, content: `${seal.content}x` }, wrapper.privateKey, seller.pubkey)
		await expect(
			unwrapNip59GiftWrapWithSigner({
				giftWrap: giftWrapWithInvalidSeal,
				signer: signerFor(seller.privateKey),
				expectedRecipientPubkey: seller.pubkey,
				expectedSenderPubkey: buyer.pubkey,
			}),
		).rejects.toThrow('Invalid NIP-59 seal signature')

		const { giftWrap } = createNip59GiftWrap({
			rumor: rumorFor(buyer.pubkey),
			senderPrivateKey: buyer.privateKey,
			recipientPubkey: seller.pubkey,
			createdAt: CREATED_AT,
		})
		await expect(
			unwrapNip59GiftWrapWithSigner({
				giftWrap: { ...giftWrap, content: `${giftWrap.content}x` },
				signer: signerFor(seller.privateKey),
				expectedRecipientPubkey: seller.pubkey,
				expectedSenderPubkey: buyer.pubkey,
			}),
		).rejects.toThrow('Invalid NIP-59 gift wrap signature')
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
