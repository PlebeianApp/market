import type { NDKSigner } from '@nostr-dev-kit/ndk'
import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey, nip44, type Event } from 'nostr-tools'
import { NIP59_GIFT_WRAP_KIND } from '../nostr/nip59'
import { NIP17_DM_RELAY_LIST_KIND, type Nip17DmRelayListEvent } from '../nostr/nip17Relays'
import { publishNip17OrderMessage } from '../orders/nip17OrderPublish'
import { createOrderCreationRumor } from '../orders/orderMessageRumor'

type PublishCall = {
	target: 'recipient' | 'sender'
	relays: string[]
	giftWrap: Event
}

const ORDER_SENTINEL = 'order-secret-123'
const PRODUCT_SENTINEL = 'secret-coffee-dtag'

function relayListEvent(pubkey: string, relays: string[], createdAt = 100): Nip17DmRelayListEvent {
	return {
		id: `${pubkey}-${createdAt}`,
		kind: NIP17_DM_RELAY_LIST_KIND,
		pubkey,
		created_at: createdAt,
		tags: relays.map((relay) => ['relay', relay]),
		content: '',
	}
}

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

function expectNoPublicOrderSentinels(value: unknown): void {
	const serialized = JSON.stringify(value)
	for (const sentinel of [ORDER_SENTINEL, PRODUCT_SENTINEL]) {
		expect(serialized).not.toContain(sentinel)
	}
}

