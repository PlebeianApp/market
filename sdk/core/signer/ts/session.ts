/**
 * The session: the thirteen contract operations of the spec, over a state
 * machine.
 *
 * This file is the module's own composition work — the market has no equivalent
 * file, because the market's session lives inside `src/lib/stores/auth.ts` (391
 * lines, five stored keys, a component-framework store, and three product questions
 * that are not this module's). What it composes is harvested: the capability
 * seam and identity binding from `signer-capability.ts` and
 * `nostr-connect-signer.ts`, the four lane builders from `signer-registry.ts`
 * and `password-signer-session.ts`, the NIP-46 lanes from
 * `nostr-connect-signer.ts` / `nostr-connect-session.ts`, and the vault from
 * `session-vault.ts`.
 *
 * The state machine is the spec's (§1.4), and it is enforced rather than
 * described: a transition that is not allowed is refused with a typed error,
 * and two of them are refused by guard — a session never becomes `active`
 * without a resolved identity (I2), and never while another session is
 * attached.
 */
import { bindIdentity, exposedCapabilities, gateCapability, isSignerCapability } from './capability'
import {
	CapabilityUnavailableError,
	IdentityUnresolvedError,
	InvalidTransitionError,
	LaneUnavailableError,
	NoActiveSessionError,
	PortError,
	SessionAttachedError,
	SessionVaultError,
	SignerError,
} from './errors'
import { createExtensionLane, createPasswordSignerLane, createPrivateKeyLane } from './lanes'
import {
	awaitNostrConnectSigner,
	connectBunkerSigner,
	createNostrConnectClient,
	nostrConnectUri,
	rehydrateNostrConnectSession,
	requireClock,
	requireTransport,
} from './nip46'
import type {
	ClockPort,
	EncryptionScheme,
	EventTemplate,
	LaneAvailability,
	LaneKind,
	RestoreInput,
	SessionObserver,
	SessionRecordKind,
	SessionSnapshot,
	SessionStartInput,
	SessionState,
	SignerCapabilities,
	SignerCapability,
	SignerDeps,
	SignerPorts,
	SignerSettings,
	SignedEvent,
	TransportPort,
} from './types'
import * as vault from './vault'
import type { VaultDeps } from './vault'

/**
 * The thirteen contract operations the spec declares (§1.2). `createSignerFromKey`
 * is the module's other entry — it is session-less by the spec's own words
 * ("construct a signer from raw key material with no session, no UI, no
 * storage") and is therefore a module function rather than an operation here.
 */
/** #8a5718 — SignerSession: the thirteen contract operations the spec declares, as one session object. */
export interface SignerSession {
	/** 1 · the authenticated identity's hex pubkey — the only identity read (I2). */
	getPublicKey(): Promise<string>
	/** 2 · sign a prepared event, bound to the resolved identity, else fail closed (I3). */
	signEvent(template: EventTemplate): Promise<SignedEvent>
	/** 3 · the encryption the signer actually provides, after the composer's allow-list. */
	capabilities(): SignerCapabilities
	/** 4 · establish a session on one lane. */
	startSession(input: SessionStartInput): Promise<SessionSnapshot>
	/** 5 · detach the capability, run its teardown, clear the derived state and the persisted record. */
	endSession(): Promise<void>
	/** 6 · rebuild a session from the persisted record, gated on I5. */
	restoreSession(input?: RestoreInput): Promise<SessionSnapshot>
	/** 7 · observe session snapshots. Returns the unsubscribe function. */
	observeSession(listener: SessionObserver): () => void
	/** #e4949e — attachSigner: 8a, attach an already-built signer without a login (the amended surface). */
	attachSigner(capability: SignerCapability, options?: { lane?: LaneKind }): Promise<SessionSnapshot>
	/** 8b · detach it, run its teardown, emit the detach signal. */
	detachSigner(): Promise<void>
	/** 10a · encrypt to a peer, only when the scheme is actually present. */
	encrypt(peerPubkey: string, plaintext: string, scheme: EncryptionScheme): Promise<string>
	/** 10b · decrypt from a peer, only when the scheme is actually present. */
	decrypt(peerPubkey: string, ciphertext: string, scheme: EncryptionScheme): Promise<string>
	/** 11 · the attached signer, or a typed refusal when no session is active. */
	currentSigner(): SignerCapability
	/** 12 · what this host can actually offer, so a surface decides through the contract. */
	availableLanes(): LaneAvailability
}

