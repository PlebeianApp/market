import { afterEach, describe, expect, test } from 'bun:test'
import { getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { hexToBytes } from '@noble/hashes/utils.js'
import { encrypt as nip04Encrypt, decrypt as nip04Decrypt } from 'nostr-tools/nip04'
import { v2 as nip44 } from 'nostr-tools/nip44'
import { Nip46Mock } from '../../../e2e/utils/nip46-mock'

const REMOTE_SIGNER_SK = '11'.repeat(32)
const USER_SK = '22'.repeat(32)
const THIRD_PARTY_SK = '33'.repeat(32)
const CLIENT_SK = '44'.repeat(32)

const remoteSignerPk = getPublicKey(hexToBytes(REMOTE_SIGNER_SK))
const userPk = getPublicKey(hexToBytes(USER_SK))
const thirdPartyPk = getPublicKey(hexToBytes(THIRD_PARTY_SK))
const clientPk = getPublicKey(hexToBytes(CLIENT_SK))

/** Capture RPC responses by short-circuiting the relay-bound send. */
function spyResponses(mock: Nip46Mock): { requests: any[]; responses: any[] } {
	const captured: any[] = []
	;(mock as any).sendEncrypted = async (_recipientPubkey: string, content: unknown) => {
		captured.push(content)
	}
	return { requests: [], responses: captured }
}

describe('Nip46Mock', () => {
	const originalConsoleError = console.error

	afterEach(() => {
		console.error = originalConsoleError
	})

	test('does not log teardown errors when an in-flight handler rejects after close', async () => {
		const mock = new Nip46Mock('11'.repeat(32))
		const errors: unknown[][] = []
		console.error = ((...args: unknown[]) => {
			errors.push(args)
		}) as typeof console.error
		;(mock as any).subId = 'sub'
		;(mock as any).eventHandler = async () => {
			await Promise.resolve()
			throw new Error('boom')
		}
		;(mock as any).handleMessage(Buffer.from(JSON.stringify(['EVENT', 'sub', {}])))
		mock.close()
		await Promise.resolve()
		await Promise.resolve()

		expect(errors).toHaveLength(0)
	})
})

describe('Nip46Mock signer identity (three-way key separation)', () => {
	test('holds distinct remote-signer and user keys when both are supplied', () => {
		const mock = new Nip46Mock(REMOTE_SIGNER_SK, USER_SK)

		expect(mock.remoteSignerSk).toBe(REMOTE_SIGNER_SK)
		expect(mock.remoteSignerPk).toBe(remoteSignerPk)
		expect(mock.userSk).toBe(USER_SK)
		expect(mock.userPk).toBe(userPk)
		expect(mock.remoteSignerPk).not.toBe(mock.userPk)
	})

	test('defaults the user key to the remote-signer key (legacy single-key collapse)', () => {
		const mock = new Nip46Mock(REMOTE_SIGNER_SK)

		expect(mock.userSk).toBe(REMOTE_SIGNER_SK)
		expect(mock.userPk).toBe(mock.remoteSignerPk)
	})

	test('get_public_key returns the authenticated user pubkey, distinct from the remote signer', async () => {
		const mock = new Nip46Mock(REMOTE_SIGNER_SK, USER_SK)
		const { responses } = spyResponses(mock)

		await (mock as any).handleSignerRequest(clientPk, {
			id: 'getpk',
			method: 'get_public_key',
			params: [],
		})

		expect(responses).toHaveLength(1)
		expect(responses[0].result).toBe(userPk)
		expect(responses[0].result).not.toBe(mock.remoteSignerPk)
	})

	test('sign_event signs with the user key, never the remote-signer key', async () => {
		const mock = new Nip46Mock(REMOTE_SIGNER_SK, USER_SK)
		const { responses } = spyResponses(mock)

		const template = { kind: 1, created_at: 1234, tags: [], content: 'signed by the user' }
		await (mock as any).handleSignerRequest(clientPk, {
			id: 'sign',
			method: 'sign_event',
			params: [template],
		})

		const signed = JSON.parse(responses[0].result)
		expect(signed.pubkey).toBe(userPk)
		expect(signed.pubkey).not.toBe(mock.remoteSignerPk)
		expect(verifyEvent(signed)).toBe(true)
	})
})

describe('Nip46Mock NIP-44 RPC handlers', () => {
	test('nip44_encrypt produces ciphertext decryptable by the third party using the user pubkey', async () => {
		const mock = new Nip46Mock(REMOTE_SIGNER_SK, USER_SK)
		const { responses } = spyResponses(mock)

		await (mock as any).handleSignerRequest(clientPk, {
			id: 'e44',
			method: 'nip44_encrypt',
			params: [thirdPartyPk, 'hello nip44'],
		})

		const ciphertext = responses[0].result
		const conversationKey = nip44.utils.getConversationKey(hexToBytes(THIRD_PARTY_SK), userPk)
		expect(nip44.decrypt(ciphertext, conversationKey)).toBe('hello nip44')
	})

	test('nip44_decrypt recovers the plaintext the user received from a third party', async () => {
		const mock = new Nip46Mock(REMOTE_SIGNER_SK, USER_SK)
		const { responses } = spyResponses(mock)

		const conversationKey = nip44.utils.getConversationKey(hexToBytes(THIRD_PARTY_SK), userPk)
		const ciphertext = nip44.encrypt('reply nip44', conversationKey)

		await (mock as any).handleSignerRequest(clientPk, {
			id: 'd44',
			method: 'nip44_decrypt',
			params: [thirdPartyPk, ciphertext],
		})

		expect(responses[0].result).toBe('reply nip44')
	})
})

describe('Nip46Mock NIP-04 RPC handlers (user-key parity)', () => {
	test('nip04_encrypt/nip04_decrypt round-trip through the user key, not the remote-signer key', async () => {
		const mock = new Nip46Mock(REMOTE_SIGNER_SK, USER_SK)
		const { responses } = spyResponses(mock)

		await (mock as any).handleSignerRequest(clientPk, {
			id: 'e04',
			method: 'nip04_encrypt',
			params: [thirdPartyPk, 'hello nip04'],
		})
		const ciphertext = responses[0].result
		expect(await nip04Decrypt(THIRD_PARTY_SK, userPk, ciphertext)).toBe('hello nip04')

		// The third party encrypts a reply back to the user pubkey.
		const reply = await nip04Encrypt(THIRD_PARTY_SK, userPk, 'reply nip04')
		await (mock as any).handleSignerRequest(clientPk, {
			id: 'd04',
			method: 'nip04_decrypt',
			params: [thirdPartyPk, reply],
		})
		expect(responses[1].result).toBe('reply nip04')
	})
})

describe('Nip46Mock nostrconnect URI secret handling', () => {
	function stubTransport(mock: Nip46Mock, sends: any[]) {
		;(mock as any).connectAndSubscribe = async () => {}
		;(mock as any).sendEncrypted = async (_pk: string, content: unknown) => {
			sends.push(content)
		}
	}

	test('reads the spec "secret" param and echoes it in the connect request', async () => {
		const mock = new Nip46Mock(REMOTE_SIGNER_SK, USER_SK)
		const sends: any[] = []
		stubTransport(mock, sends)

		await mock.respondToConnect(`nostrconnect://${clientPk}?relay=ws%3A%2F%2Ftest&secret=abc123`)

		expect(sends).toHaveLength(1)
		expect(sends[0].method).toBe('connect')
		expect(sends[0].params.secret).toBe('abc123')
	})

	test('still reads the legacy "token" param as an alias until B-4 removes it', async () => {
		const mock = new Nip46Mock(REMOTE_SIGNER_SK, USER_SK)
		const sends: any[] = []
		stubTransport(mock, sends)

		await mock.respondToConnect(`nostrconnect://${clientPk}?relay=ws%3A%2F%2Ftest&token=oldtoken`)

		expect(sends).toHaveLength(1)
		expect(sends[0].method).toBe('connect')
		expect(sends[0].params.secret).toBe('oldtoken')
	})
})
