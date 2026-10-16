/**
 * The capability seam and the identity binding every signature passes through.
 *
 * The guards (`isSignerCapability`, `hasNip44`, `hasNip04`) are harvested from
 * the market's `src/lib/nostr/signer-capability.ts` at `4bc7f8c0`.
 *
 * {@link bindIdentity} is the module's single implementation of the ADR's
 * invariant I3 — *a returned signed event must be cryptographically valid and
 * satisfy `event.pubkey === getPublicKey()`* — harvested from the assertion the
 * market carries inside `createNostrConnectCapability`
 * (`src/lib/nostr/nostr-connect-signer.ts`) and applied here to **every** lane,
 * because in this module the operation is the session's, not one lane's.
 */
import { verifyEvent } from 'nostr-tools/pure'

import { IdentityMismatchError, IdentityUnresolvedError } from './errors'
import type { EncryptionScheme, NipEncryptionCapability, SignedEvent, SignerCapabilities, SignerCapability } from './types'

const HEX_PUBKEY = /^[0-9a-f]{64}$/i

/** Type guard: is this object a usable {@link SignerCapability}? */
/** #5f6a1c — isSignerCapability: the capability guard, contract because a consumer must ask what a signer has without re-deriving the predicate. */
export function isSignerCapability(value: unknown): value is SignerCapability {
	if (!value || typeof value !== 'object') return false
	const cap = value as Partial<SignerCapability>
	return typeof cap.getPublicKey === 'function' && typeof cap.signEvent === 'function'
}

/** Narrow a capability to one that can NIP-44 encrypt/decrypt. */
/** #5f6a1c — hasNip44: the NIP-44 capability guard, contract by the carrier map. */
export function hasNip44(cap: SignerCapability): cap is SignerCapability & { nip44: NipEncryptionCapability } {
	return hasEncryption(cap.nip44)
}

/** Narrow a capability to one that can NIP-04 encrypt/decrypt. */
/** #5f6a1c — hasNip04: the NIP-04 capability guard, contract by the carrier map. */
export function hasNip04(cap: SignerCapability): cap is SignerCapability & { nip04: NipEncryptionCapability } {
	return hasEncryption(cap.nip04)
}

/** #5f6a1c — hasEncryption: the guard's own predicate, the non-contract half the two public guards share. */
export function hasEncryption(value: unknown): value is NipEncryptionCapability {
	const candidate = value as Partial<NipEncryptionCapability> | undefined
	return typeof candidate?.encrypt === 'function' && typeof candidate?.decrypt === 'function'
}

/**
 * The capability set a session exposes, intersected with the composer's
 * allow-list: a scheme the composer did not allow is *not offered*, so asking
 * for it refuses (I4) instead of being used quietly.
 */
/** #acd841 — exposedCapabilities: the signer's schemes intersected with the composer's allow-list, the fail-closed default (I4). */
export function exposedCapabilities(
	capability: SignerCapability,
	allowed: EncryptionScheme[] | undefined,
	enabled?: { nip44?: boolean; nip04?: boolean },
): SignerCapabilities {
	const out: SignerCapabilities = {}
	if (schemeExposed('nip44', allowed, enabled) && hasNip44(capability)) out.nip44 = capability.nip44
	if (schemeExposed('nip04', allowed, enabled) && hasNip04(capability)) out.nip04 = capability.nip04
	return out
}

function schemeExposed(
	scheme: EncryptionScheme,
	allowed: EncryptionScheme[] | undefined,
	enabled?: { nip44?: boolean; nip04?: boolean },
): boolean {
	if (enabled && enabled[scheme] === false) return false
	if (!allowed || allowed.length === 0) return false
	return allowed.includes(scheme)
}

