import type { NDKSigner } from '@nostr-dev-kit/ndk'
import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey, nip44, type Event } from 'nostr-tools'
import { createNip17GiftWrapsWithSigner } from '../nostr/nip17'
import { NIP59_GIFT_WRAP_KIND } from '../nostr/nip59'
import { unwrapNip17OrderMessage, unwrapNip17OrderMessages } from '../orders/nip17OrderRead'
import { createOrderCreationRumor, createPaymentReceiptRumor } from '../orders/orderMessageRumor'

function createSigner(privateKey: Uint8Array): NDKSigner {
	const pubkey = getPublicKey(privateKey)

	return {
		user: async () => ({ pubkey }),
		encryptionEnabled: async () => ['nip44'],
		encrypt: async (recipient: { pubkey: string }, plaintext: string) => {
			const conversationKey = nip44.v2.utils.getConversationKey(privateKey, recipient.pubkey)
			return nip44.v2.encrypt(plaintext, conversationKey)
		},
		decrypt: async (sender: { pubkey: string }, ciphertext: string) => {
			const conversationKey = nip44.v2.utils.getConversationKey(privateKey, sender.pubkey)
			return nip44.v2.decrypt(ciphertext, conversationKey)
		},
		sign: async (event: { kind: number; created_at: number; tags: string[][]; content: string }) => {
			return finalizeEvent(
				{
					kind: event.kind,
					created_at: event.created_at,
					tags: event.tags,
					content: event.content,
				},
				privateKey,
			).sig
		},
	} as unknown as NDKSigner
}

function malformedGiftWrap(recipientPubkey: string): Event {
	return finalizeEvent(
		{
			kind: NIP59_GIFT_WRAP_KIND,
			created_at: 999999,
			content: 'not-valid-nip44-ciphertext',
			tags: [['p', recipientPubkey]],
		},
		generateSecretKey(),
	)
}

describe('NIP-17 order read boundary', () => {
	test('unwraps received recipient wraps and sent sender self-wraps', async () => {
		const buyerPrivateKey = generateSecretKey()
		const sellerPrivateKey = generateSecretKey()
		const buyerPubkey = getPublicKey(buyerPrivateKey)
		const sellerPubkey = getPublicKey(sellerPrivateKey)

		const rumor = createOrderCreationRumor({
			buyerPubkey,
			merchantPubkey: sellerPubkey,
			orderId: 'order-read-123',
			amountSats: 2100,
			items: [{ productRef: `30402:${sellerPubkey}:coffee`, quantity: 1 }],
			createdAt: 123456,
		})

		const wraps = await createNip17GiftWrapsWithSigner({
			rumor,
			signer: createSigner(buyerPrivateKey),
			recipientPubkey: sellerPubkey,
			createdAt: 222222,
		})

		const received = await unwrapNip17OrderMessage({
			giftWrap: wraps.recipient.giftWrap,
			signer: createSigner(sellerPrivateKey),
		})

		expect(received.direction).toBe('received')
		expect(received.userPubkey).toBe(sellerPubkey)
		expect(received.counterpartyPubkey).toBe(buyerPubkey)
		expect(received.recipientPubkey).toBe(sellerPubkey)
		expect(received.rumor).toEqual(rumor)

		const sent = await unwrapNip17OrderMessage({
			giftWrap: wraps.sender.giftWrap,
			signer: createSigner(buyerPrivateKey),
		})

		expect(sent.direction).toBe('sent')
		expect(sent.userPubkey).toBe(buyerPubkey)
		expect(sent.counterpartyPubkey).toBe(sellerPubkey)
		expect(sent.recipientPubkey).toBe(sellerPubkey)
		expect(sent.rumor).toEqual(rumor)
	})

	test('rejects wraps where the decrypting user is not an inner order participant', async () => {
		const buyerPrivateKey = generateSecretKey()
		const sellerPubkey = getPublicKey(generateSecretKey())
		const thirdPartyPrivateKey = generateSecretKey()
		const buyerPubkey = getPublicKey(buyerPrivateKey)
		const thirdPartyPubkey = getPublicKey(thirdPartyPrivateKey)

		const rumor = createOrderCreationRumor({
			buyerPubkey,
			merchantPubkey: sellerPubkey,
			orderId: 'order-read-123',
			amountSats: 2100,
			items: [{ productRef: `30402:${sellerPubkey}:coffee`, quantity: 1 }],
			createdAt: 123456,
		})

		const wraps = await createNip17GiftWrapsWithSigner({
			rumor,
			signer: createSigner(buyerPrivateKey),
			recipientPubkey: thirdPartyPubkey,
			createdAt: 222222,
		})

		await expect(
			unwrapNip17OrderMessage({
				giftWrap: wraps.recipient.giftWrap,
				signer: createSigner(thirdPartyPrivateKey),
			}),
		).rejects.toThrow('NIP-17 order message must include the active user as exactly one side')
	})

	test('batch unwrap dedupes by inner rumor id, ignores malformed wraps, and sorts deterministically', async () => {
		const buyerPrivateKey = generateSecretKey()
		const sellerPrivateKey = generateSecretKey()
		const buyerPubkey = getPublicKey(buyerPrivateKey)
		const sellerPubkey = getPublicKey(sellerPrivateKey)

		const olderRumor = createOrderCreationRumor({
			buyerPubkey,
			merchantPubkey: sellerPubkey,
			orderId: 'order-old',
			amountSats: 1000,
			items: [{ productRef: `30402:${sellerPubkey}:old`, quantity: 1 }],
			createdAt: 100,
		})

		const newerRumor = createPaymentReceiptRumor({
			buyerPubkey,
			merchantPubkey: sellerPubkey,
			orderId: 'order-new',
			amountSats: 2000,
			payment: {
				medium: 'lightning',
				reference: 'lnbc-test',
				proof: 'preimage-test',
			},
			createdAt: 200,
		})

		const olderWraps = await createNip17GiftWrapsWithSigner({
			rumor: olderRumor,
			signer: createSigner(buyerPrivateKey),
			recipientPubkey: sellerPubkey,
			createdAt: 300,
		})

		const duplicateOlderWraps = await createNip17GiftWrapsWithSigner({
			rumor: olderRumor,
			signer: createSigner(buyerPrivateKey),
			recipientPubkey: sellerPubkey,
			createdAt: 400,
		})

		const newerWraps = await createNip17GiftWrapsWithSigner({
			rumor: newerRumor,
			signer: createSigner(buyerPrivateKey),
			recipientPubkey: sellerPubkey,
			createdAt: 500,
		})

		const messages = await unwrapNip17OrderMessages({
			giftWraps: [
				newerWraps.recipient.giftWrap,
				malformedGiftWrap(sellerPubkey),
				duplicateOlderWraps.recipient.giftWrap,
				olderWraps.recipient.giftWrap,
			],
			signer: createSigner(sellerPrivateKey),
		})

		expect(messages.map((message) => message.rumor.id)).toEqual([olderRumor.id, newerRumor.id])
		expect(messages.map((message) => message.rumor.created_at)).toEqual([100, 200])
		expect(messages.every((message) => message.direction === 'received')).toBe(true)
	})
})
