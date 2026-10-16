/**
 * The module's error vocabulary.
 *
 * Every refusal this module makes is typed, because a caller has to be able to
 * tell *which* fail-closed rule fired: an absent capability is not a transport
 * that was never injected, and a wrong identity is not a wrong passphrase. The
 * `code` is stable; the message is for a human.
 */
/** #fa0578 — SignerError: the base of every typed refusal; a caller can tell which fail-closed rule fired. */
export class SignerError extends Error {
	readonly code: string
	constructor(code: string, message: string, options?: { cause?: unknown }) {
		super(message, options)
		this.name = 'SignerError'
		this.code = code
	}
}

/** A transition the session state machine does not allow, or a guard it refuses. */
/** #489ae8 — InvalidTransitionError: a transition the state machine does not allow. */
export class InvalidTransitionError extends SignerError {
	constructor(message: string) {
		super('invalid_transition', message)
		this.name = 'InvalidTransitionError'
	}
}

/** No identity could be resolved: a session never becomes `active` without one (I2). */
/** #489ae8 — IdentityUnresolvedError: a session never becomes active without a resolved identity (I2). */
export class IdentityUnresolvedError extends SignerError {
	constructor(message: string) {
		super('identity_unresolved', message)
		this.name = 'IdentityUnresolvedError'
	}
}

/** A signature came back that is not bound to the resolved identity (I3). */
/** #2902ce — IdentityMismatchError: a returned event not bound to the resolved identity fails closed (I3). */
export class IdentityMismatchError extends SignerError {
	constructor(message: string) {
		super('identity_mismatch', message)
		this.name = 'IdentityMismatchError'
	}
}

/** A read that needs an active session, made with none attached. */
/** #fa0578 — NoActiveSessionError: an operation that needs a session, made with none attached. */
export class NoActiveSessionError extends SignerError {
	constructor(message = 'No signer session is active') {
		super('no_active_session', message)
		this.name = 'NoActiveSessionError'
	}
}

/** The operation was asked for a scheme the signer (or the allow-list) does not provide (I4). */
/** #acd841 — CapabilityUnavailableError: a scheme the signer does not provide, or the allow-list refuses (I4). */
export class CapabilityUnavailableError extends SignerError {
	constructor(message: string) {
		super('capability_unavailable', message)
		this.name = 'CapabilityUnavailableError'
	}
}

/** A second capability tried to become active while one is already attached. */
/** #489ae8 — SessionAttachedError: no active state while another capability is attached. */
export class SessionAttachedError extends SignerError {
	constructor(message = 'A signer capability is already attached') {
		super('session_attached', message)
		this.name = 'SessionAttachedError'
	}
}

/** The host cannot offer the lane that was asked for. */
/** #fa0578 — LaneUnavailableError: a lane this host cannot offer (the pin, an absent port). */
export class LaneUnavailableError extends SignerError {
	constructor(message: string) {
		super('lane_unavailable', message)
		this.name = 'LaneUnavailableError'
	}
}

/** A NIP-46 lane was opened without the injected relay transport it requires. */
/** #fa0578 — TransportRequiredError: a NIP-46 lane opened without the injected relay transport. */
export class TransportRequiredError extends SignerError {
	constructor(message = 'NIP-46 requires an injected transport: pass it in the settings') {
		super('transport_required', message)
		this.name = 'TransportRequiredError'
	}
}

/**
 * The remote signer asked for approval at an `auth_url` and the host supplied no
 * sink for it. The module never opens a window of its own, so it refuses and
 * hands the caller the URL to re-enter with.
 */
/** #07df21 (provenance) — AuthSinkRequiredError: the module never opens a window; an auth_url with no sink refuses. */
export class AuthSinkRequiredError extends SignerError {
	constructor(message: string) {
		super('auth_sink_required', message)
		this.name = 'AuthSinkRequiredError'
	}
}

/** A deadline was needed and no clock was injected. */
/** #fa0578 — ClockRequiredError: a deadline was needed and no clock was injected. */
export class ClockRequiredError extends SignerError {
	constructor(message = 'NIP-46 requires an injected clock: pass it in the settings') {
		super('clock_required', message)
		this.name = 'ClockRequiredError'
	}
}

