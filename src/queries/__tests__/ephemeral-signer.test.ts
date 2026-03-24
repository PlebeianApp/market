import { describe, test, expect } from 'bun:test'
import { getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import { nip44 } from 'nostr-tools'

describe('ephemeral signer (browser-safe)', () => {
	test('getPublicKey works without hexToBytes from nostr-tools/utils', async () => {
		const privateKey = crypto.getRandomValues(new Uint8Array(32))
		const publicKey = getPublicKey(privateKey)

		expect(typeof publicKey).toBe('string')
		expect(publicKey).toHaveLength(64)
		expect(publicKey).toMatch(/^[0-9a-f]+$/)
	})

	test('signEvent works with Uint8Array private key', async () => {
		const privateKey = crypto.getRandomValues(new Uint8Array(32))
		const publicKey = getPublicKey(privateKey)

		const unsignedEvent = {
			kind: 1,
			content: 'test',
			tags: [],
			created_at: Math.floor(Date.now() / 1000),
			pubkey: publicKey,
		}

		const signed = finalizeEvent(unsignedEvent, privateKey)

		expect(signed.pubkey).toBe(publicKey)
		expect(signed.sig).toBeDefined()
		expect(signed.sig).toHaveLength(128)
		expect(signed.id).toBeDefined()
	})

	test('nip44 encrypt/decrypt roundtrip works with Uint8Array private key', async () => {
		const alicePriv = crypto.getRandomValues(new Uint8Array(32))
		const bobPriv = crypto.getRandomValues(new Uint8Array(32))
		const bobPub = getPublicKey(bobPriv)

		const plaintext = 'hello nostr'
		const conversationKey = nip44.v2.utils.getConversationKey(alicePriv, bobPub)
		const ciphertext = nip44.v2.encrypt(plaintext, conversationKey)

		expect(typeof ciphertext).toBe('string')
		expect(ciphertext.length).toBeGreaterThan(0)

		const bobConversationKey = nip44.v2.utils.getConversationKey(bobPriv, getPublicKey(alicePriv))
		const decrypted = nip44.v2.decrypt(ciphertext, bobConversationKey)
		expect(decrypted).toBe(plaintext)
	})

	test('signer interface is compatible with @contextvm/sdk transport expectations', async () => {
		const privateKey = crypto.getRandomValues(new Uint8Array(32))
		const publicKey = getPublicKey(privateKey)

		const signer = {
			privateKey,
			publicKey,
			async getPublicKey() {
				return publicKey
			},
			async signEvent(event: any) {
				return finalizeEvent(event, privateKey)
			},
			nip44: {
				async encrypt(pubkey: string, plaintext: string) {
					const conversationKey = nip44.v2.utils.getConversationKey(privateKey, pubkey)
					return nip44.v2.encrypt(plaintext, conversationKey)
				},
				async decrypt(pubkey: string, ciphertext: string) {
					const conversationKey = nip44.v2.utils.getConversationKey(privateKey, pubkey)
					return nip44.v2.decrypt(ciphertext, conversationKey)
				},
			},
		}

		expect(await signer.getPublicKey()).toBe(publicKey)

		const event = await signer.signEvent({
			kind: 1,
			content: 'test',
			tags: [],
			created_at: Math.floor(Date.now() / 1000),
			pubkey: publicKey,
		})
		expect(event.pubkey).toBe(publicKey)
		expect(event.sig).toHaveLength(128)

		const encrypted = await signer.nip44.encrypt(publicKey, 'secret message')
		const decrypted = await signer.nip44.decrypt(publicKey, encrypted)
		expect(decrypted).toBe('secret message')
	})
})