/**
 * The capability **as it is handed out**: identity-bound, and carrying only the
 * schemes {@link exposedCapabilities} kept (I4).
 *
 * I4 was previously applied only where the capability set is *reported*
 * (`capabilities()`, `encrypt`, `decrypt`, the snapshot) while the object the
 * contract hands out through `currentSigner()` still carried the ungated
 * schemes — so `hasNip44(session.currentSigner())` could answer `true` for a
 * scheme the composer had refused, and a consumer that reached for the
 * sub-object bypassed the allow-list entirely. The gate is now applied where the
 * capability is handed out, which is the only place that makes the spec's
 * "present if and only if the composer permits it" true.
 *
 * `getPublicKey` and `signEvent` are always carried: they are the capability
 * seam itself, gated by I2/I3 rather than by the allow-list, which is about
 * encryption only.
 */
/** #acd841 — gateCapability: the gate applied where the capability is handed out, not only where it is reported (I4). */
export function gateCapability(capability: SignerCapability, exposed: SignerCapabilities): SignerCapability {
	const gated: SignerCapability = {
		getPublicKey: () => capability.getPublicKey(),
		signEvent: (template) => capability.signEvent(template),
	}
	if (exposed.nip44) gated.nip44 = exposed.nip44
	if (exposed.nip04) gated.nip04 = exposed.nip04
	return gated
}

/**
 * Bind a capability to the identity it resolves (I2, I3).
 *
 * - the identity is learned only through `getPublicKey()`, and it must be a hex
 *   pubkey — nothing else in this module may promote a client key or a raw
 *   remote-signer field into an identity;
 * - every returned event is verified (`verifyEvent`, so a signature that does
 *   not check out fails closed) **and** its `pubkey` must equal the resolved
 *   identity;
 * - the resolved identity is cached for the lifetime of the binding, so the
 *   identity cannot change under a session without a new binding.
 */
/** #6f4c1c — bindIdentity: the module's single implementation of I3 [1:1], the identity binding every lane passes through. */
export function bindIdentity(capability: SignerCapability): SignerCapability {
	let resolved: string | undefined

	const resolveIdentity = async (): Promise<string> => {
		if (resolved !== undefined) return resolved
		const pubkey = await capability.getPublicKey()
		if (typeof pubkey !== 'string' || !HEX_PUBKEY.test(pubkey)) {
			throw new IdentityUnresolvedError('The signer did not resolve a hex public key')
		}
		resolved = pubkey.toLowerCase()
		return resolved
	}

	const bound: SignerCapability = {
		getPublicKey: () => resolveIdentity(),
		signEvent: async (template) => {
			const signed = (await capability.signEvent(template)) as SignedEvent
			const identity = await resolveIdentity()
			if (!signed || typeof signed !== 'object' || typeof signed.pubkey !== 'string') {
				throw new IdentityMismatchError('The signer returned something that is not a signed event')
			}
			if (signed.pubkey.toLowerCase() !== identity) {
				throw new IdentityMismatchError('The signer returned an event for a different pubkey than the authenticated identity')
			}
			if (!verifyEvent(signed)) {
				throw new IdentityMismatchError('The signer returned an event whose signature does not verify against the identity')
			}
			return signed
		},
	}
	if (capability.nip44) bound.nip44 = capability.nip44
	if (capability.nip04) bound.nip04 = capability.nip04
	return bound
}

/**
 * Decorate an encryption capability so every call is bounded by a deadline
 * (harvested from the market's `wrapEncryption`; the clock is injected here
 * rather than reached for).
 */
/** #179fde — withDeadline: every NIP-46 encryption call bounded by the injected per-RPC deadline. */
export function withDeadline(
	capability: NipEncryptionCapability,
	scheme: EncryptionScheme,
	timeoutMs: number,
	race: <T>(lane: string, operation: Promise<T>, timeoutMs: number) => Promise<T>,
): NipEncryptionCapability {
	return {
		encrypt: (pubkey, plaintext) => race(`${scheme}_encrypt`, capability.encrypt(pubkey, plaintext), timeoutMs),
		decrypt: (pubkey, ciphertext) => race(`${scheme}_decrypt`, capability.decrypt(pubkey, ciphertext), timeoutMs),
	}
}