/**
 * The vault rules a caller has to be able to tell apart, one `code` each.
 *
 * A single type is fine — every one of these is "the persisted record could not
 * be used" — but a single `code` is not: "the passphrase was wrong, let them
 * retry" and "the plaintext session was discarded, send them to login" are
 * different screens, and a caller that has to match on message text is a caller
 * that breaks when the message is reworded.
 */
/** #5f6a1c — SessionVaultCode: the closed list of persisted-record rules a code names, so callers match a value not a message. */
export type SessionVaultCode =
	/** Nothing is stored under the vault key. */
	| 'no_record'
	/** The stored value is not JSON, or not valid base64 inside. */
	| 'envelope_corrupt'
	/** The value parsed but is not a supported envelope (`v`, `kdf`, salt, iv, ct). */
	| 'envelope_unsupported'
	/** The iteration count is below the accepted floor — an attacker-writable field, so rejected before any derivation. */
	| 'iteration_floor'
	/** The passphrase was wrong, or the ciphertext was tampered with (the GCM auth tag). */
	| 'wrong_passphrase'
	/** A legacy plaintext record was found and discarded: an intentional re-login is required. */
	| 'legacy_discarded'
	/** A legacy plaintext record could not be migrated (absent, or its bunker URL does not parse). */
	| 'legacy_invalid'

/**
 * Every fail-closed vault path. The **cause** is never leaked (I5), but the
 * *rule* is: `code` names which fail-closed check fired, and
 * {@link SessionVaultCode} is the closed list of them.
 */
/** #2902ce — SessionVaultError: every fail-closed persisted-record path, the rule named by its code (I5). */
export class SessionVaultError extends SignerError {
	constructor(message: string, options?: { cause?: unknown; code?: SessionVaultCode }) {
		super(options?.code ?? 'session_vault', message, options)
		this.name = 'SessionVaultError'
	}
}

/**
 * A **port** failed: the host store threw, the passphrase source rejected, the
 * injected relay transport refused to open a subscription, the clock threw.
 *
 * The specification's refusal rule covers ports as much as lanes, but a port is
 * the one thing this module does not own, so its failure used to reach the
 * caller as the host's own raw `Error` — uncatchable by type, and unusable as a
 * snapshot reason. It is typed here instead. The host's error text is kept as
 * the **cause and in the message**, because a port error is the host's own
 * diagnosis and there is no credential in a store that failed to open; what is
 * never observed is a secret.
 */
/** #fa0578 — PortError: the one thing the module does not own failed; the host's own message is kept as the cause. */
export class PortError extends SignerError {
	constructor(port: string, operation: string, options?: { cause?: unknown }) {
		const detail = options?.cause instanceof Error ? options.cause.message : undefined
		super('port_failed', `The host ${port} port failed during ${operation}${detail ? `: ${detail}` : ''}`, options)
		this.name = 'PortError'
	}
}

/** A locked NIP-49 signer rejects fast instead of hanging on a never-resolved unlock promise. */
/** #50e8e5 — PasswordSignerLockedError: a locked NIP-49 signer rejects fast instead of hanging (the name is local). */
export class PasswordSignerLockedError extends SignerError {
	constructor(message = 'PasswordSigner is locked — unlock it through the password prompt before signing') {
		super('password_signer_locked', message)
		this.name = 'PasswordSignerLockedError'
	}
}

/** A NIP-46 RPC exceeded its deadline: reconnect the signer and try again. */
/** #179fde — Nip46RpcTimeoutError: a NIP-46 RPC exceeded the injected per-RPC deadline. */
export class Nip46RpcTimeoutError extends SignerError {
	constructor(lane: string, timeoutMs: number) {
		super('nip46_rpc_timeout', `NIP-46 ${lane} request timed out after ${timeoutMs}ms — reconnect your signer and try again`)
		this.name = 'Nip46RpcTimeoutError'
	}
}