/**
 * The transitions this machine performs, and the only ones the spec allows
 * (`#489ae8`). Anything not listed is refused with `InvalidTransitionError`:
 * a session is a state machine, and a state it cannot be reasoned about is a
 * state that will be entered by accident.
 *
 * This table is **one list with the spec**: the statement `#489ae8` and the
 * mermaid diagram in §7 carry these same edges, and `evidence/run.sh` extracts
 * all three mechanically and diffs them, so none of the three can drift from the
 * others. An edge that only the code has is as much a defect as an edge that
 * only the document has — which is what this table used to be (it admitted
 * `locked → idle`, which the spec's list did not, and omitted `idle → restoring`,
 * which the code needs).
 */
const ALLOWED: Record<SessionState, SessionState[]> = {
	// `idle → locked` and `idle → active` are the two the spec states as guards
	// rather than as plain edges: a session restored from a persisted record is
	// discovered locked, and an attach that resolved its identity is active.
	idle: ['connecting', 'restoring', 'locked', 'active', 'closing'],
	connecting: ['awaiting_user', 'active', 'failed', 'closing'],
	awaiting_user: ['active', 'failed', 'closing'],
	active: ['closing', 'failed'],
	locked: ['restoring', 'failed', 'closing'],
	restoring: ['active', 'failed', 'closing'],
	closing: ['idle'],
	failed: ['idle', 'closing'],
}

class Session implements SignerSession {
	private readonly settings: SignerSettings
	private readonly ports: SignerPorts

	private state: SessionState = 'idle'
	private pubkey: string | undefined
	private lane: LaneKind | undefined
	private record: SessionRecordKind = 'none'
	private reason: string | undefined
	private capability: SignerCapability | undefined
	private exposed: SignerCapabilities = {}
	private teardown: (() => void | Promise<void>) | undefined
	/**
	 * The identity of the attempt in flight. Every operation that can be in
	 * flight while someone ends the session (a lane, a restore, an attach) takes a
	 * number, and the attach refuses if the number is no longer the current one:
	 * an ended session cannot be re-activated by a lane that was already running
	 * when it was ended.
	 */
	private attempt = 0
	/** Which attempt armed the current teardown (see {@link runTeardown}). */
	private teardownAttempt = 0
	private readonly observers = new Set<SessionObserver>()

	constructor(deps: SignerDeps) {
		this.settings = deps.settings ?? {}
		this.ports = deps.ports ?? {}
	}

	// -- observation ---------------------------------------------------------

	observeSession(listener: SessionObserver): () => void {
		this.observers.add(listener)
		listener(this.snapshot())
		return () => {
			this.observers.delete(listener)
		}
	}

	private emit(): void {
		const snapshot = this.snapshot()
		for (const observer of this.observers) observer(snapshot)
	}

	/** The current snapshot. Read-only, and the only shape an observer sees. */
	private snapshot(): SessionSnapshot {
		return {
			state: this.state,
			...(this.pubkey ? { pubkey: this.pubkey } : {}),
			...(this.lane ? { lane: this.lane } : {}),
			capabilities: {
				nip04: this.exposed.nip04 !== undefined,
				nip44: this.exposed.nip44 !== undefined,
			},
			record: this.record,
			...(this.reason ? { reason: this.reason } : {}),
		}
	}

	// -- the state machine ---------------------------------------------------

	private transition(next: SessionState, reason?: string): void {
		if (next === this.state) return
		if (!ALLOWED[this.state].includes(next)) {
			throw new InvalidTransitionError(`Refused: ${this.state} → ${next}${reason ? ` (${reason})` : ''}`)
		}
		this.state = next
		this.reason = next === 'failed' ? reason : undefined
		if (next === 'idle') {
			this.pubkey = undefined
			this.lane = undefined
		}
		this.emit()
	}

	/**
	 * A failed lane leaves no capability behind **and nothing it opened stays
	 * open**: the failure path runs the lane's teardown, exactly as `endSession()`
	 * does, so a subscription, a signer object or a lock the attempt acquired is
	 * released by the attempt that acquired it. The teardown used to be dropped
	 * here without being called, which is a leak only the host could see.
	 *
	 * The teardown is released whatever the state: a lane that `endSession()`
	 * abandoned cannot land in `failed` (the session is already idle), and it must
	 * still close what it opened — without touching a newer attempt's teardown.
	 */
	private async fail(error: unknown, attempt?: number): Promise<void> {
		const reason = error instanceof Error ? error.message : String(error)
		if (ALLOWED[this.state].includes('failed')) {
			this.capability = undefined
			this.exposed = {}
			this.pubkey = undefined
			this.transition('failed', reason)
		}
		await this.runTeardown(attempt)
	}

