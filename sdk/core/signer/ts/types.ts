/**
 * The module's vocabulary — the nouns the spec (`signer/signer.md`) defines.
 *
 * Nothing host-shaped appears here: no framework, no storage API, no browser
 * global, no relay library, no marketplace concept. What a host *is* — a
 * browser, a CLI, a Rust binary, a Flutter app — arrives as a **port**: an
 * interface this module calls and whoever composes it implements.
 *
 * Harvested from `PlebeianApp/market@4bc7f8c0` (the capability seam is
 * `src/lib/nostr/signer-capability.ts`); extended with the session vocabulary
 * the spec defines and the market keeps in `src/lib/stores/auth.ts` — the
 * surface this module replaces.
 */
import type { ObservableInput } from 'rxjs'

/**
 * A NIP-01 event template: the fields a caller prepares, without the identity
 * the signer supplies.
 *
 * Declared here, structurally, rather than borrowed from a library: the
 * contract's nouns are protocol-level — #07df21 (provenance) — and an implementation in
 * another language names this shape in its own idioms. The first
 * implementation's library defines the same shape, and the two are
 * interchangeable by structure, so nothing needs a cast at the seam.
 */
/** #07df21 (provenance) — EventTemplate: a NIP-01 event template, declared structurally rather than borrowed. */
export interface EventTemplate {
	kind: number
	tags: string[][]
	content: string
	created_at: number
}

/** A signed NIP-01 event: a template plus its id, author and signature. */
/** #07df21 (provenance) — NostrEvent: a signed NIP-01 event: a template plus its id, author and signature. */
export interface NostrEvent extends EventTemplate {
	id: string
	pubkey: string
	sig: string
}

/** A fully signed event, as the module returns it. */
/** #07df21 (provenance) — SignedEvent: the fully signed event, as the module returns it. */
export type SignedEvent = NostrEvent

/** The five ways a session can be established. */
/** #8a5718 — LaneKind: the five ways a session can be established. */
export type LaneKind = 'extension' | 'nsec' | 'ncryptsec' | 'bunker' | 'nostrconnect'

/** The two optional encryption schemes a signer may provide. */
/** #acd841 — EncryptionScheme: the two optional encryption schemes a signer may provide. */
export type EncryptionScheme = 'nip04' | 'nip44'

/** NIP-04 (legacy) and NIP-44 share this exact encryption shape. */
/** #acd841 — NipEncryptionCapability: the NIP-04/NIP-44 encrypt/decrypt pair a capability exposes. */
export interface NipEncryptionCapability {
	encrypt(pubkey: string, plaintext: string): Promise<string>
	decrypt(pubkey: string, ciphertext: string): Promise<string>
}

/**
 * The capability seam: the two things a session structurally depends on, plus
 * OPTIONAL NIP-44 / NIP-04 symmetric encryption.
 *
 * NIP-44 / NIP-04 are optional on purpose (I4): a NIP-07 extension that lacks
 * `nip44`, or a NIP-46 remote that lacks the RPC, supplies neither, and callers
 * MUST fail closed when the capability they need is absent — nothing in this
 * module may synthesise NIP-44 from a key the user never exposed.
 */
/** #acd841 — SignerCapability: the capability seam — identity reads/signs, encryption optional by construction (I4). */
export interface SignerCapability {
	/** Resolve the authenticated identity's public key (hex). The only identity read (I2). */
	getPublicKey(): Promise<string>
	/** Sign an event template (or an already-shaped event), returning a fully signed event. */
	signEvent(template: EventTemplate | NostrEvent): Promise<SignedEvent>
	nip44?: NipEncryptionCapability | undefined
	nip04?: NipEncryptionCapability | undefined
}

/** The capability set a session exposes, after the composer's allow-list is applied. */
/** #acd841 — SignerCapabilities: the capability set a session exposes, after the composer's allow-list. */
export interface SignerCapabilities {
	nip04?: NipEncryptionCapability
	nip44?: NipEncryptionCapability
}

// ---------------------------------------------------------------------------
// The states a session may be in (spec §1.4)
// ---------------------------------------------------------------------------

/** #61f309 — SessionState: a session is a state machine, never a boolean. */
export type SessionState = 'idle' | 'connecting' | 'awaiting_user' | 'active' | 'locked' | 'restoring' | 'closing' | 'failed'

/** What is persisted for this session, read separately from the state (I5). */
/** #61f309 — SessionRecordKind: what is persisted, read separately from the state (I5). */
export type SessionRecordKind = 'none' | 'vaulted' | 'legacy_plaintext'

/**
 * An observed snapshot of the session. The session is a state machine, not a
 * boolean, and the capability set, the identity and the persisted-record kind
 * are read separately from the state rather than folded into it.
 */
