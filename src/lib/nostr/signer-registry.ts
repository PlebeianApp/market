/**
 * Signer registry — the single sanctioned home for `applesauce-signers`
 * imports (ADR-0008 "Signer registry and src/AGENTS.md reconciliation").
 *
 * `src/lib/stores/auth.ts` and UI components never import `applesauce-signers`
 * directly; they build signers through this registry and wrap them in the
 * `SignerCapability` seam (`signer-capability.ts`).
 *
 * The registry also holds the *currently attached* capability (module state),
 * which is how the io-applesauce `sign()` port routes through the
 * authenticated signer without reaching into the NDK store or the UI. A signer
 * is attached on login and cleared on logout.
 */
import { ExtensionSigner, PrivateKeySigner } from 'applesauce-signers'
import type { EventTemplate } from 'nostr-tools/pure'

import type { SignerCapability } from './signer-capability'

/** The currently attached signer capability, if a user has logged in. */
let attachedCapability: SignerCapability | undefined

/** Resolve the attached signer capability (undefined when logged out). */
export function getSignerCapability(): SignerCapability | undefined {
	return attachedCapability
}

/** Attach (or clear, with `undefined`) the current signer capability. */
export function setSignerCapability(capability: SignerCapability | undefined): void {
	attachedCapability = capability
}

/**
 * Teardown callback for the currently-attached signer session.
 *
 * The NIP-46 bunker lane attaches a teardown that closes its `NostrConnectSigner`
 * (unsubscribing the repeat()/retry() REQ subscription on the shared relay pool);
 * the local (nsec) and extension lanes have no teardown. See `runSignerTeardown`.
 */
let signerTeardown: (() => void | Promise<void>) | undefined

/** Register (or clear, with `undefined`) the teardown to run on signer detach. */
export function setSignerTeardown(teardown: (() => void | Promise<void>) | undefined): void {
	signerTeardown = teardown
}

/** Read the currently-registered teardown (undefined when none). */
export function getSignerTeardown(): (() => void | Promise<void>) | undefined {
	return signerTeardown
}

/**
 * Run and clear the registered signer teardown. Idempotent: the teardown is
 * cleared before it runs, so calling this from every detach chokepoint
 * (authActions.logout AND ndkActions.removeSigner) tears the signer down once.
 */
export async function runSignerTeardown(): Promise<void> {
	const teardown = signerTeardown
	signerTeardown = undefined
	if (teardown) await teardown()
}

/**
 * Build a local nsec signer (applesauce `PrivateKeySigner`) wrapped as a
 * {@link SignerCapability}. NIP-44/NIP-04 are the signer's LOCAL
 * implementations (non-optional for a key-held signer).
 *
 * `privateKey` may be a hex secret key or a `nsec1…` string —
 * `PrivateKeySigner.fromKey` normalizes both.
 */
export function createPrivateKeySigner(privateKey: string): SignerCapability {
	const signer = PrivateKeySigner.fromKey(privateKey)
	return {
		getPublicKey: () => signer.getPublicKey(),
		signEvent: (template) => signer.signEvent(template as EventTemplate),
		nip04: signer.nip04,
		nip44: signer.nip44,
	}
}

/**
 * Build a NIP-07 browser-extension signer (applesauce `ExtensionSigner`) wrapped
 * as a {@link SignerCapability}. There is no key held locally: `getPublicKey` /
 * `signEvent` delegate to `window.nostr`, and the extension-available check
 * surfaces as an `ExtensionMissingError` from `getPublicKey` when the extension
 * is absent.
 *
 * NIP-44 / NIP-04 are pass-throughs to `window.nostr.nip44` / `window.nostr.nip04`
 * — both are ABSENT when the extension does not expose the method, so NWC wallet
 * consumers that rely on NIP-04 fail closed at the adapter ("Signer does not
 * support NIP-04") instead of silently falling back.
 */
export function createExtensionSigner(): SignerCapability {
	const signer = new ExtensionSigner()
	return {
		getPublicKey: () => signer.getPublicKey(),
		signEvent: (template) => signer.signEvent(template as EventTemplate),
		nip04: signer.nip04,
		nip44: signer.nip44,
	}
}
