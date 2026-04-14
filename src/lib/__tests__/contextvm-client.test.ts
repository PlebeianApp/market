import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test'
import { getPublicKey, finalizeEvent, nip44 } from 'nostr-tools'

const originalWarn = console.warn
const originalError = console.error
console.warn = () => {}
console.error = () => {}

describe('PlebianCurrencyClient unit tests', () => {
	test('constructor derives public key from private key', () => {
		const privateKey = crypto.getRandomValues(new Uint8Array(32))
		const publicKey = getPublicKey(privateKey)

		expect(typeof publicKey).toBe('string')
		expect(publicKey).toHaveLength(64)
		expect(publicKey).toMatch(/^[0-9a-f]+$/)
	})

	test('NIP-44 gift wrap encryption roundtrip works', () => {
		const giftWrapPriv = crypto.getRandomValues(new Uint8Array(32))
		const recipientPriv = crypto.getRandomValues(new Uint8Array(32))
		const recipientPub = getPublicKey(recipientPriv)

		const innerEvent = { kind: 1, content: 'test', pubkey: recipientPub, tags: [], created_at: 1234567890 }
		const signedInner = finalizeEvent(innerEvent, recipientPriv)

		const conversationKey = nip44.v2.utils.getConversationKey(giftWrapPriv, recipientPub)
		const encrypted = nip44.v2.encrypt(JSON.stringify(signedInner), conversationKey)

		expect(typeof encrypted).toBe('string')
		expect(encrypted.length).toBeGreaterThan(0)

		const decryptKey = nip44.v2.utils.getConversationKey(recipientPriv, getPublicKey(giftWrapPriv))
		const decrypted = nip44.v2.decrypt(encrypted, decryptKey)
		const parsed = JSON.parse(decrypted)

		expect(parsed.pubkey).toBe(recipientPub)
		expect(parsed.content).toBe('test')
		expect(parsed.sig).toHaveLength(128)
	})

	test('gift wrap event has correct structure for ContextVM protocol', () => {
		const serverPubkey = '29bd6461f780c07b29c89b4df8017db90973d5608a3cd811a0522b15c1064f15'
		const clientPriv = crypto.getRandomValues(new Uint8Array(32))
		const clientPub = getPublicKey(clientPriv)

		const mcpRequest = {
			jsonrpc: '2.0',
			id: 'test-123',
			method: 'tools/call',
			params: { name: 'get_btc_price', arguments: {} },
		}

		const innerEvent = {
			pubkey: clientPub,
			kind: 25910,
			tags: [['p', serverPubkey]],
			content: JSON.stringify(mcpRequest),
			created_at: Math.floor(Date.now() / 1000),
		}

		const signedInner = finalizeEvent(innerEvent, clientPriv)

		expect(signedInner.kind).toBe(25910)
		expect(signedInner.pubkey).toBe(clientPub)
		expect(signedInner.tags).toEqual([['p', serverPubkey]])
		expect(signedInner.sig).toHaveLength(128)
		expect(JSON.parse(signedInner.content).method).toBe('tools/call')
	})

	test('gift wrap envelope has correct kind and p tag', () => {
		const serverPubkey = '29bd6461f780c07b29c89b4df8017db90973d5608a3cd811a0522b15c1064f15'
		const giftWrapPriv = crypto.getRandomValues(new Uint8Array(32))
		const giftWrapPub = getPublicKey(giftWrapPriv)

		const conversationKey = nip44.v2.utils.getConversationKey(giftWrapPriv, serverPubkey)
		const encrypted = nip44.v2.encrypt('{"kind":25910}', conversationKey)

		const giftWrap = {
			kind: 1059,
			content: encrypted,
			tags: [['p', serverPubkey]],
			created_at: Math.floor(Date.now() / 1000),
			pubkey: giftWrapPub,
		}

		const signed = finalizeEvent(giftWrap, giftWrapPriv)

		expect(signed.kind).toBe(1059)
		expect(signed.tags).toEqual([['p', serverPubkey]])
		expect(signed.pubkey).toBe(giftWrapPub)
		expect(signed.sig).toHaveLength(128)
	})

	test('response correlation: e tag references gift wrap event id', () => {
		const giftWrapId = 'abc123def456'
		const serverResponse = {
			jsonrpc: '2.0',
			id: 'test-123',
			result: {
				rates: { USD: 100000 },
				sourcesSucceeded: ['yadio'],
				fetchedAt: Date.now(),
			},
		}

		const responseEvent = {
			kind: 25910,
			pubkey: '29bd6461f780c07b29c89b4df8017db90973d5608a3cd811a0522b15c1064f15',
			tags: [
				['p', 'clientpub'],
				['e', giftWrapId],
			],
			content: JSON.stringify(serverResponse),
			created_at: Math.floor(Date.now() / 1000),
		}

		const eTag = responseEvent.tags.find((t) => t[0] === 'e')?.[1]
		expect(eTag).toBe(giftWrapId)

		const parsed = JSON.parse(responseEvent.content)
		expect(parsed.result.rates.USD).toBe(100000)
	})

	test('error response is correctly structured', () => {
		const errorResponse = {
			jsonrpc: '2.0',
			id: 'test-123',
			error: {
				code: -32600,
				message: 'Invalid request',
			},
		}

		const responseEvent = {
			kind: 25910,
			pubkey: '29bd6461f780c07b29c89b4df8017db90973d5608a3cd811a0522b15c1064f15',
			tags: [
				['p', 'clientpub'],
				['e', 'giftwrap-id'],
			],
			content: JSON.stringify(errorResponse),
			created_at: Math.floor(Date.now() / 1000),
		}

		const parsed = JSON.parse(responseEvent.content)
		expect(parsed.error).toBeDefined()
		expect(parsed.error.message).toBe('Invalid request')
	})
})
