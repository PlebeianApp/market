/**
 * The lane builders: the four ways this module builds a signer.
 *
 * Harvested from the market at `4bc7f8c0` —
 * `src/lib/nostr/signer-registry.ts` (the NIP-07 and nsec lanes) and
 * `src/lib/nostr/password-signer-session.ts` (the NIP-49 lane, including the
 * locked-deadlock guard) — with one deliberate difference:
 *
 * **the NIP-07 lane's extension is an argument, not a global.** The market's
 * `createExtensionSigner()` takes no argument and reaches for
 * the browser's global extension object; here the extension object is injected
 * ({@link ExtensionTransportPort}), so the module reads no host global at all
 * and a host with no extension simply does not offer the lane. That is the
 * spec's requirement; the wrapper below still derives `nip04`/`nip44` from what
 * the extension actually exposes, so an extension without them yields a
 * capability without them (I4, fail closed).
 *
 * None of these builders bind an identity: binding happens once, in the
 * session's attach path (`bindIdentity`), so every lane crosses the same
 * assertion.
 */
import { PasswordSigner, PrivateKeySigner } from 'applesauce-signers'

import { hasEncryption } from './capability'
import { LaneUnavailableError, PasswordSignerLockedError } from './errors'
import type { ExtensionTransportPort, NipEncryptionCapability, SignerCapability } from './types'

/**
 * Wrap a NIP-07 extension object as a capability. There is no key held locally:
 * `getPublicKey` / `signEvent` delegate to the extension, and `nip04` / `nip44`
 * are present only when the extension actually exposes both halves of the pair
 * — absent otherwise, so a consumer that needs one fails closed at the
 * capability instead of silently falling back to a local key (I4).
 */
/** #597459 — createExtensionLane: the extension is an argument, not a global; nip04/nip44 present only when exposed (I4). */
export function createExtensionLane(extension: ExtensionTransportPort): SignerCapability {
	if (typeof extension?.getPublicKey !== 'function' || typeof extension?.signEvent !== 'function') {
		throw new LaneUnavailableError('The extension lane needs an extension exposing getPublicKey and signEvent')
	}
	const lane: SignerCapability = {
		getPublicKey: () => extension.getPublicKey(),
		signEvent: (template) => extension.signEvent(template),
	}
	if (hasEncryption(extension.nip04)) lane.nip04 = extension.nip04 as NipEncryptionCapability
	if (hasEncryption(extension.nip44)) lane.nip44 = extension.nip44 as NipEncryptionCapability
	return lane
}

/**
 * Build a local nsec signer (`PrivateKeySigner`) as a capability. NIP-44 and
 * NIP-04 are the signer's LOCAL implementations — non-optional for a key-held
 * signer. `material` may be a hex secret key or an `nsec1…` string.
 */
/** #8a5718 — createPrivateKeyLane: the local nsec lane, the signer's own NIP-44/NIP-04 implementations. */
export function createPrivateKeyLane(material: string): SignerCapability {
	const signer = PrivateKeySigner.fromKey(material)
	return {
		getPublicKey: () => signer.getPublicKey(),
		signEvent: (template) => signer.signEvent(template as Parameters<typeof signer.signEvent>[0]),
		nip04: signer.nip04,
		nip44: signer.nip44,
	}
}

/** A NIP-49 signer, its capability view, and the lock the session runs on end. */
/** #50e8e5 — PasswordSignerLane: the NIP-49 lane's signer, its capability view and the lock the session runs on end. */
export interface PasswordSignerLane {
	signer: PasswordSigner
	capability: SignerCapability
	/** Drop the in-memory key reference. The ncryptsec stays stored. */
	lock(): void
}

/**
 * Build a `PasswordSigner` from a stored ncryptsec (NIP-49), unlock it with the
 * user's password, and wrap it with the locked-deadlock guard. Throws when the
 * password is wrong ("failed to decrypt key: …").
 */
/** #50e8e5 — createPasswordSignerLane: the NIP-49 lane, unlocked with the password and wrapped with the locked guard. */
export async function createPasswordSignerLane(ncryptsec: string, password: string): Promise<PasswordSignerLane> {
	const signer = await PasswordSigner.fromNcryptsec(ncryptsec, password)
	return {
		signer,
		capability: createPasswordSignerCapability(signer),
		lock: () => signer.lock(),
	}
}

/**
 * The capability view of a `PasswordSigner` with the lock guard.
 *
 * `PasswordSigner` DEADLOCKS when any of `getPublicKey` / `signEvent` /
 * `nip04*` / `nip44*` is called while locked: the call awaits a `requestUnlock()`
 * deferred that nothing in the class ever resolves. The intended hook is
 * protected and no host drives a prompt through it — so every capability call is
 * gated on `signer.unlocked` and rejects fast with
 * {@link PasswordSignerLockedError} instead of hanging. This is a *behaviour*
 * the spec keeps (a locked signer rejects fast, it never hangs), and the error
 * *type* is implementation-local and may differ in the next language.
 */
/** #50e8e5 — createPasswordSignerCapability: every call gated on unlocked, rejecting fast rather than deadlocking. */
export function createPasswordSignerCapability(signer: PasswordSigner): SignerCapability {
	const assertUnlocked = () => {
		if (!signer.unlocked) throw new PasswordSignerLockedError()
	}
	return {
		getPublicKey: async () => {
			assertUnlocked()
			return signer.getPublicKey()
		},
		signEvent: async (template) => {
			assertUnlocked()
			return signer.signEvent(template as Parameters<typeof signer.signEvent>[0])
		},
		// nip04/nip44 behind the same guard: the library's
		// nip04Encrypt/nip04Decrypt/nip44Encrypt/nip44Decrypt all await a
		// never-resolved requestUnlock() deferred when locked, so passing the
		// sub-objects through unguarded would deadlock any consumer.
		nip04: {
			encrypt: async (pubkey, plaintext) => {
				assertUnlocked()
				return signer.nip04Encrypt(pubkey, plaintext)
			},
			decrypt: async (pubkey, ciphertext) => {
				assertUnlocked()
				return signer.nip04Decrypt(pubkey, ciphertext)
			},
		},
		nip44: {
			encrypt: async (pubkey, plaintext) => {
				assertUnlocked()
				return signer.nip44Encrypt(pubkey, plaintext)
			},
			decrypt: async (pubkey, ciphertext) => {
				assertUnlocked()
				return signer.nip44Decrypt(pubkey, ciphertext)
			},
		},
	}
}