	private toIdle(): void {
		if (this.state === 'failed') this.transition('idle')
	}

	// -- the ports, resolved -------------------------------------------------

	private vaultDeps(): VaultDeps | undefined {
		const storage = this.ports.storage
		const crypto = this.ports.crypto
		if (!storage || !crypto) return undefined
		return { storage, crypto }
	}

	/**
	 * Run one call into a host port and make a failure of it **typed**: a host
	 * store that throws is a `PortError` at the caller, not the host's own raw
	 * `Error` arriving uncatchable by type and unusable as a snapshot reason. A
	 * refusal that is already a `SignerError` — the vault's own rules — passes
	 * through untouched, with its own code.
	 */
	private async guard<T>(port: string, operation: string, run: () => T | Promise<T>): Promise<T> {
		try {
			return await run()
		} catch (error) {
			if (error instanceof SignerError) throw error
			throw new PortError(port, operation, { cause: error })
		}
	}

	private async passphrase(): Promise<string | undefined> {
		const source = this.settings.sessionAtRest?.passphrase ?? this.ports.passphrase
		if (source === undefined) return undefined
		const value = typeof source === 'function' ? await this.guard('passphrase', 'the passphrase source', () => source()) : source
		return value && value.length > 0 ? value : undefined
	}

	/**
	 * The transport the lanes see, with each call into it guarded, so a relay
	 * layer that throws stays a typed refusal inside the lane it broke rather than
	 * escaping as a host error.
	 */
	private transport(): TransportPort | undefined {
		const transport = this.ports.transport
		if (!transport) return undefined
		return {
			subscription: (relays, filters) => {
				try {
					return transport.subscription(relays, filters)
				} catch (cause) {
					throw new PortError('transport', 'subscription', { cause })
				}
			},
			publish: async (relays, event) => {
				try {
					return await transport.publish(relays, event)
				} catch (cause) {
					throw new PortError('transport', 'publish', { cause })
				}
			},
		}
	}

	/** The clock the lanes see, guarded for the same reason the transport is. */
	private clock(): ClockPort | undefined {
		const clock = this.ports.clock
		if (!clock) return undefined
		return {
			setTimeout: (handler, ms) => {
				try {
					return clock.setTimeout(handler, ms)
				} catch (cause) {
					throw new PortError('clock', 'setTimeout', { cause })
				}
			},
			clearTimeout: (handle) => {
				try {
					clock.clearTimeout(handle)
				} catch (cause) {
					throw new PortError('clock', 'clearTimeout', { cause })
				}
			},
		}
	}

	// -- attach / activate ---------------------------------------------------

	/** The one place a capability becomes the session's: bound, identity resolved first (I2). */
	private async activate(capability: SignerCapability, lane: LaneKind | undefined, attempt?: number): Promise<SessionSnapshot> {
		if (attempt !== undefined && attempt !== this.attempt) {
			throw new InvalidTransitionError(`Refused: the ${lane ?? 'attached'} attempt was abandoned before it could activate the session`)
		}
		if (this.capability) throw new SessionAttachedError()
		if (!isSignerCapability(capability)) {
			throw new LaneUnavailableError('The lane did not produce a usable signer capability')
		}
		const bound = bindIdentity(capability)
		let pubkey: string
		try {
			pubkey = await bound.getPublicKey()
		} catch (cause) {
			throw new IdentityUnresolvedError(
				`The ${lane ?? 'attached'} lane did not resolve an identity: ${cause instanceof Error ? cause.message : String(cause)}`,
			)
		}
		if (!ALLOWED[this.state].includes('active')) {
			throw new InvalidTransitionError(`Refused: ${this.state} → active (a lane may only activate a session)`)
		}
		// I4 is applied where the capability is **handed out**, not only where it is
		// reported: `currentSigner()` carries the schemes the composer allowed and
		// nothing else, so the object a consumer reaches for cannot offer what
		// `capabilities()`, `encrypt()` and `decrypt()` refuse.
		this.exposed = exposedCapabilities(bound, this.settings.capabilities, this.settings.encryption)
		this.capability = gateCapability(bound, this.exposed)
		this.pubkey = pubkey
		this.lane = lane
		this.transition('active')
		return this.snapshot()
	}

