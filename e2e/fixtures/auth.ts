import type { BrowserContext, Page } from '@playwright/test'
import { getPublicKey, finalizeEvent, type UnsignedEvent } from 'nostr-tools/pure'
import { encrypt as nip44Encrypt, decrypt as nip44Decrypt, getConversationKey } from 'nostr-tools/nip44'
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js'

export interface TestUser {
	sk: string // hex private key
	pk: string // hex public key
}

export async function setupAuthContext(context: BrowserContext, user: TestUser): Promise<void> {
	await context.exposeFunction('__nostrSignEvent', (eventJson: string): string => {
		const event = JSON.parse(eventJson) as UnsignedEvent
		const skBytes = hexToBytes(user.sk)
		const signed = finalizeEvent(event, skBytes)
		return JSON.stringify(signed)
	})

	await context.exposeFunction('__nostrGetPublicKey', (): string => {
		return user.pk
	})

	const skBytes = hexToBytes(user.sk)
	await context.exposeFunction('__nostrNip44Encrypt', (pubkey: string, plaintext: string): string => {
		const convKey = getConversationKey(skBytes, pubkey)
		return nip44Encrypt(plaintext, convKey)
	})

	await context.exposeFunction('__nostrNip44Decrypt', (pubkey: string, ciphertext: string): string => {
		const convKey = getConversationKey(skBytes, pubkey)
		return nip44Decrypt(ciphertext, convKey)
	})

	await context.addInitScript(() => {
		;(window as any).nostr = {
			getPublicKey: async () => {
				return await (window as any).__nostrGetPublicKey()
			},

			signEvent: async (event: any) => {
				const result = await (window as any).__nostrSignEvent(JSON.stringify(event))
				return JSON.parse(result)
			},

			nip04: {
				encrypt: async (_pubkey: string, plaintext: string) => {
					return `test_encrypted:${plaintext}`
				},
				decrypt: async (_pubkey: string, ciphertext: string) => {
					if (ciphertext.startsWith('test_encrypted:')) {
						return ciphertext.slice('test_encrypted:'.length)
					}
					return ciphertext
				},
			},

			nip44: {
				encrypt: async (pubkey: string, plaintext: string) => {
					return await (window as any).__nostrNip44Encrypt(pubkey, plaintext)
				},
				decrypt: async (pubkey: string, ciphertext: string) => {
					return await (window as any).__nostrNip44Decrypt(pubkey, ciphertext)
				},
			},
		}

		localStorage.setItem('nostr_auto_login', 'true')
		localStorage.setItem('plebeian_terms_accepted', 'true')
	})
}

/**
 * Creates an authenticated page for a given test user.
 * The page will auto-login via the NIP-07 mock on navigation.
 */
export async function createAuthenticatedPage(context: BrowserContext, user: TestUser): Promise<Page> {
	await setupAuthContext(context, user)
	const page = await context.newPage()
	return page
}
