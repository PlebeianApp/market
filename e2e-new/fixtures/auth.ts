import type { BrowserContext, Page } from '@playwright/test'
import { getPublicKey, finalizeEvent, type UnsignedEvent } from 'nostr-tools/pure'
import { hexToBytes, bytesToHex } from '@noble/hashes/utils'

export interface TestUser {
	sk: string // hex private key
	pk: string // hex public key
}

/**
 * Sets up a browser context with a NIP-07 (window.nostr) mock that
 * enables automatic login. Signing happens in Node.js via exposeFunction
 * so we have full access to nostr-tools.
 */
export async function setupAuthContext(context: BrowserContext, user: TestUser): Promise<void> {
	// Expose the signing function to the browser.
	// This runs in Node.js where we have nostr-tools available.
	await context.exposeFunction('__nostrSignEvent', (eventJson: string): string => {
		const event = JSON.parse(eventJson) as UnsignedEvent
		const skBytes = hexToBytes(user.sk)
		const signed = finalizeEvent(event, skBytes)
		return JSON.stringify(signed)
	})

	// Expose getPublicKey as well (simpler than passing the pubkey)
	await context.exposeFunction('__nostrGetPublicKey', (): string => {
		return user.pk
	})

	// Inject window.nostr mock before any page scripts run
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
					// In tests, return plaintext wrapped to indicate "encrypted"
					return `test_encrypted:${plaintext}`
				},
				decrypt: async (_pubkey: string, ciphertext: string) => {
					// In tests, unwrap if it was our fake encryption
					if (ciphertext.startsWith('test_encrypted:')) {
						return ciphertext.slice('test_encrypted:'.length)
					}
					return ciphertext
				},
			},
		}

		// Enable auto-login so the app picks up our NIP-07 mock
		localStorage.setItem('nostr_auto_login', 'true')

		// Pre-accept Terms & Conditions so the dialog doesn't block tests
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