	/** #e4949e — attachSigner: the amended surface — `attachSigner(capability, { lane })`; the settings are the composer's, set once at createSignerSession. */
	attachSigner(capability: SignerCapability, options?: { lane?: LaneKind }): Promise<SessionSnapshot> {
		this.toIdle()
		const attempt = ++this.attempt
		return this.activate(capability, options?.lane, attempt)
	}

	/**
	 * Detaching is about the **attached capability**, so with nothing attached
	 * (idle, locked, failed, or a lane still connecting) it is a no-op that emits
	 * nothing — there is no capability to tear down and no detach signal to send.
	 * Ending a session that has no capability is `endSession()`, which is the
	 * operation that also clears the persisted record; that decision is why
	 * `locked → idle` is no longer a transition this machine performs.
	 */
	async detachSigner(): Promise<void> {
		if (!this.capability) return
		if (this.state === 'active') this.transition('closing', 'detach')
		await this.runTeardown()
		this.capability = undefined
		this.exposed = {}
		this.pubkey = undefined
		if (this.state !== 'idle') this.transition('idle')
	}

	/**
	 * Disarm and run the teardown: best-effort and idempotent, so a failing
	 * unsubscribe cannot leave a session that cannot be closed. With `onlyAttempt`
	 * it runs **only** the teardown that attempt armed — a lane abandoned by
	 * `endSession()` releases what it opened, without tearing down whatever a newer
	 * attempt armed in the meantime.
	 */
	private async runTeardown(onlyAttempt?: number): Promise<void> {
		if (onlyAttempt !== undefined && this.teardownAttempt !== onlyAttempt) return
		const teardown = this.teardown
		this.teardown = undefined
		this.teardownAttempt = 0
		if (!teardown) return
		try {
			await teardown()
		} catch {
			// Teardown is best-effort and idempotent: a failing unsubscribe must
			// not leave a session that cannot be closed.
		}
	}

	/** Arm the teardown together with the attempt that owns it. */
	private armTeardown(attempt: number, teardown: () => void | Promise<void>): void {
		this.teardown = teardown
		this.teardownAttempt = attempt
	}

	// -- the lanes -----------------------------------------------------------

	async startSession(input: SessionStartInput): Promise<SessionSnapshot> {
		if (this.capability) throw new SessionAttachedError()
		// A declared lane pin is a rule, not a hint: a composer that pinned
		// `signerKind` refuses a session on any other lane instead of ignoring its
		// own setting.
		if (this.settings.signerKind && this.settings.signerKind !== input.lane) {
			throw new LaneUnavailableError(
				`This composer pins sessions to the ${this.settings.signerKind} lane; a ${input.lane} session is refused`,
			)
		}
		this.toIdle()
		const attempt = ++this.attempt
		this.transition('connecting', `${input.lane} lane`)
		try {
			switch (input.lane) {
				case 'extension': {
					const extension = this.ports.extension
					if (!extension) {
						throw new LaneUnavailableError('This host offers no NIP-07 extension transport')
					}
					return await this.activate(createExtensionLane(extension), 'extension', attempt)
				}
				case 'nsec':
					return await this.activate(createPrivateKeyLane(input.key), 'nsec', attempt)
				case 'ncryptsec': {
					const lane = await createPasswordSignerLane(input.ncryptsec, input.password)
					this.armTeardown(attempt, () => lane.lock())
					return await this.activate(lane.capability, 'ncryptsec', attempt)
				}
				case 'bunker': {
					const bundle = await connectBunkerSigner(input.bunkerUrl, {
						clientKeyHex: input.clientKeyHex,
						onAuthUrl: input.onAuthUrl,
						transport: this.transport(),
						clock: this.clock(),
						rpcTimeoutMs: this.settings.rpcTimeout?.rpcMs,
						connectTimeoutMs: this.settings.rpcTimeout?.connectMs,
						permissions: this.settings.permissions,
					})
					this.armTeardown(attempt, () => bundle.signer.logout())
					// The reference's order, restored: the identity is resolved first and
					// only a session that reached `active` is persisted. Writing the
					// record before the identity was resolved left a vaulted bearer
					// session behind for a login that never happened.
					await this.activate(bundle.capability, 'bunker', attempt)
					await this.persist(bundle.nbunksec)
					return this.snapshot()
				}
				case 'nostrconnect': {
					if (!input.onAuthUrl) {
						throw new LaneUnavailableError('The nostrconnect lane needs a sink for the connect URI (it carries the secret)')
					}
					// Both ports are required before anything is built — in particular
					// before the URI reaches the caller's sink. The URI carries the
					// connect secret, and it used to be handed over for a session that
					// could never bind, because the clock was checked further down.
					const transport = requireTransport(this.transport())
					const clock = requireClock(this.clock())
					const client = createNostrConnectClient({
						relays: input.relays,
						clientKeyHex: input.clientKeyHex,
						connectSecret: input.connectSecret,
						onAuthUrl: input.onAuthUrl,
						transport,
						clock,
					})
					this.armTeardown(attempt, () => client.close())
					this.transition('awaiting_user', 'waiting for the remote signer to approve')
					await input.onAuthUrl(nostrConnectUri(client))
					const bundle = await awaitNostrConnectSigner(client, {
						clock,
						rpcTimeoutMs: this.settings.rpcTimeout?.rpcMs,
						connectTimeoutMs: this.settings.rpcTimeout?.connectMs,
					})
					client.onAuth = input.onAuthUrl
					await this.activate(bundle.capability, 'nostrconnect', attempt)
					await this.persist(bundle.nbunksec)
					return this.snapshot()
				}
			}
		} catch (error) {
			await this.fail(error, attempt)
			throw error
		}
	}