describe('NIP-17 order publish boundary', () => {
	test('publishes recipient and sender gift wraps only to their kind 10050 relays', async () => {
		const senderPrivateKey = generateSecretKey()
		const senderPubkey = getPublicKey(senderPrivateKey)
		const recipientPubkey = getPublicKey(generateSecretKey())
		const calls: PublishCall[] = []

		const rumor = createOrderCreationRumor({
			buyerPubkey: senderPubkey,
			merchantPubkey: recipientPubkey,
			orderId: ORDER_SENTINEL,
			amountSats: 2100,
			items: [{ productRef: `30402:${recipientPubkey}:${PRODUCT_SENTINEL}`, quantity: 2 }],
			createdAt: 123456,
		})

		const result = await publishNip17OrderMessage({
			rumor,
			signer: createSigner(senderPrivateKey),
			recipientPubkey,
			recipientRelayEvents: [relayListEvent(recipientPubkey, ['wss://recipient.example'])],
			senderRelayEvents: [relayListEvent(senderPubkey, ['wss://sender.example'])],
			publishGiftWrap: async ({ target, relays, giftWrap }) => {
				calls.push({ target, relays, giftWrap })
				return new Set(relays)
			},
		})

		expect(result.rumorId).toBe(rumor.id)
		expect(result.relayTargets.ready).toBe(true)
		expect(calls).toHaveLength(2)

		const recipientCall = calls.find((call) => call.target === 'recipient')
		const senderCall = calls.find((call) => call.target === 'sender')

		expect(recipientCall?.relays).toEqual(['wss://recipient.example'])
		expect(senderCall?.relays).toEqual(['wss://sender.example'])

		expect(recipientCall?.giftWrap.kind).toBe(NIP59_GIFT_WRAP_KIND)
		expect(senderCall?.giftWrap.kind).toBe(NIP59_GIFT_WRAP_KIND)
		expect(recipientCall?.giftWrap.tags).toContainEqual(['p', recipientPubkey])
		expect(senderCall?.giftWrap.tags).toContainEqual(['p', senderPubkey])

		expect(calls.some((call) => call.giftWrap.kind === rumor.kind)).toBe(false)
		expectNoPublicOrderSentinels(calls.map((call) => call.giftWrap))
	})

	test('fails closed without publishing when recipient or sender kind 10050 relays are missing', async () => {
		const senderPrivateKey = generateSecretKey()
		const senderPubkey = getPublicKey(senderPrivateKey)
		const recipientPubkey = getPublicKey(generateSecretKey())
		const calls: PublishCall[] = []

		const rumor = createOrderCreationRumor({
			buyerPubkey: senderPubkey,
			merchantPubkey: recipientPubkey,
			orderId: ORDER_SENTINEL,
			amountSats: 2100,
			items: [{ productRef: `30402:${recipientPubkey}:${PRODUCT_SENTINEL}`, quantity: 1 }],
			createdAt: 123456,
		})

		await expect(
			publishNip17OrderMessage({
				rumor,
				signer: createSigner(senderPrivateKey),
				recipientPubkey,
				recipientRelayEvents: [],
				senderRelayEvents: [relayListEvent(senderPubkey, ['wss://sender.example'])],
				publishGiftWrap: async ({ target, relays, giftWrap }) => {
					calls.push({ target, relays, giftWrap })
					return new Set(relays)
				},
			}),
		).rejects.toThrow('NIP-17 relay targets are not ready')

		expect(calls).toHaveLength(0)
	})

	test('fails closed without publishing when the signer does not match the rumor author', async () => {
		const rumorAuthorPrivateKey = generateSecretKey()
		const signerPrivateKey = generateSecretKey()
		const rumorAuthorPubkey = getPublicKey(rumorAuthorPrivateKey)
		const signerPubkey = getPublicKey(signerPrivateKey)
		const recipientPubkey = getPublicKey(generateSecretKey())
		const calls: PublishCall[] = []

		const rumor = createOrderCreationRumor({
			buyerPubkey: rumorAuthorPubkey,
			merchantPubkey: recipientPubkey,
			orderId: ORDER_SENTINEL,
			amountSats: 2100,
			items: [{ productRef: `30402:${recipientPubkey}:${PRODUCT_SENTINEL}`, quantity: 1 }],
			createdAt: 123456,
		})

		await expect(
			publishNip17OrderMessage({
				rumor,
				signer: createSigner(signerPrivateKey),
				recipientPubkey,
				recipientRelayEvents: [relayListEvent(recipientPubkey, ['wss://recipient.example'])],
				senderRelayEvents: [relayListEvent(signerPubkey, ['wss://sender.example'])],
				publishGiftWrap: async ({ target, relays, giftWrap }) => {
					calls.push({ target, relays, giftWrap })
					return new Set(relays)
				},
			}),
		).rejects.toThrow('NIP-17 order rumor pubkey does not match signer pubkey')

		expect(calls).toHaveLength(0)
	})
	test('fails when a gift wrap publish returns no relay success', async () => {
		const senderPrivateKey = generateSecretKey()
		const senderPubkey = getPublicKey(senderPrivateKey)
		const recipientPubkey = getPublicKey(generateSecretKey())
		const calls: PublishCall[] = []

		const rumor = createOrderCreationRumor({
			buyerPubkey: senderPubkey,
			merchantPubkey: recipientPubkey,
			orderId: ORDER_SENTINEL,
			amountSats: 2100,
			items: [{ productRef: `30402:${recipientPubkey}:${PRODUCT_SENTINEL}`, quantity: 1 }],
			createdAt: 123456,
		})

		await expect(
			publishNip17OrderMessage({
				rumor,
				signer: createSigner(senderPrivateKey),
				recipientPubkey,
				recipientRelayEvents: [relayListEvent(recipientPubkey, ['wss://recipient.example'])],
				senderRelayEvents: [relayListEvent(senderPubkey, ['wss://sender.example'])],
				publishGiftWrap: async ({ target, relays, giftWrap }) => {
					calls.push({ target, relays, giftWrap })
					return new Set()
				},
			}),
		).rejects.toThrow('NIP-17 recipient gift wrap could not be published')

		expect(calls).toHaveLength(1)
		expect(calls[0]?.target).toBe('recipient')
	})
	test('fails closed without publishing when the rumor recipient does not match recipientPubkey', async () => {
		const senderPrivateKey = generateSecretKey()
		const senderPubkey = getPublicKey(senderPrivateKey)
		const intendedRecipientPubkey = getPublicKey(generateSecretKey())
		const wrongRecipientPubkey = getPublicKey(generateSecretKey())
		const calls: PublishCall[] = []

		const rumor = createOrderCreationRumor({
			buyerPubkey: senderPubkey,
			merchantPubkey: intendedRecipientPubkey,
			orderId: ORDER_SENTINEL,
			amountSats: 2100,
			items: [{ productRef: `30402:${intendedRecipientPubkey}:${PRODUCT_SENTINEL}`, quantity: 1 }],
			createdAt: 123456,
		})

		await expect(
			publishNip17OrderMessage({
				rumor,
				signer: createSigner(senderPrivateKey),
				recipientPubkey: wrongRecipientPubkey,
				recipientRelayEvents: [relayListEvent(wrongRecipientPubkey, ['wss://wrong-recipient.example'])],
				senderRelayEvents: [relayListEvent(senderPubkey, ['wss://sender.example'])],
				publishGiftWrap: async ({ target, relays, giftWrap }) => {
					calls.push({ target, relays, giftWrap })
					return new Set(relays)
				},
			}),
		).rejects.toThrow('NIP-17 order rumor recipient does not match recipientPubkey')

		expect(calls).toHaveLength(0)
	})

	test('fails closed without publishing when the rumor has a malformed extra recipient p tag', async () => {
		const senderPrivateKey = generateSecretKey()
		const senderPubkey = getPublicKey(senderPrivateKey)
		const recipientPubkey = getPublicKey(generateSecretKey())
		const calls: PublishCall[] = []

		const rumor = createOrderCreationRumor({
			buyerPubkey: senderPubkey,
			merchantPubkey: recipientPubkey,
			orderId: ORDER_SENTINEL,
			amountSats: 2100,
			items: [{ productRef: `30402:${recipientPubkey}:${PRODUCT_SENTINEL}`, quantity: 1 }],
			createdAt: 123456,
		})

		await expect(
			publishNip17OrderMessage({
				rumor: {
					...rumor,
					tags: [...rumor.tags, ['p', '']],
				},
				signer: createSigner(senderPrivateKey),
				recipientPubkey,
				recipientRelayEvents: [relayListEvent(recipientPubkey, ['wss://recipient.example'])],
				senderRelayEvents: [relayListEvent(senderPubkey, ['wss://sender.example'])],
				publishGiftWrap: async ({ target, relays, giftWrap }) => {
					calls.push({ target, relays, giftWrap })
					return new Set(relays)
				},
			}),
		).rejects.toThrow('Invalid order message rumor')

		expect(calls).toHaveLength(0)
	})
})
