/**
 * NDKSigner adapter over a {@link SignerCapability}.
 *
 * Keeps the ~25 files / ~70 call sites that call `signer.user()` (and the two
 * NWC wallet consumers that call `signer.encrypt`/`decrypt` with NDK's NIP-04
 * default — `publish/wallet.tsx:47`, `queries/wallet.tsx:62`) working unchanged
 * while the underlying signer migrates off NDK (Wave A3). It is deleted in
 * Wave D alongside the NDK singleton.
 *
 * Fail-closed invariants are enforced HERE because the signer library does not
 * provide them (see signers-api-audit.md gaps):
 * - `sign` asserts the returned event's `pubkey` equals the capability's
 *   `getPublicKey()` before returning the signature (gap 4 — the library runs
 *   `verifyEvent` only, and never checks the pubkey).
 * - `encrypt`/`decrypt` preserve NIP-04 as the DEFAULT scheme (parity with the
 *   wallet consumers' current NDK behaviour) and route NIP-44 only on explicit
 *   request — both throw when the capability lacks the requested scheme.
 */
import type { NDKSigner, NDKEncryptionScheme } from '@/lib/nostr/ndk-events'
import { NDKUser } from '@/lib/nostr/ndk-events'
import { ndkActions } from '@/lib/stores/ndk'
import type { NostrEvent } from 'nostr-tools/pure'
import { hasNip04, hasNip44, type SignerCapability } from './signer-capability'

/** The exact event shape NDK's signer-sign contract accepts. */
type NdkSignableEvent = Parameters<NDKSigner['sign']>[0]

export class NdkSignerAdapter implements NDKSigner {
	private readonly capability: SignerCapability
	private cachedPubkey?: string
	private cachedUser?: NDKUser

	constructor(capability: SignerCapability) {
		if (!capability) throw new Error('Cannot build a signer adapter without a signer capability')
		this.capability = capability
	}

	get pubkey(): string {
		if (!this.cachedPubkey) throw new Error('Not ready')
		return this.cachedPubkey
	}

	get userSync(): NDKUser {
		if (!this.cachedUser) throw new Error('Not ready')
		return this.cachedUser
	}

	async blockUntilReady(): Promise<NDKUser> {
		return this.user()
	}

	async user(): Promise<NDKUser> {
		const pubkey = await this.capability.getPublicKey()
		this.cachedPubkey = pubkey
		// Fetch-free: resolve an NDKUser from the capability pubkey without any
		// relay round-trip. Consumers that need a profile fetch keep their own
		// fetch ordering (see codebase-audit.md §2).
		const ndk = ndkActions.getNDK()
		this.cachedUser = ndk ? ndk.getUser({ pubkey }) : new NDKUser({ pubkey })
		return this.cachedUser
	}

	async sign(event: NdkSignableEvent): Promise<string> {
		const capabilityPubkey = await this.capability.getPublicKey()
		const signed = await this.capability.signEvent(event as unknown as NostrEvent)
		if (signed.pubkey !== capabilityPubkey) {
			throw new Error('Signer returned an event for a different pubkey than the authenticated user')
		}
		return signed.sig
	}

	async encryptionEnabled(scheme?: NDKEncryptionScheme): Promise<NDKEncryptionScheme[]> {
		const enabled: NDKEncryptionScheme[] = []
		if (hasNip04(this.capability)) enabled.push('nip04')
		if (hasNip44(this.capability)) enabled.push('nip44')
		if (!scheme) return enabled
		return enabled.includes(scheme) ? [scheme] : []
	}

	async encrypt(recipient: NDKUser, value: string, scheme?: NDKEncryptionScheme): Promise<string> {
		if (scheme === 'nip44') {
			if (!hasNip44(this.capability)) throw new Error('Signer does not support NIP-44 encryption')
			return this.capability.nip44.encrypt(recipient.pubkey, value)
		}
		// NIP-04 parity: NDK's default scheme for the wallet consumers is nip04.
		if (!hasNip04(this.capability)) throw new Error('Signer does not support NIP-04 encryption')
		return this.capability.nip04.encrypt(recipient.pubkey, value)
	}

	async decrypt(sender: NDKUser, value: string, scheme?: NDKEncryptionScheme): Promise<string> {
		if (scheme === 'nip44') {
			if (!hasNip44(this.capability)) throw new Error('Signer does not support NIP-44 decryption')
			return this.capability.nip44.decrypt(sender.pubkey, value)
		}
		if (!hasNip04(this.capability)) throw new Error('Signer does not support NIP-04 decryption')
		return this.capability.nip04.decrypt(sender.pubkey, value)
	}

	/**
	 * The capability seam has no serialized form; NDK's `toPayload` is not used
	 * by the app (session persistence is handled elsewhere, ADR-0008 Wave B).
	 */
	toPayload(): string {
		return JSON.stringify({ type: 'signer-capability-adapter' })
	}
}