	/**
	 * End the session: run the capability's teardown, clear the derived state
	 * **and the persisted record** — from any state. It used to return from
	 * `failed` before the teardown ran and to be refused outright from `locked`,
	 * so a record a failed attempt had written could not be cleared by any
	 * operation in the contract. Ending is the operation that clears, so it works
	 * wherever the session got stuck.
	 */
	async endSession(): Promise<void> {
		// Abandon whatever is in flight: a lane (or a restore) still running when
		// the session ends must not activate it afterwards.
		this.attempt++
		if (ALLOWED[this.state].includes('closing')) this.transition('closing', 'session end')
		try {
			await this.runTeardown()
			const deps = this.vaultDeps()
			if (deps) {
				await this.guard('storage', 'clearVaultedSession', () => vault.clearVaultedSession(deps))
				await this.guard('storage', 'discardLegacySession', () => vault.discardLegacySession(deps))
			}
			this.record = 'none'
		} finally {
			this.capability = undefined
			this.exposed = {}
			this.pubkey = undefined
			if (this.state !== 'idle') this.transition('idle')
		}
	}

	async restoreSession(input: RestoreInput = {}): Promise<SessionSnapshot> {
		if (this.capability) throw new SessionAttachedError()
		const deps = this.vaultDeps()
		if (!deps) {
			throw new LaneUnavailableError('restoreSession needs an injected storage port and crypto port')
		}
		this.toIdle()
		// Every call into the host's storage is guarded, so a store that throws
		// rejects with a typed `PortError` rather than the host's own raw error —
		// including the existence checks, which used to sit outside any try.
		if (await this.guard('storage', 'hasVaultedSession', () => vault.hasVaultedSession(deps))) {
			this.record = 'vaulted'
			if (!input.passphrase) {
				// I5: a vaulted record parks, locked, until the passphrase arrives.
				this.transition('locked', 'a passphrase is needed to unlock the persisted session')
				return this.snapshot()
			}
			const attempt = ++this.attempt
			const passphrase = input.passphrase
			try {
				this.transition('restoring', 'unlocking the persisted session')
				const nbunksec = await this.guard('storage', 'unlockVault', () =>
					vault.unlockVault(undefined, passphrase, this.unlockOptions(), deps),
				)
				const bundle = await rehydrateNostrConnectSession(nbunksec, {
					transport: this.transport(),
					clock: this.clock(),
					rpcTimeoutMs: this.settings.rpcTimeout?.rpcMs,
					permissions: this.settings.permissions,
				})
				this.armTeardown(attempt, () => bundle.signer.logout())
				return await this.activate(bundle.capability, 'bunker', attempt)
			} catch (error) {
				await this.fail(error, attempt)
				throw error
			}
		}
		if (await this.guard('storage', 'hasLegacyPlaintextSession', () => vault.hasLegacyPlaintextSession(deps))) {
			this.record = 'legacy_plaintext'
			const passphrase = input.passphrase
			if (this.settings.restoreOnStart === 'migrate' && passphrase) {
				const attempt = ++this.attempt
				try {
					this.transition('restoring', 'migrating a legacy plaintext record')
					const { nbunksec } = await this.guard('storage', 'migrateLegacySessionToVault', () =>
						vault.migrateLegacySessionToVault(passphrase, this.wrapOptions(), deps),
					)
					this.record = 'vaulted'
					const bundle = await rehydrateNostrConnectSession(nbunksec, {
						transport: this.transport(),
						clock: this.clock(),
						rpcTimeoutMs: this.settings.rpcTimeout?.rpcMs,
						permissions: this.settings.permissions,
					})
					this.armTeardown(attempt, () => bundle.signer.logout())
					return await this.activate(bundle.capability, 'bunker', attempt)
				} catch (error) {
					this.record = 'none'
					await this.fail(error, attempt)
					throw error
				}
			}
			// The default (`re_login`): the plaintext is discarded, never kept.
			await this.guard('storage', 'discardLegacySession', () => vault.discardLegacySession(deps))
			this.record = 'none'
			throw new SessionVaultError(
				'A legacy plaintext session was found and discarded — an intentional re-login is required (set restoreOnStart: "migrate" to migrate it instead)',
				{ code: 'legacy_discarded' },
			)
		}
		throw new SessionVaultError('No persisted session to restore', { code: 'no_record' })
	}

