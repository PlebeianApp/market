/**
 * Adapter tests — NdkSignerAdapter over a SignerCapability.
 *
 * The happy enc/dec round-trips use the REAL `PrivateKeySigner` (local lane),
 * whose `nip04`/`nip44` are the local nostr-tools implementations — so these
 * prove the adapter preserves local-lane NIP-04 parity + explicit NIP-44.
 * Fixture identities are always derived keys (never fake pubkeys).
 */
import { describe, expect, mock, test } from 'bun:test'
import { PrivateKeySigner } from 'applesauce-signers'
import { getEventHash, verifyEvent } from 'nostr-tools'

// Stub the NDK singleton so the adapter loads without the full NDK graph.
// The adapter only calls ndkActions.getNDK(); the store is otherwise inert.
const mockNdkActions = {
	getNDK: mock(() => null),
}
mock.module('@/lib/stores/ndk', () => ({
	ndkActions: mockNdkActions,
	ndkStore: { state: {} },
	getWriteRelays: () => [],
}))

import { NDKUser } from '@/lib/nostr/ndk-events'
import { NdkSignerAdapter } from '@/lib/nostr/ndk-signer-adapter'
import type { SignerCapability } from '@/lib/nostr/signer-capability'

const CREATED_AT = 1_700_000_000

/** Wrap a concrete applesauce local signer as the app's capability. */
function capabilityFor(signer: PrivateKeySigner): SignerCapability {
	return {
		getPublicKey: () => signer.getPublicKey(),
		signEvent: (template) => signer.signEvent(template as Parameters<PrivateKeySigner['signEvent']>[0]),
		nip04: signer.nip04,
		nip44: signer.nip44,
	}
}

function unsignedEvent(pubkey: string) {
	return {
		kind: 1,
		content: 'hello world',
		created_at: CREATED_AT,
		tags: [] as string[][],
		pubkey,
	}
}

