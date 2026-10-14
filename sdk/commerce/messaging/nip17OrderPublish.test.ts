import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey, nip44 } from 'nostr-tools'
import type { Event, UnsignedEvent } from 'nostr-tools'
import type { EncryptingSigner, SignableRumorLike } from '../../core/ports/encryptingSigner'
import type { NostrRelayPort } from '../../core/ports/nostrRelay'
import { NIP59_GIFT_WRAP_KIND } from '../../core/nostr/nip59'
import { NIP17_DM_RELAY_LIST_KIND } from '../../core/nostr/nip17Relays'
import { createOrderCreationRumor } from './orderMessageRumor'
import { publishNip17OrderMessage } from './nip17OrderPublish'

function signerFor(privateKey: Uint8Array): EncryptingSigner {
	return {
		getPublicKey: async () => getPublicKey(privateKey),
		signEvent: async (event: SignableRumorLike) =>
			finalizeEvent(
				{
					kind: event.kind,
					created_at: event.created_at,
					tags: event.tags,
					content: event.content,
					pubkey: event.pubkey,
				} as UnsignedEvent,
				privateKey,
			).sig,
		encrypt: async (recipient, plaintext) => {
			const key = nip44.v2.utils.getConversationKey(privateKey, recipient)
			return nip44.v2.encrypt(plaintext, key)
		},
		decrypt: async (sender, ciphertext) => {
			const key = nip44.v2.utils.getConversationKey(privateKey, sender)
			return nip44.v2.decrypt(ciphertext, key)
		},
		supportsNip44: async () => true,
	}
}

const relayList = (pubkey: string, relay: string) => ({
	kind: NIP17_DM_RELAY_LIST_KIND,
	pubkey,
	created_at: 10,
	tags: [['relay', relay]],
})

describe('NIP-17 order publishing through Core relay port', () => {
	test('publishes both gift wraps to explicit sender/recipient relay targets', async () => {
		const privateKey = generateSecretKey()
		const signer = signerFor(privateKey)
		const senderPubkey = await signer.getPublicKey()
		const recipientPubkey = getPublicKey(generateSecretKey())
		const rumor = createOrderCreationRumor({
			buyerPubkey: senderPubkey,
			merchantPubkey: recipientPubkey,
			orderId: 'order-1',
			amountSats: 100,
			items: [{ productRef: `30402:${recipientPubkey}:item`, quantity: 1 }],
			createdAt: 20,
		})
		const published: Array<{ event: Event; relays: readonly string[] }> = []
		const relay: NostrRelayPort<Event> = {
			fetchEvents: async () => [],
			subscribe: () => () => {},
			publish: async (event, relayUrls) => {
				published.push({ event, relays: relayUrls })
				return { acceptedRelays: relayUrls }
			},
		}

		const result = await publishNip17OrderMessage({
			rumor,
			signer,
			recipientPubkey,
			recipientRelayEvents: [relayList(recipientPubkey, 'wss://recipient.example')],
			senderRelayEvents: [relayList(senderPubkey, 'wss://sender.example')],
			relay,
		})

		expect(result.relayTargets.ready).toBe(true)
		expect(published).toHaveLength(2)
		expect(published.map(({ relays }) => relays)).toEqual([['wss://sender.example'], ['wss://recipient.example']])
		expect(published.every(({ event }) => event.kind === NIP59_GIFT_WRAP_KIND)).toBe(true)
	})
})
