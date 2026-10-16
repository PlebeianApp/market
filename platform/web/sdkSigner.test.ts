import { describe, expect, test } from 'bun:test'
import { createSignerFromKey } from '@sdk/core/signer'
import { generateSecretKey } from 'nostr-tools/pure'
import { bytesToHex } from 'nostr-tools/utils'
import { createBrowserSignerPorts, createSignerPublishContext } from './sdkSigner'

describe('browser signer ports', () => {
	test('crypto port round-trips AES-GCM under a PBKDF2 key', async () => {
		const crypto = createBrowserSignerPorts().crypto!
		const key = await crypto.pbkdf2Sha256('passphrase', crypto.randomBytes(16), 1000)
		const iv = crypto.randomBytes(12)
		const ciphertext = await crypto.aesGcmEncrypt(key, iv, crypto.utf8Encode('secret'))

		expect(crypto.utf8Decode(await crypto.aesGcmDecrypt(key, iv, ciphertext))).toBe('secret')
	})

	test('a signer-module key signs through an SDK publish context', async () => {
		const published: string[] = []
		const capability = createSignerFromKey(bytesToHex(generateSecretKey()))
		const context = await createSignerPublishContext(capability, async (event) => {
			published.push(event.id)
		})

		const event = await context.signer.sign({ kind: 1, content: 'hi', tags: [], created_at: context.now() })
		await context.publish(event)

		expect(event.pubkey).toBe(context.authorPubkey)
		expect(published).toEqual([event.id])
	})
})
