/**
 * PasswordSigner session builder (ADR-0008 B-3, signers-api-audit gap 4).
 *
 * `PasswordSigner` (NIP-49 ncryptsec) DEADLOCKS when any of
 * `getPublicKey` / `signEvent` / `nip04*` / `nip44*` is called while
 * locked: the call awaits a `requestUnlock()` Deferred that nothing in the
 * class ever resolves. The intended hook is protected and the app does not
 * drive a prompt through it — so every capability call is gated on
 * `signer.unlocked` and rejects fast with {@link PasswordSignerLockedError}
 * instead of hanging. Unlocking goes through the UI prompt
 * (`authActions.unlockVaultedSession` / the ncryptsec decrypt dialog) and
 * `lock()` runs on logout.
 *
 * This is the sanctioned `applesauce-signers` import home for the NIP-49
 * lane (the signer registry, ADR-0008).
 */
import { PasswordSigner } from 'applesauce-signers'
import type { EventTemplate } from 'nostr-tools/pure'

import type { SignerCapability } from './signer-capability'

/** Raised when a capability call hits a locked PasswordSigner (gap 4 guard). */
export class PasswordSignerLockedError extends Error {
	constructor() {
		super('PasswordSigner is locked — unlock it through the password prompt before signing')
		this.name = 'PasswordSignerLockedError'
	}
}

export interface PasswordSignerSession {
	/** The wrapped applesauce PasswordSigner (locked after `session.lock()`). */
	signer: PasswordSigner
	/** Capability-seam view; every call gated on `unlocked`. */
	capability: SignerCapability
	/** Zero the in-memory key (lock-on-logout). The ncryptsec stays stored. */
	lock(): void
}

/**
 * Build a `PasswordSigner` from a stored ncryptsec, unlock it with the
 * user's password, and wrap it as a {@link SignerCapability} with the
 * locked-deadlock guard. Throws when the password is wrong
 * ("failed to decrypt key: …").
 */
export async function createPasswordSignerSession(ncryptsec: string, password: string): Promise<PasswordSignerSession> {
	const signer = await PasswordSigner.fromNcryptsec(ncryptsec, password)
	return {
		signer,
		capability: createPasswordSignerCapability(signer),
		lock: () => signer.lock(),
	}
}

/** The capability view of a `PasswordSigner` with the gap-4 lock guard. */
export function createPasswordSignerCapability(signer: PasswordSigner): SignerCapability {
	const assertUnlocked = () => {
		if (!signer.unlocked) throw new PasswordSignerLockedError()
	}
	return {
		getPublicKey: async () => {
			assertUnlocked()
			return signer.getPublicKey()
		},
		signEvent: async (template: EventTemplate | Parameters<PasswordSigner['signEvent']>[0]) => {
			assertUnlocked()
			return signer.signEvent(template as EventTemplate)
		},
		// nip04/nip44 behind the same gap-4 guard: the library's
		// nip04Encrypt/nip04Decrypt/nip44Encrypt/nip44Decrypt all await a
		// never-resolved requestUnlock() Deferred when locked — passing the
		// sub-objects through unguarded would deadlock any consumer.
		nip04: {
			encrypt: async (pubkey: string, plaintext: string) => {
				assertUnlocked()
				return signer.nip04Encrypt(pubkey, plaintext)
			},
			decrypt: async (pubkey: string, ciphertext: string) => {
				assertUnlocked()
				return signer.nip04Decrypt(pubkey, ciphertext)
			},
		},
		nip44: {
			encrypt: async (pubkey: string, plaintext: string) => {
				assertUnlocked()
				return signer.nip44Encrypt(pubkey, plaintext)
			},
			decrypt: async (pubkey: string, ciphertext: string) => {
				assertUnlocked()
				return signer.nip44Decrypt(pubkey, ciphertext)
			},
		},
	}
}
