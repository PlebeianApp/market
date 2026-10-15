import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey, nip44 } from 'nostr-tools'
import type { Event, UnsignedEvent } from 'nostr-tools'
import { DM_GIFT_WRAP_KIND, DM_RELAYS_KIND } from '../../core/dm/ts/index.ts'
import type { DmPublishPort } from '../../core/dm/ts/index.ts'
import type { EncryptingSigner, SignableRumorLike } from '../../core/ports/encryptingSigner'
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

// A *signed* `10050` relay-list event, so relay-config's store subscription answers it.
const relayList = (privateKey: Uint8Array, relay: string): Event =>
	finalizeEvent({ kind: DM_RELAYS_KIND, created_at: 10, tags: [['relay', relay]], content: '' }, privateKey)

describe('NIP-17 order publishing through the dm component', () => {
	test('publishes both gift wraps to explicit sender/recipient relay targets', async () => {
		const privateKey = generateSecretKey()
		const signer = signerFor(privateKey)
		const senderPubkey = await signer.getPublicKey()
		const recipientPrivateKey = generateSecretKey()
		const recipientPubkey = getPublicKey(recipientPrivateKey)
		const rumor = createOrderCreationRumor({
			buyerPubkey: senderPubkey,
			merchantPubkey: recipientPubkey,
			orderId: 'order-1',
			amountSats: 100,
			items: [{ productRef: `30402:${recipientPubkey}:item`, quantity: 1 }],
			createdAt: 20,
		})
		const published: Array<{ event: Event; relays: readonly string[] }> = []
		const relay: DmPublishPort = {
			publish: async (event, relayUrls) => {
				published.push({ event, relays: relayUrls })
				return { acceptedRelays: relayUrls }
			},
		}

		const result = await publishNip17OrderMessage({
			rumor,
			signer,
			recipientPubkey,
			recipientRelayEvents: [relayList(recipientPrivateKey, 'wss://recipient.example')],
			senderRelayEvents: [relayList(privateKey, 'wss://sender.example')],
			relay,
		})

		expect(result.relayTargets.ready).toBe(true)
		expect(published).toHaveLength(2)
		// The library's parser canonicalises a bare host to a trailing slash (`wss://x.example` → `wss://x.example/`),
		// which is relay-config's own answer and not re-spelled here.
		expect(published.map(({ relays }) => relays)).toEqual([['wss://sender.example/'], ['wss://recipient.example/']])
		expect(published.every(({ event }) => event.kind === DM_GIFT_WRAP_KIND)).toBe(true)
	})
})
