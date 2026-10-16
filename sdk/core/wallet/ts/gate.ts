/**
 * wallet/ts/gate.ts — the acceptance gate: what a wrapper presents at registration, checked for what
 * is mechanically checkable and refused fail-closed otherwise.
 *
 * `#6fd585` the gate accepts only a well-formed, self-consistent registration and refuses it fail-closed from
 * closed enums that interpolate no value. It enforces a declaration's shape, never its conduct: it cannot
 * make a declared plan the plan that runs, a declared witness producible or a store durable.
 */
import { FundsRegistrationError } from './errors'
import type { WrapperRegistration } from '../../funds-contract/ts/index'

/** The port's operations, in the port's canonical order: the projection every plan must equal. */
const CANONICAL = ['obtain', 'submit', 'reconcile'] as const

/** The contract's witness kinds, split by whether they are cryptographic or declared. */
const WITNESS_KINDS = ['preimage', 'zap_receipt', 'mint_quote_state', 'lnurl_verify', 'seller_attestation', 'ack'] as const

const AUTHORITY_KINDS = ['local', 'remote-and-observable'] as const

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

/** An identity used as a registry key: non-empty, trimmed, at most 512, no control character. */
function requireIdentity(value: unknown, field: 'wrapperId' | 'method' | 'contractVersion'): string {
	if (typeof value !== 'string' || value.length === 0) throw new FundsRegistrationError(field, 'empty')
	if (value.length > 512) throw new FundsRegistrationError(field, 'too-long')
	if (value !== value.trim()) throw new FundsRegistrationError(field, 'untrimmed')
	if (CONTROL_CHARACTER.test(value)) throw new FundsRegistrationError(field, 'control-character')
	return value
}

function requireNonEmptyString(value: unknown, field: 'store' | 'storeKind'): string {
	if (typeof value !== 'string' || value.length === 0) throw new FundsRegistrationError(field, 'empty')
	return value
}

function requirePositiveInteger(value: unknown, field: 'ceiling' | 'reconcileDeadlineMs'): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
		throw new FundsRegistrationError(field, 'not-positive-integer')
	}
	return value
}

/**
 * `#6fd585` FundsRegistrationGate — the runtime check and the registry: it validates a registration against the
 * shape the contract owns, refuses the malformed and the self-contradictory by naming only the closed field
 * and reason pair, and keeps one registration per method.
 */
export class FundsRegistrationGate {
	private readonly byMethod = new Map<string, WrapperRegistration>()

	constructor(private readonly contractVersion: string) {}

	/** The registration of an accepted wrapper, by method. */
	resolve(method: string): WrapperRegistration | undefined {
		return this.byMethod.get(method)
	}

	/** Every accepted registration. */
	list(): readonly WrapperRegistration[] {
		return [...this.byMethod.values()]
	}

	/** Validate a registration and accept it, or refuse it fail-closed. */
	register(registration: WrapperRegistration): WrapperRegistration {
		if (!isPlainObject(registration)) throw new FundsRegistrationError('wrapperId', 'missing')

		requireIdentity(registration.wrapperId, 'wrapperId')
		const method = requireIdentity(registration.method, 'method')

		const authorityKind = registration.authorityKind
		if (typeof authorityKind !== 'string' || !(AUTHORITY_KINDS as readonly string[]).includes(authorityKind)) {
			throw new FundsRegistrationError('authorityKind', 'not-in-union')
		}

		const operations = registration.operations
		if (!Array.isArray(operations) || operations.length === 0) {
			throw new FundsRegistrationError('operations', 'empty')
		}
		for (const step of operations) {
			if (!(CANONICAL as readonly string[]).includes(step as string)) {
				throw new FundsRegistrationError('operations', 'not-in-union')
			}
		}

		const plan = registration.plan
		if (!Array.isArray(plan) || plan.length === 0) throw new FundsRegistrationError('plan', 'empty')
		const seen = new Set<string>()
		for (const step of plan) {
			if (!(CANONICAL as readonly string[]).includes(step as string)) {
				throw new FundsRegistrationError('plan', 'unknown-step')
			}
			if (seen.has(step as string)) throw new FundsRegistrationError('plan', 'duplicate-step')
			seen.add(step as string)
		}
		// A wrapper that can be reconciled must declare the reconcile step; a money-mover with no reconcile
		// is a paid, unlearnable leg — and the wrapper that declares witness kinds it could only ever produce
		// through reconciliation has no step to produce them.
		if (!seen.has('reconcile')) throw new FundsRegistrationError('plan', 'no-reconcile-step')
		// The plan is the declared operations' ordered projection in the port's canonical order.
		const projection = CANONICAL.filter((step) => (operations as readonly string[]).includes(step))
		if (plan.length !== projection.length || plan.some((step, index) => step !== projection[index])) {
			throw new FundsRegistrationError('plan', 'wrong-projection')
		}

		const witnessKinds = registration.witnessKinds
		if (!Array.isArray(witnessKinds) || witnessKinds.length === 0) {
			throw new FundsRegistrationError('witnessKinds', 'empty')
		}
		for (const kind of witnessKinds) {
			if (!(WITNESS_KINDS as readonly string[]).includes(kind as string)) {
				throw new FundsRegistrationError('witnessKinds', 'not-in-union')
			}
		}

		requireNonEmptyString(registration.store, 'store')
		requireNonEmptyString(registration.storeKind, 'storeKind')

		if (authorityKind === 'remote-and-observable') {
			requirePositiveInteger(registration.reconcileDeadlineMs, 'reconcileDeadlineMs')
		} else if (registration.reconcileDeadlineMs !== undefined) {
			requirePositiveInteger(registration.reconcileDeadlineMs, 'reconcileDeadlineMs')
		}

		const journal = registration.journalReference
		if (!isPlainObject(journal) || journal.shape === undefined || journal.writtenBefore === undefined) {
			throw new FundsRegistrationError('journalReference', 'incomplete')
		}
		if (typeof journal.shape !== 'string' || journal.shape.length === 0) {
			throw new FundsRegistrationError('journalReference', 'missing')
		}
		if (journal.writtenBefore !== 'submit' && journal.writtenBefore !== 'exposure') {
			throw new FundsRegistrationError('journalReference', 'not-in-union')
		}

		requirePositiveInteger(registration.ceiling, 'ceiling')

		const contractVersion = requireIdentity(registration.contractVersion, 'contractVersion')
		if (contractVersion !== this.contractVersion) {
			throw new FundsRegistrationError('contractVersion', 'stale-version')
		}

		if (this.byMethod.has(method)) throw new FundsRegistrationError('method', 'duplicate-method')

		this.byMethod.set(method, registration)
		return registration
	}
}
