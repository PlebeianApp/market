import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey, nip44, type Event } from 'nostr-tools'
import { createNip17GiftWrapsWithSigner } from '../nostr/nip17'
import { NIP59_GIFT_WRAP_KIND } from '../nostr/nip59'
import { NIP17_DM_RELAY_LIST_KIND, type Nip17DmRelayListEvent } from '../nostr/nip17Relays'
import {
	buildNip17OrderGiftWrapFilter,
	publishNip17OrderTransportMessage,
	readNip17OrderTransportMessages,
	type FetchNip17RelayListEventsParams,
	type Nip17OrderTransportSigner,
	type PublishNip17OrderTransportGiftWrapParams,
} from '../orders/nip17OrderTransport'
import { createOrderCreationRumor, createPaymentReceiptRumor } from '../orders/orderMessageRumor'

type PublishCall = PublishNip17OrderTransportGiftWrapParams

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

function createSigner(privateKey: Uint8Array, supportsNip44 = true): Nip17OrderTransportSigner {
	const pubkey = getPublicKey(privateKey)

	return {
		user: async () => ({ pubkey }),
		encryptionEnabled: async () => (supportsNip44 ? ['nip44'] : []),
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
	} as unknown as Nip17OrderTransportSigner
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

describe('NIP-17 order transport publish seam', () => {
	test('resolves sender and recipient kind 10050 relay targets and publishes only gift wraps in order', async () => {
		const senderPrivateKey = generateSecretKey()
		const senderPubkey = getPublicKey(senderPrivateKey)
		const recipientPubkey = getPublicKey(generateSecretKey())
		const fetches: FetchNip17RelayListEventsParams[] = []
		const calls: PublishCall[] = []
		const senderRelays = ['wss://sender.example']
		const recipientRelays = ['wss://recipient.example']

		const rumor = createOrderCreationRumor({
			buyerPubkey: senderPubkey,
			merchantPubkey: recipientPubkey,
			orderId: 'order-transport-1',
			amountSats: 2100,
			items: [{ productRef: `30402:${recipientPubkey}:coffee`, quantity: 1 }],
			createdAt: 100,
		})

		const result = await publishNip17OrderTransportMessage({
			rumor,
			signer: createSigner(senderPrivateKey),
			fetchRelayListEvents: async (params) => {
				fetches.push(params)
				return params.target === 'sender'
					? [relayListEvent(senderPubkey, senderRelays)]
					: [relayListEvent(recipientPubkey, recipientRelays)]
			},
			publishGiftWrap: async (params) => {
				calls.push(params)
				return new Set(params.relays)
			},
			createdAt: 123456,
		})

		expect(result.status).toBe('published')
		if (result.status !== 'published') throw new Error('expected published result')

		expect(result.rumorId).toBe(rumor.id)
		expect(fetches).toEqual([
			{
				target: 'sender',
				pubkey: senderPubkey,
				filter: { kinds: [NIP17_DM_RELAY_LIST_KIND], authors: [senderPubkey], limit: 1 },
			},
			{
				target: 'recipient',
				pubkey: recipientPubkey,
				filter: { kinds: [NIP17_DM_RELAY_LIST_KIND], authors: [recipientPubkey], limit: 1 },
			},
		])
		expect(result.relayTargets.sender.relays).toEqual(senderRelays)
		expect(result.relayTargets.recipient.relays).toEqual(recipientRelays)
		expect(result.sender.relays).toEqual(senderRelays)
		expect(result.recipient.relays).toEqual(recipientRelays)
		expect(calls.map((call) => call.target)).toEqual(['sender', 'recipient'])
		expect(calls.map((call) => call.giftWrap.kind)).toEqual([NIP59_GIFT_WRAP_KIND, NIP59_GIFT_WRAP_KIND])
		expect(calls.some((call) => [14, 16, 17].includes(call.giftWrap.kind))).toBe(false)
		expect(calls[0]?.giftWrap.tags).toContainEqual(['p', senderPubkey])
		expect(calls[1]?.giftWrap.tags).toContainEqual(['p', recipientPubkey])
	})

	test('fails closed when the sender relay list is missing or empty', async () => {
		const senderPrivateKey = generateSecretKey()
		const senderPubkey = getPublicKey(senderPrivateKey)
		const recipientPubkey = getPublicKey(generateSecretKey())
		const calls: PublishCall[] = []

		const rumor = createOrderCreationRumor({
			buyerPubkey: senderPubkey,
			merchantPubkey: recipientPubkey,
			orderId: 'order-transport-2',
			amountSats: 2100,
			items: [{ productRef: `30402:${recipientPubkey}:coffee`, quantity: 1 }],
			createdAt: 100,
		})

		for (const senderEvents of [[], [relayListEvent(senderPubkey, [])]]) {
			const result = await publishNip17OrderTransportMessage({
				rumor,
				signer: createSigner(senderPrivateKey),
				fetchRelayListEvents: async (params) => {
					return params.target === 'sender' ? senderEvents : [relayListEvent(recipientPubkey, ['wss://recipient.example'])]
				},
				publishGiftWrap: async (params) => {
					calls.push(params)
					return new Set(params.relays)
				},
			})

			expect(result.status).toBe('relay_targets_failed')
			if (result.status !== 'relay_targets_failed') throw new Error('expected relay target failure')
			expect(result.rumorId).toBe(rumor.id)
			expect(result.relayTargets.sender.status === 'missing' || result.relayTargets.sender.status === 'empty').toBe(true)
		}

		expect(calls).toHaveLength(0)
	})

	test('fails closed when the recipient relay list is missing or empty', async () => {
		const senderPrivateKey = generateSecretKey()
		const senderPubkey = getPublicKey(senderPrivateKey)
		const recipientPubkey = getPublicKey(generateSecretKey())
		const calls: PublishCall[] = []

		const rumor = createOrderCreationRumor({
			buyerPubkey: senderPubkey,
			merchantPubkey: recipientPubkey,
			orderId: 'order-transport-3',
			amountSats: 2100,
			items: [{ productRef: `30402:${recipientPubkey}:coffee`, quantity: 1 }],
			createdAt: 100,
		})

		for (const recipientEvents of [[], [relayListEvent(recipientPubkey, [])]]) {
			const result = await publishNip17OrderTransportMessage({
				rumor,
				signer: createSigner(senderPrivateKey),
				fetchRelayListEvents: async (params) => {
					return params.target === 'sender' ? [relayListEvent(senderPubkey, ['wss://sender.example'])] : recipientEvents
				},
				publishGiftWrap: async (params) => {
					calls.push(params)
					return new Set(params.relays)
				},
			})

			expect(result.status).toBe('relay_targets_failed')
			if (result.status !== 'relay_targets_failed') throw new Error('expected relay target failure')
			expect(result.rumorId).toBe(rumor.id)
			expect(result.relayTargets.recipient.status === 'missing' || result.relayTargets.recipient.status === 'empty').toBe(true)
		}

		expect(calls).toHaveLength(0)
	})

	test('preserves validation and wrap failure states without publishing', async () => {
		const senderPrivateKey = generateSecretKey()
		const wrongSignerPrivateKey = generateSecretKey()
		const senderPubkey = getPublicKey(senderPrivateKey)
		const recipientPubkey = getPublicKey(generateSecretKey())
		const calls: PublishCall[] = []

		const rumor = createOrderCreationRumor({
			buyerPubkey: senderPubkey,
			merchantPubkey: recipientPubkey,
			orderId: 'order-transport-4',
			amountSats: 2100,
			items: [{ productRef: `30402:${recipientPubkey}:coffee`, quantity: 1 }],
			createdAt: 100,
		})

		const validationFailed = await publishNip17OrderTransportMessage({
			rumor,
			signer: createSigner(wrongSignerPrivateKey),
			fetchRelayListEvents: async () => [],
			publishGiftWrap: async (params) => {
				calls.push(params)
				return new Set(params.relays)
			},
		})

		expect(validationFailed.status).toBe('validation_failed')

		const wrapFailed = await publishNip17OrderTransportMessage({
			rumor,
			signer: createSigner(senderPrivateKey, false),
			fetchRelayListEvents: async (params) => {
				return params.target === 'sender'
					? [relayListEvent(senderPubkey, ['wss://sender.example'])]
					: [relayListEvent(recipientPubkey, ['wss://recipient.example'])]
			},
			publishGiftWrap: async (params) => {
				calls.push(params)
				return new Set(params.relays)
			},
		})

		expect(wrapFailed.status).toBe('wrap_failed')
		if (wrapFailed.status !== 'wrap_failed') throw new Error('expected wrap failure')
		expect(wrapFailed.rumorId).toBe(rumor.id)
		expect(calls).toHaveLength(0)
	})

	test('returns sender_publish_failed without attempting recipient publish', async () => {
		const senderPrivateKey = generateSecretKey()
		const senderPubkey = getPublicKey(senderPrivateKey)
		const recipientPubkey = getPublicKey(generateSecretKey())
		const calls: PublishCall[] = []

		const rumor = createOrderCreationRumor({
			buyerPubkey: senderPubkey,
			merchantPubkey: recipientPubkey,
			orderId: 'order-transport-sender-fail',
			amountSats: 2100,
			items: [{ productRef: `30402:${recipientPubkey}:coffee`, quantity: 1 }],
			createdAt: 100,
		})

		const result = await publishNip17OrderTransportMessage({
			rumor,
			signer: createSigner(senderPrivateKey),
			fetchRelayListEvents: async (params) => {
				return params.target === 'sender'
					? [relayListEvent(senderPubkey, ['wss://sender.example'])]
					: [relayListEvent(recipientPubkey, ['wss://recipient.example'])]
			},
			publishGiftWrap: async (params) => {
				calls.push(params)
				return new Set()
			},
		})

		expect(result.status).toBe('sender_publish_failed')
		if (result.status !== 'sender_publish_failed') throw new Error('expected sender publish failure')
		expect(calls.map((call) => call.target)).toEqual(['sender'])
		expect(calls.some((call) => call.target === 'recipient')).toBe(false)
		expect(result.rumorId).toBe(rumor.id)
	})

	test('returns a partial state when recipient delivery fails after sender self-wrap succeeds', async () => {
		const senderPrivateKey = generateSecretKey()
		const senderPubkey = getPublicKey(senderPrivateKey)
		const recipientPubkey = getPublicKey(generateSecretKey())
		const calls: PublishCall[] = []

		const rumor = createOrderCreationRumor({
			buyerPubkey: senderPubkey,
			merchantPubkey: recipientPubkey,
			orderId: 'order-transport-5',
			amountSats: 2100,
			items: [{ productRef: `30402:${recipientPubkey}:coffee`, quantity: 1 }],
			createdAt: 100,
		})

		const result = await publishNip17OrderTransportMessage({
			rumor,
			signer: createSigner(senderPrivateKey),
			fetchRelayListEvents: async (params) => {
				return params.target === 'sender'
					? [relayListEvent(senderPubkey, ['wss://sender.example'])]
					: [relayListEvent(recipientPubkey, ['wss://recipient.example'])]
			},
			publishGiftWrap: async (params) => {
				calls.push(params)
				return params.target === 'sender' ? new Set(params.relays) : new Set()
			},
		})

		expect(result.status).toBe('recipient_publish_failed')
		if (result.status !== 'recipient_publish_failed') throw new Error('expected recipient publish failure')
		expect(calls.map((call) => call.target)).toEqual(['sender', 'recipient'])
		expect(result.rumorId).toBe(rumor.id)
		expect(result.sender.target).toBe('sender')
		expect(result.recipient.target).toBe('recipient')
	})
})

describe('NIP-17 order transport read seam', () => {
	test('builds and uses a kind 1059 gift-wrap filter for the active user', async () => {
		const activeUserPubkey = getPublicKey(generateSecretKey())
		const filters: unknown[] = []

		const result = await readNip17OrderTransportMessages({
			activeUserPubkey,
			signer: createSigner(generateSecretKey()),
			fetchGiftWraps: async (filter) => {
				filters.push(filter)
				return []
			},
		})

		expect(buildNip17OrderGiftWrapFilter(activeUserPubkey)).toEqual({
			kinds: [NIP59_GIFT_WRAP_KIND],
			'#p': [activeUserPubkey],
		})
		expect(filters).toEqual([{ kinds: [NIP59_GIFT_WRAP_KIND], '#p': [activeUserPubkey] }])
		expect(result.messages).toEqual([])
	})

	test('unwraps valid messages from injected gift-wrap reads', async () => {
		const buyerPrivateKey = generateSecretKey()
		const sellerPrivateKey = generateSecretKey()
		const buyerPubkey = getPublicKey(buyerPrivateKey)
		const sellerPubkey = getPublicKey(sellerPrivateKey)

		const rumor = createOrderCreationRumor({
			buyerPubkey,
			merchantPubkey: sellerPubkey,
			orderId: 'order-read-transport-1',
			amountSats: 2100,
			items: [{ productRef: `30402:${sellerPubkey}:coffee`, quantity: 1 }],
			createdAt: 100,
		})
		const wraps = await createNip17GiftWrapsWithSigner({
			rumor,
			signer: createSigner(buyerPrivateKey),
			recipientPubkey: sellerPubkey,
			createdAt: 200,
		})

		const result = await readNip17OrderTransportMessages({
			activeUserPubkey: sellerPubkey,
			signer: createSigner(sellerPrivateKey),
			fetchGiftWraps: async () => [wraps.recipient.giftWrap],
		})

		expect(result.messages).toHaveLength(1)
		expect(result.messages[0]?.rumor).toEqual(rumor)
		expect(result.messages[0]?.direction).toBe('received')
	})

	test('batch read ignores bad wraps, dedupes by inner rumor id, and sorts deterministically', async () => {
		const buyerPrivateKey = generateSecretKey()
		const sellerPrivateKey = generateSecretKey()
		const buyerPubkey = getPublicKey(buyerPrivateKey)
		const sellerPubkey = getPublicKey(sellerPrivateKey)
		const unrelatedPubkey = getPublicKey(generateSecretKey())

		const sameTimestampRumor = createOrderCreationRumor({
			buyerPubkey,
			merchantPubkey: sellerPubkey,
			orderId: 'order-read-transport-a',
			amountSats: 1000,
			items: [{ productRef: `30402:${sellerPubkey}:a`, quantity: 1 }],
			createdAt: 100,
		})
		const sameTimestampReceipt = createPaymentReceiptRumor({
			buyerPubkey,
			merchantPubkey: sellerPubkey,
			orderId: 'order-read-transport-b',
			amountSats: 1000,
			payment: { medium: 'lightning', reference: 'lnbc-test', proof: 'preimage-test' },
			createdAt: 100,
		})
		const newerRumor = createOrderCreationRumor({
			buyerPubkey,
			merchantPubkey: sellerPubkey,
			orderId: 'order-read-transport-c',
			amountSats: 2000,
			items: [{ productRef: `30402:${sellerPubkey}:c`, quantity: 1 }],
			createdAt: 200,
		})
		const unrelatedInnerRumor = createOrderCreationRumor({
			buyerPubkey,
			merchantPubkey: unrelatedPubkey,
			orderId: 'order-read-transport-unrelated',
			amountSats: 2000,
			items: [{ productRef: `30402:${unrelatedPubkey}:x`, quantity: 1 }],
			createdAt: 300,
		})

		const wrapA = await createNip17GiftWrapsWithSigner({
			rumor: sameTimestampRumor,
			signer: createSigner(buyerPrivateKey),
			recipientPubkey: sellerPubkey,
			createdAt: 300,
		})
		const duplicateA = await createNip17GiftWrapsWithSigner({
			rumor: sameTimestampRumor,
			signer: createSigner(buyerPrivateKey),
			recipientPubkey: sellerPubkey,
			createdAt: 301,
		})
		const wrapB = await createNip17GiftWrapsWithSigner({
			rumor: sameTimestampReceipt,
			signer: createSigner(buyerPrivateKey),
			recipientPubkey: sellerPubkey,
			createdAt: 302,
		})
		const wrapC = await createNip17GiftWrapsWithSigner({
			rumor: newerRumor,
			signer: createSigner(buyerPrivateKey),
			recipientPubkey: sellerPubkey,
			createdAt: 303,
		})
		const unrelated = await createNip17GiftWrapsWithSigner({
			rumor: unrelatedInnerRumor,
			signer: createSigner(buyerPrivateKey),
			recipientPubkey: sellerPubkey,
			createdAt: 304,
		})

		const result = await readNip17OrderTransportMessages({
			activeUserPubkey: sellerPubkey,
			signer: createSigner(sellerPrivateKey),
			fetchGiftWraps: async () => [
				wrapC.recipient.giftWrap,
				malformedGiftWrap(sellerPubkey),
				unrelated.recipient.giftWrap,
				duplicateA.recipient.giftWrap,
				wrapB.recipient.giftWrap,
				wrapA.recipient.giftWrap,
			],
		})

		const sameTimestampSortedIds = [sameTimestampRumor.id, sameTimestampReceipt.id].sort((a, b) => a.localeCompare(b))

		expect(result.messages.map((message) => message.rumor.id)).toEqual([...sameTimestampSortedIds, newerRumor.id])
		expect(result.messages.map((message) => message.rumor.id)).toHaveLength(
			new Set(result.messages.map((message) => message.rumor.id)).size,
		)
	})
})
