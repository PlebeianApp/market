/**
 * Signer capability seam — the app-owned abstraction every login lane
 * implements, independent of the concrete signer library (NDK today,
 * `applesauce-signers` going forward; see ADR-0008).
 *
 * A capability is deliberately narrower than NDK's `NDKSigner`: it exposes
 * only the two things the app structurally depends on — resolving the
 * authenticated user pubkey and signing an event — plus OPTIONAL NIP-44 /
 * NIP-04 symmetric encryption. Anything NDK-specific (`blockUntilReady`,
 * `.on('authUrl')`, `.user()` → `NDKUser`, `encryptionEnabled`) is re-derived
 * by the NDK adapter in `ndk-signer-adapter.ts`, so consumers keep working
 * unchanged while the signer seat migrates.
 *
 * NIP-44 / NIP-04 are optional on purpose: a NIP-07 extension that lacks
 * `window.nostr.nip44` (or `nip04`) supplies neither, and callers MUST fail
 * closed when the capability they need is absent — the library does not
 * guarantee it for them.
 */
import type { EventTemplate, NostrEvent } from 'nostr-tools/pure'

/** NIP-04 (legacy) and NIP-44 share this exact encryption shape. */
export interface NipEncryptionCapability {
	encrypt(pubkey: string, plaintext: string): Promise<string>
	decrypt(pubkey: string, ciphertext: string): Promise<string>
}

export interface SignerCapability {
	/** Resolve the authenticated user's public key (hex). */
	getPublicKey(): Promise<string>
	/** Sign an event template (or already-shaped event), returning a fully signed event. */
	signEvent(template: EventTemplate | NostrEvent): Promise<NostrEvent>
	nip44?: NipEncryptionCapability
	nip04?: NipEncryptionCapability
}

/** Type guard: is this object a usable {@link SignerCapability}? */
export function isSignerCapability(value: unknown): value is SignerCapability {
	if (!value || typeof value !== 'object') return false
	const cap = value as Partial<SignerCapability>
	return typeof cap.getPublicKey === 'function' && typeof cap.signEvent === 'function'
}

/** Narrow a capability to one that can NIP-44 encrypt/decrypt. */
export function hasNip44(cap: SignerCapability): cap is SignerCapability & { nip44: NipEncryptionCapability } {
	return hasEncryption(cap.nip44)
}

/** Narrow a capability to one that can NIP-04 encrypt/decrypt. */
export function hasNip04(cap: SignerCapability): cap is SignerCapability & { nip04: NipEncryptionCapability } {
	return hasEncryption(cap.nip04)
}

function hasEncryption(value: NipEncryptionCapability | undefined): value is NipEncryptionCapability {
	return typeof value?.encrypt === 'function' && typeof value?.decrypt === 'function'
}
