/**
 * Interim NIP-46 → SignerCapability bridge (ADR-0008).
 *
 * Until B-2 migrates the bunker lane to applesauce `NostrConnectSigner`, the
 * NIP-46 login lane still runs on NDK's `NDKNip46Signer`. The A3-4 seam flip
 * (nip59.ts, privateOrderMessage, publish/orders.tsx, queries/orders.tsx)
 * consumes `SignerCapability` ONLY — an NDK-backed bunker login that never
 * attached a capability would throw "Encrypted seller delivery could not be
 * prepared" for buyers and silently no-op seller decryption.
 *
 * This bridge wraps the `NDKNip46Signer` in the same `SignerCapability` shape
 * the nsec (PrivateKeySigner) and NIP-07 (ExtensionSigner) lanes already
 * produce, so ALL four lanes flow through one seam. It lives here — not in the
 * applesauce `signer-registry` — because the wrapped signer is NDK, not
 * applesauce. It is deleted when B-2 lands `NostrConnectSigner`.
 *
 * Mapping note: NDK's `sign()` returns only the signature string over a
 * pre-computed event id (the bunker signs via `sign_event` RPC), so the bridge
 * computes the canonical id itself with `getEventHash` and returns a fully
 * signed `NostrEvent` — the inverse of how `NdkSignerAdapter` consumes the
 * capability's `signEvent`.
 */
import { getEventHash } from 'nostr-tools'
import type { EventTemplate, NostrEvent } from 'nostr-tools/pure'

import { NDKNip46Signer, NDKUser } from './ndk-events'
import type { NipEncryptionCapability, SignerCapability } from './signer-capability'

type NdkSignableEvent = Parameters<NDKNip46Signer['sign']>[0]
type NdkInstance = ConstructorParameters<typeof NDKNip46Signer>[0]
type Nip46LocalSigner = ConstructorParameters<typeof NDKNip46Signer>[2]

export type Nip46SignerBundle = {
	signer: NDKNip46Signer
	capability: SignerCapability
}

/**
 * Construct the NDK bunker signer and wrap it in the signer capability seam.
 * This is the single place the NIP-46 lane touches `NDKNip46Signer`, so the
 * auth store calls one bridge function instead of importing NDK directly.
 */
export function createNip46Signer(ndk: NdkInstance, bunkerUrl: string, localSigner: Nip46LocalSigner): Nip46SignerBundle {
	const signer = new NDKNip46Signer(ndk, bunkerUrl, localSigner)
	return { signer, capability: createNip46SignerCapability(signer) }
}

/** Minimal structural surface of an NDK bunker signer the bridge consumes. */
export type Nip46BunkerSignerLike = {
	blockUntilReady(): Promise<unknown>
	getPublicKey(): Promise<string>
	sign(event: { kind?: number; tags: string[][]; content: string; created_at: number; id?: string }): Promise<string>
	encrypt(recipient: { pubkey: string }, value: string, scheme?: string): Promise<string>
	decrypt(sender: { pubkey: string }, value: string, scheme?: string): Promise<string>
}

export function createNip46SignerCapability(signer: Nip46BunkerSignerLike): SignerCapability {
	return {
		getPublicKey: async () => {
			await signer.blockUntilReady()
			return signer.getPublicKey()
		},
		signEvent: async (template) => signNip46Event(signer, template),
		nip44: nip46Encryption(signer, 'nip44'),
		nip04: nip46Encryption(signer, 'nip04'),
	}
}

/**
 * Sign a template (or partially-shaped event) through the bunker: resolve the
 * signer pubkey (from the template when present, else the bunker's
 * `get_public_key` RPC), compute the canonical event id, then return the fully
 * signed event.
 */
async function signNip46Event(signer: Nip46BunkerSignerLike, template: EventTemplate | NostrEvent): Promise<NostrEvent> {
	const pubkey = ('pubkey' in template && template.pubkey) || (await signer.getPublicKey())
	const unsigned = {
		kind: template.kind,
		content: template.content,
		created_at: template.created_at,
		tags: template.tags,
		pubkey,
	}
	const id = getEventHash(unsigned)
	const sig = await signer.sign({ ...unsigned, id } as NdkSignableEvent)
	return { ...unsigned, id, sig }
}

/** NIP-44 / NIP-04 delegated to the bunker's encrypt/decrypt RPC. */
function nip46Encryption(signer: Nip46BunkerSignerLike, scheme: 'nip04' | 'nip44'): NipEncryptionCapability {
	return {
		encrypt: (pubkey, plaintext) => signer.encrypt(new NDKUser({ pubkey }), plaintext, scheme),
		decrypt: (pubkey, ciphertext) => signer.decrypt(new NDKUser({ pubkey }), ciphertext, scheme),
	}
}