/** #61f309 — SessionSnapshot: the observed state plus the separately-read capability set, identity and record kind. */
export interface SessionSnapshot {
	state: SessionState
	/** The resolved identity, present only while it has been resolved (I2). */
	pubkey?: string
	/** The lane the current session was established from. */
	lane?: LaneKind
	/** Which schemes are actually present — never a promise of what might be. */
	capabilities: { nip04: boolean; nip44: boolean }
	/** What is persisted at rest. */
	record: SessionRecordKind
	/** A typed reason, present on `failed`. */
	reason?: string
}

/** #8a5718 — SessionObserver: the listener observeSession registers. */
export type SessionObserver = (snapshot: SessionSnapshot) => void

// ---------------------------------------------------------------------------
// The ports: everything environmental, injected by whoever composes the module
// ---------------------------------------------------------------------------

/**
 * Opaque key/value storage. A host supplies its own: the browser's key/value
 * store, a file in a CLI, a platform keystore on mobile, nothing at all when the
 * session must stay in memory. Sync or async — the module awaits either.
 */
/** #179fde — StoragePort: opaque key/value storage, the host's, holding the persisted record. */
export interface StoragePort {
	getItem(key: string): string | null | Promise<string | null>
	setItem(key: string, value: string): void | Promise<void>
	removeItem(key: string): void | Promise<void>
}

/**
 * The relay transport for the NIP-46 lanes: a subscription source and a
 * publish function. The module never opens — or reaches for — a relay layer of
 * its own; a lane without an injected transport refuses instead.
 *
 * `ObservableInput` is the **one contract type borrowed from the implementation's
 * ecosystem** — #07df21 (provenance): the named exception, recorded in the spec — it means
 * "whatever the first implementation's observable library can consume", which is
 * a real property of the port rather than a naming choice — a host that returns
 * a hand-rolled push source the library cannot consume would type-check and fail
 * at run time. The *operation* and its semantics are the contract: a push source
 * shaped as the host's idiom for one, plus a publish function. A second
 * implementation types it as its own equivalent and adapts at its boundary.
 */
/** #179fde — TransportPort: the injected relay transport; its ObservableInput push source is the one named ecosystem exception — #07df21 (provenance). */
export interface TransportPort {
	subscription(relays: string[], filters: unknown[]): ObservableInput<NostrEvent | string>
	publish(relays: string[], event: NostrEvent): Promise<unknown> | ObservableInput<unknown>
}

/** Deadlines. Injected, so the module holds no timer of its own. */
/** #179fde — ClockPort: deadlines, injected so the module holds no timer of its own. */
export interface ClockPort {
	setTimeout(handler: () => void, ms: number): unknown
	clearTimeout(handle: unknown): void
}

/**
 * The cryptographic primitives the session vault needs: fresh randomness,
 * PBKDF2-SHA256 and AES-GCM-256. The **floor** (PBKDF2-SHA256 at or above the
 * accepted minimum, AES-GCM-256) is the module's and is spec; the primitives
 * are the host's, and the derived-key handle is opaque to this module.
 */