	private wrapOptions(): vault.WrapOptions {
		return { iterations: this.settings.sessionAtRest?.iterations }
	}

	private unlockOptions(): vault.UnlockOptions {
		return { minIterations: this.settings.sessionAtRest?.minIterations }
	}

	/**
	 * Persist the session token (the nbunksec) when — and only when — the host
	 * gave this module a storage port, a crypto port, and a passphrase source.
	 * Anything less persists nothing (I5): there is no plaintext fallback here.
	 */
	private async persist(nbunksec: string): Promise<void> {
		const deps = this.vaultDeps()
		if (!deps) return
		const passphrase = await this.passphrase()
		if (!passphrase) return
		await this.guard('storage', 'saveVaultedSession', () => vault.saveVaultedSession(nbunksec, passphrase, this.wrapOptions(), deps))
		this.record = 'vaulted'
		// Persisting happens after the session is active, so the record kind is
		// announced: an observer that saw `active` must be able to see that the
		// record followed, and a host UI decides on that field.
		this.emit()
	}

	// -- the reads and the signature ----------------------------------------

	availableLanes(): LaneAvailability {
		const nip46 = this.transport() !== undefined && this.clock() !== undefined
		return {
			extension: this.ports.extension !== undefined,
			nsec: true,
			ncryptsec: true,
			bunker: nip46,
			nostrconnect: nip46,
		}
	}

	currentSigner(): SignerCapability {
		if (!this.capability || this.state !== 'active') {
			throw new NoActiveSessionError(`No signer is attached (session is ${this.state})`)
		}
		return this.capability
	}

	capabilities(): SignerCapabilities {
		return { ...this.exposed }
	}

	async getPublicKey(): Promise<string> {
		return this.currentSigner().getPublicKey()
	}

	async signEvent(template: EventTemplate): Promise<SignedEvent> {
		return this.currentSigner().signEvent(template)
	}

	private scheme(scheme: EncryptionScheme, capability: SignerCapabilities) {
		const found = capability[scheme]
		if (!found) {
			throw new CapabilityUnavailableError(
				`This session cannot ${scheme}: the signer does not provide it, or the composer did not allow it — refusing rather than synthesising it locally`,
			)
		}
		return found
	}

	async encrypt(peerPubkey: string, plaintext: string, scheme: EncryptionScheme): Promise<string> {
		return this.scheme(scheme, this.capabilities()).encrypt(peerPubkey, plaintext)
	}

	async decrypt(peerPubkey: string, ciphertext: string, scheme: EncryptionScheme): Promise<string> {
		return this.scheme(scheme, this.capabilities()).decrypt(peerPubkey, ciphertext)
	}
}

/** The module's session entry: the thirteen operations, over injected ports. */
/** #8a5718 — createSignerSession: the module's contract entry; deps are { settings, ports }. */
export function createSignerSession(deps: SignerDeps = {}): SignerSession {
	return new Session(deps)
}

/**
 * Construct a signer from raw key material — no session, no storage, no UI —
 * for a composer that is not a user session at all (a CLI, a seeder, an auction
 * validator). Identity-bound like every other lane, because I3 is the
 * operation's obligation, not the session's convenience.
 */
/** #8a5718 — createSignerFromKey: the session-less entry (no session, no storage, no UI), identity-bound like every lane. */
export function createSignerFromKey(material: string): SignerCapability {
	return bindIdentity(createPrivateKeyLane(material))
}
