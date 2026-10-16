/**
 * The signer module's contract entry — the first implementation (TypeScript).
 *
 * This file exports **exactly** what `signer/signer.md` declares in its
 * `contract` front-matter: the thirteen session operations (as the members of
 * {@link SignerSession}), the session-less construct-on-key entry, the
 * vocabulary the spec defines, and the typed refusals. Nothing here names a
 * host, a framework, a store, a relay library or a marketplace concept.
 *
 * The implementation behind these names is harvested from
 * `PlebeianApp/market@4bc7f8c0` and credited in the module MD; the host
 * concerns the harvest mixed in are gone — storage, transport, timers and
 * crypto primitives are ports, and the NIP-07 extension is an argument rather
 * than a browser global.
 */
import { capabilityToken, type CapabilityToken } from '../../capability/ts'
import type { SignerCapability } from './types'

export { createSignerFromKey, createSignerSession } from './session'
export type { SignerSession } from './session'

// The capability seam and its guards: how a consumer asks what a signer has.
export { hasNip04, hasNip44, isSignerCapability } from './capability'

// The NIP-07 lane, for a host that has an extension object to wrap. The extension is an **argument** here, never
// a global: the module never reaches for `window.nostr` itself, and the lane refuses an extension that does not
// expose both halves of the pair it claims.
export { createExtensionLane } from './lanes'

/**
 * `#acd841` SIGNER — the token that binds {@link SignerCapability} to its stable runtime id, declared beside
 * the interface it names in the module that declares it (the rule `BID` and `CART_ADD` follow). A surface
 * asks `caps.of(SIGNER)` and renders one of present/absent/disabled/refused; it never imports the plugin that
 * satisfies it, and with no signer composed the answer is `absent` — nothing, never a button that cannot sign.
 */
export const SIGNER: CapabilityToken<SignerCapability> = capabilityToken<SignerCapability>('signer', 'the signer')

// The typed refusals. Every fail-closed path raises one of these.
export {
	AuthSinkRequiredError,
	CapabilityUnavailableError,
	ClockRequiredError,
	IdentityMismatchError,
	IdentityUnresolvedError,
	InvalidTransitionError,
	LaneUnavailableError,
	Nip46RpcTimeoutError,
	NoActiveSessionError,
	PasswordSignerLockedError,
	PortError,
	SessionAttachedError,
	SessionVaultError,
	SignerError,
	TransportRequiredError,
} from './errors'

// Which fail-closed vault rule fired, as a closed list of codes (M8).
export type { SessionVaultCode } from './errors'

// The record the module owns: the envelope's storage keys and the KDF floor a
// second implementation of this spec must not lower (I5).
export { LEGACY_CONNECT_URL_KEY, LEGACY_LOCAL_SIGNER_KEY, MIN_PBKDF2_ITERATIONS, PBKDF2_ITERATIONS, VAULT_STORAGE_KEY } from './vault'

// The vocabulary the spec defines.
export type {
	ClockPort,
	CryptoPort,
	EncryptionScheme,
	EventTemplate,
	ExtensionTransportPort,
	LaneAvailability,
	LaneKind,
	NipEncryptionCapability,
	NostrEvent,
	PassphraseSource,
	RestoreInput,
	RpcTimeoutSettings,
	SessionAtRestSettings,
	SessionObserver,
	SessionRecordKind,
	SessionSnapshot,
	SessionStartInput,
	SessionState,
	SignedEvent,
	SignerCapabilities,
	SignerCapability,
	SignerDeps,
	SignerPorts,
	SignerSettings,
	StoragePort,
	TransportPort,
} from './types'