describe('NdkSignerAdapter', () => {
	test('signs an event with a valid signature for the capability pubkey', async () => {
		const signer = PrivateKeySigner.fromKey(crypto.getRandomValues(new Uint8Array(32)))
		const pubkey = await signer.getPublicKey()
		const adapter = new NdkSignerAdapter(capabilityFor(signer))

		const sig = await adapter.sign(unsignedEvent(pubkey))
		const event = { ...unsignedEvent(pubkey), id: getEventHash(unsignedEvent(pubkey)), sig }

		expect(verifyEvent(event)).toBe(true)
		expect(event.pubkey).toBe(pubkey)
	})

	test('rejects an event signed for a different pubkey than the capability (fail closed)', async () => {
		const userSigner = PrivateKeySigner.fromKey(crypto.getRandomValues(new Uint8Array(32)))
		const userPubkey = await userSigner.getPublicKey()
		const attackerSigner = PrivateKeySigner.fromKey(crypto.getRandomValues(new Uint8Array(32)))

		// A signer that presents the user's pubkey but signs with the attacker key.
		const malicious: SignerCapability = {
			getPublicKey: () => userSigner.getPublicKey(),
			signEvent: (template) => attackerSigner.signEvent(template as Parameters<PrivateKeySigner['signEvent']>[0]),
		}
		const adapter = new NdkSignerAdapter(malicious)

		await expect(adapter.sign(unsignedEvent(userPubkey))).rejects.toThrow(/different pubkey/)
	})

	test('resolves user() to the capability pubkey without a relay fetch', async () => {
		const signer = PrivateKeySigner.fromKey(crypto.getRandomValues(new Uint8Array(32)))
		const pubkey = await signer.getPublicKey()
		const adapter = new NdkSignerAdapter(capabilityFor(signer))

		const user = await adapter.user()

		expect(user.pubkey).toBe(pubkey)
		expect(adapter.pubkey).toBe(pubkey)
		// user() must be fetch-free: with NDK absent it still resolves.
		expect(mockNdkActions.getNDK).toHaveBeenCalled()
	})

	test('NIP-04 wallet round-trip through the adapter (local lane, parity default)', async () => {
		const alice = PrivateKeySigner.fromKey(crypto.getRandomValues(new Uint8Array(32)))
		const bob = PrivateKeySigner.fromKey(crypto.getRandomValues(new Uint8Array(32)))
		const aliceAdapter = new NdkSignerAdapter(capabilityFor(alice))
		const bobAdapter = new NdkSignerAdapter(capabilityFor(bob))
		const bobUser = new NDKUser({ pubkey: await bob.getPublicKey() })
		const aliceUser = new NDKUser({ pubkey: await alice.getPublicKey() })

		const plaintext = 'wallet secret payload'
		const ciphertext = await aliceAdapter.encrypt(bobUser, plaintext)
		expect(ciphertext).not.toBe(plaintext)
		const recovered = await bobAdapter.decrypt(aliceUser, ciphertext)
		expect(recovered).toBe(plaintext)

		// Reverse direction: bob -> alice.
		const reply = await bobAdapter.encrypt(aliceUser, 'accepted')
		expect(await aliceAdapter.decrypt(bobUser, reply)).toBe('accepted')
	})

	test('NIP-44 encrypt/decrypt round-trip when explicitly requested', async () => {
		const alice = PrivateKeySigner.fromKey(crypto.getRandomValues(new Uint8Array(32)))
		const bob = PrivateKeySigner.fromKey(crypto.getRandomValues(new Uint8Array(32)))
		const aliceAdapter = new NdkSignerAdapter(capabilityFor(alice))
		const bobAdapter = new NdkSignerAdapter(capabilityFor(bob))
		const bobUser = new NDKUser({ pubkey: await bob.getPublicKey() })
		const aliceUser = new NDKUser({ pubkey: await alice.getPublicKey() })

		const plaintext = 'nip44 message'
		const ciphertext = await aliceAdapter.encrypt(bobUser, plaintext, 'nip44')
		const recovered = await bobAdapter.decrypt(aliceUser, ciphertext, 'nip44')
		expect(recovered).toBe(plaintext)
	})

	test('fails closed when the requested encryption scheme is absent', async () => {
		const signer = PrivateKeySigner.fromKey(crypto.getRandomValues(new Uint8Array(32)))
		const pubkey = await signer.getPublicKey()
		const bare: SignerCapability = {
			getPublicKey: () => signer.getPublicKey(),
			signEvent: (template) => signer.signEvent(template as Parameters<PrivateKeySigner['signEvent']>[0]),
			// neither nip04 nor nip44
		}
		const adapter = new NdkSignerAdapter(bare)
		const recipient = new NDKUser({ pubkey })

		await expect(adapter.encrypt(recipient, 'x')).rejects.toThrow('NIP-04')
		await expect(adapter.encrypt(recipient, 'x', 'nip44')).rejects.toThrow('NIP-44')
		await expect(adapter.decrypt(recipient, 'x')).rejects.toThrow('NIP-04')
		await expect(adapter.decrypt(recipient, 'x', 'nip44')).rejects.toThrow('NIP-44')
	})

	test('reports the schemes the capability actually provides', async () => {
		const signer = PrivateKeySigner.fromKey(crypto.getRandomValues(new Uint8Array(32)))
		const adapter = new NdkSignerAdapter(capabilityFor(signer))

		expect(await adapter.encryptionEnabled()).toEqual(['nip04', 'nip44'])
		expect(await adapter.encryptionEnabled('nip44')).toEqual(['nip44'])
		expect(await adapter.encryptionEnabled('nip04')).toEqual(['nip04'])

		const bareAdapter = new NdkSignerAdapter({
			getPublicKey: () => signer.getPublicKey(),
			signEvent: (template) => signer.signEvent(template as Parameters<PrivateKeySigner['signEvent']>[0]),
		})
		expect(await bareAdapter.encryptionEnabled()).toEqual([])
		expect(await bareAdapter.encryptionEnabled('nip44')).toEqual([])
	})
})
