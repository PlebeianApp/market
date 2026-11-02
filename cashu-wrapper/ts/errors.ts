import type { WalletStep } from './types'

/**
 * The `code` a refusal carries across the host boundary.
 *
 * The host reads a refusal's identity off `error.code` when it matches `FAILURE_CODE`
 * (`/^[a-z][a-z0-9_]{0,63}$/`, `host.ts:29`) and otherwise records the generic `adapter_failure`
 * (`host.ts:372-383`). A refusal carrying only a message therefore loses its *name* the moment it crosses that
 * boundary: the durable record says `adapter_failure` and the caller sees "failed during request", not
 * `refused-bid-refund-locktime`. So every refusal derives its `code` from its own `refused-<subject>:` message
 * prefix — which is exactly the shape the host accepts — and the name survives as a code.
 */
export function refusalCode(message: string): string {
	const subject = message.split(':', 1)[0] ?? ''
	const code = subject.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
	return /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : 'refused'
}

/**
 * A refusal that can cross the host boundary as a NAME. Every refusal class in the money path extends this, so
 * `refused-<subject>` reaches the host's durable `failureCode` instead of collapsing to `adapter_failure`.
 */
export class RefusedError extends Error {
	readonly code: string

	constructor(message: string) {
		super(message)
		this.name = new.target.name
		this.code = refusalCode(message)
	}
}

export class WalletHostError extends Error {
	readonly code: string

	constructor(name: string, code: string, message: string) {
		super(message)
		this.name = name
		this.code = code
	}
}

export class WalletConfigurationError extends WalletHostError {
	constructor(message: string) {
		super('WalletConfigurationError', 'wallet_configuration', message)
	}
}

export class WalletAdapterNotFoundError extends WalletHostError {
	constructor(applicationId: string, operationKind: string) {
		super(
			'WalletAdapterNotFoundError',
			'wallet_adapter_not_found',
			`No wallet adapter is registered for ${applicationId}/${operationKind}`,
		)
	}
}

export class WalletCommandConflictError extends WalletHostError {
	constructor(commandId: string) {
		super(
			'WalletCommandConflictError',
			'wallet_command_conflict',
			`Wallet command ${commandId} already exists with a different immutable intent`,
		)
	}
}

export class WalletInvalidTransitionError extends WalletHostError {
	constructor(commandId: string, message: string) {
		super('WalletInvalidTransitionError', 'wallet_invalid_transition', `Wallet command ${commandId}: ${message}`)
	}
}

export class WalletStaleWriterError extends WalletHostError {
	constructor(commandId: string) {
		super(
			'WalletStaleWriterError',
			'wallet_stale_writer',
			`Wallet command ${commandId} changed before this writer could commit`,
		)
	}
}

export class WalletRecoveryRequiredError extends WalletHostError {
	constructor(commandId: string) {
		super(
			'WalletRecoveryRequiredError',
			'wallet_recovery_required',
			`Wallet command ${commandId} requires reconciliation before it can continue`,
		)
	}
}

export class WalletStepExecutionError extends WalletHostError {
	readonly commandId: string
	readonly action: WalletStep | 'cancel' | 'recover'

	constructor(commandId: string, action: WalletStep | 'cancel' | 'recover', failureCode: string) {
		super(
			'WalletStepExecutionError',
			failureCode,
			`Wallet command ${commandId} failed during ${action}; inspect its durable state before retrying`,
		)
		this.commandId = commandId
		this.action = action
	}
}