/** #179fde — CryptoPort: randomness, PBKDF2-SHA256 and AES-GCM-256; the floor is spec, the primitives are the host's. */
export interface CryptoPort {
	randomBytes(length: number): Uint8Array
	/** PBKDF2-SHA256(passphrase, salt, iterations) → an opaque key handle. */
	pbkdf2Sha256(passphrase: string, salt: Uint8Array, iterations: number): Promise<unknown>
	aesGcmEncrypt(key: unknown, iv: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array>
	aesGcmDecrypt(key: unknown, iv: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array>
	utf8Encode(text: string): Uint8Array
	utf8Decode(bytes: Uint8Array): string
}

/**
 * The NIP-07 lane's transport: the extension object itself. A browser extension
 * *is* a host object, so the spec types it as injected and this module never
 * reads `window` — a host that has no extension simply does not offer the lane.
 * `nip04`/`nip44` are partial because an extension may expose only some of it.
 */
/** #597459 — ExtensionTransportPort: the NIP-07 extension object as an argument, never a browser global. */
export interface ExtensionTransportPort {
	getPublicKey(): Promise<string>
	signEvent(template: EventTemplate | NostrEvent): Promise<SignedEvent>
	nip04?: Partial<NipEncryptionCapability> | undefined
	nip44?: Partial<NipEncryptionCapability> | undefined
}

/** Where a passphrase comes from: a value, or a source the module may ask once. */
/** #179fde — PassphraseSource: a value or a source the module may ask once for the persisted record. */
export type PassphraseSource = string | (() => string | Promise<string | undefined> | undefined)

/**
 * Every environmental dependency, in one bag. Everything here is optional.
 *
 * **A port error is observed.** Whatever a port rejects with reaches a session
 * snapshot's `reason` field, which every `observeSession` listener sees, and the
 * module wraps a failing port as a typed `PortError` carrying the host's own
 * message. A host adapter must therefore not interpolate secret material into
 * its own error text (a passphrase, a session token, an envelope's bytes): the
 * module never puts one there itself, and the port is the only other author of
 * that field.
 */
/** #5f6a1c — SignerPorts: the ports bag beside the settings — implementations, not decisions. */
export interface SignerPorts {
	storage?: StoragePort
	transport?: TransportPort
	clock?: ClockPort
	crypto?: CryptoPort
	/** The NIP-07 extension transport, when the host has one. */
	extension?: ExtensionTransportPort
	/** The passphrase source for the persisted record, when the host has one. */
	passphrase?: PassphraseSource
}

// ---------------------------------------------------------------------------
// The settings: "simple settings for how it signs", as contract (spec §1.3)
// ---------------------------------------------------------------------------

/** The KDF/AEAD floor and the passphrase protection for the persisted record (I5). */
/** #179fde — SessionAtRestSettings: how the persisted record is protected: passphrase, iterations written, floor accepted (I5). */
export interface SessionAtRestSettings {
	/** The passphrase, or a source for it. Absent ⇒ nothing is persisted at all. */
	passphrase?: PassphraseSource
	/** The PBKDF2 iteration count this module WRITES. */
	iterations?: number
	/** The floor this module ACCEPTS when unlocking. Never lowered silently. */
	minIterations?: number
}

/** #179fde — RpcTimeoutSettings: the per-RPC deadline and the longer connect / auth-challenge deadline. */
export interface RpcTimeoutSettings {
	/** Per-RPC deadline (sign / encrypt / decrypt). */
	rpcMs?: number
	/** The longer connect / auth-challenge deadline. */
	connectMs?: number
}

/** What a session is started with, per lane. */
/** #8a5718 — SessionStartInput: what a session is started with, per lane. */
export type SessionStartInput =
	| { lane: 'extension' }
	| { lane: 'nsec'; key: string }
	| { lane: 'ncryptsec'; ncryptsec: string; password: string }
	| {
			lane: 'bunker'
			bunkerUrl: string
			clientKeyHex?: string
			onAuthUrl?: (url: string) => Promise<void>
	  }
	| {
			lane: 'nostrconnect'
			relays: string[]
			/**
			 * The client private key (hex) this session runs as. Generated when
			 * omitted; supplied when a composer already holds one (it is the key a
			 * persisted session carries).
			 */
			clientKeyHex?: string
			/** The client-initiated connect secret. Generated from the key when omitted. */
			connectSecret?: string
			/** Receives the `nostrconnect://` URI (it carries the secret) and any auth challenge. */
			onAuthUrl?: (url: string) => Promise<void>
	  }

/** #8a5718 — RestoreInput: the passphrase that unlocks the persisted record; omitted parks the session in locked (I5). */
export interface RestoreInput {
	/** The passphrase that unlocks the persisted record; omitted ⇒ the session parks in `locked`. */
	passphrase?: string
}

/** Whether a lane can be offered here at all, read through the contract (spec §1.2.12). */
/** #8a5718 — LaneAvailability: what this host can actually offer, read through the contract. */
export interface LaneAvailability {
	extension: boolean
	nsec: boolean
	ncryptsec: boolean
	bunker: boolean
	nostrconnect: boolean
}

/** #179fde — SignerSettings: the composer's decisions, each one contract. */
export interface SignerSettings {
	/**
	 * A pin on the lane a session may be made from. When set, `startSession()`
	 * **refuses** any other lane with `LaneUnavailableError`; when absent, every
	 * lane the host offers is admitted and the lane is chosen by
	 * `startSession(input)`'s own discriminant. A setting nothing reads is a trap
	 * for the second implementer, so this one is enforced.
	 */
	signerKind?: LaneKind
	/**
	 * The schemes the composer is willing to use, as an allow-list over what the
	 * signer offers. Empty or absent ⇒ the corresponding operation refuses.
	 */
	capabilities?: EncryptionScheme[]
	/** Whether the signer's own encryption is used at all, and for what. */
	encryption?: { nip44?: boolean; nip04?: boolean }
	/**
	 * What a legacy plaintext record triggers: `re_login` (the default — no data
	 * migration, the plaintext is discarded) or `migrate` (wrap it, then delete it).
	 */
	restoreOnStart?: 'migrate' | 're_login'
	/** The persisted-record protection (I5). No storage or no passphrase ⇒ in-memory only. */
	sessionAtRest?: SessionAtRestSettings
	rpcTimeout?: RpcTimeoutSettings
	/** The NIP-46 permissions requested at connect. */
	permissions?: string[]
}

/** #5f6a1c — SignerDeps: the two bags, { settings, ports }, the carrier map's one sentence. */
export interface SignerDeps {
	settings?: SignerSettings
	ports?: SignerPorts
}
