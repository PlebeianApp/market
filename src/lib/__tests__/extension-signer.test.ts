/**
 * Extension signer factory tests (ADR-0008 A3-3).
 *
 * `createExtensionSigner` wraps the NIP-07 `ExtensionSigner` (applesauce-signers)
 * as a `SignerCapability`. nip04/nip44 are pass-throughs to `window.nostr`; both
 * are ABSENT when the extension lacks the method, so NWC consumers fail closed
 * at the adapter (no silent fallback). The extension-available check surfaces as
 * an `ExtensionMissingError` thrown from `getPublicKey`.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'

import { createExtensionSigner } from '@/lib/nostr/signer-registry'

const EXTENSION_SK = generateSecretKey()
const EXTENSION_PUBKEY = getPublicKey(EXTENSION_SK)
const CREATED_AT = 1_700_000_000

const realWindow = globalThis.window

afterEach(() => {
	// Restore the bun-runtime default (no `window`, hence no `window.nostr`).
	globalThis.window = realWindow
})

describe('createExtensionSigner', () => {
	test('delegates getPublicKey and signEvent to the NIP-07 extension', async () => {
		const template = { kind: 1, content: 'hello', created_at: CREATED_AT, tags: [] as string[][] }
		const signedEvent = finalizeEvent(template, EXTENSION_SK)
		globalThis.window = {
			nostr: {
				getPublicKey: mock(async () => EXTENSION_PUBKEY),
				signEvent: mock(async () => signedEvent),
			},
		} as unknown as typeof window

		const capability = createExtensionSigner()

		expect(await capability.getPublicKey()).toBe(EXTENSION_PUBKEY)
		expect(await capability.signEvent(template)).toEqual(signedEvent)
	})

	test('exposes nip04 and nip44 when the extension provides them', () => {
		const nip04 = { encrypt: mock(async () => 'e4'), decrypt: mock(async () => 'd4') }
		const nip44 = { encrypt: mock(async () => 'e44'), decrypt: mock(async () => 'd44') }
		globalThis.window = {
			nostr: { getPublicKey: mock(async () => EXTENSION_PUBKEY), signEvent: mock(), nip04, nip44 },
		} as unknown as typeof window

		const capability = createExtensionSigner()

		expect(capability.nip04).toBe(nip04)
		expect(capability.nip44).toBe(nip44)
	})

	test('leaves nip04 and nip44 absent when the extension lacks them (fail closed)', () => {
		globalThis.window = {
			nostr: { getPublicKey: mock(async () => EXTENSION_PUBKEY), signEvent: mock() },
		} as unknown as typeof window

		const capability = createExtensionSigner()

		expect(capability.nip04).toBeUndefined()
		expect(capability.nip44).toBeUndefined()
	})

	test('getPublicKey rejects with a clear error when the extension is missing', async () => {
		globalThis.window = {} as unknown as typeof window // window present, but no injected `nostr`

		const capability = createExtensionSigner()

		await expect(capability.getPublicKey()).rejects.toThrow(/extension missing/i)
	})
})
