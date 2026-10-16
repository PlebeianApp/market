/**
 * funds-contract/ts/types.ts — the payment contract's port types.
 *
 * Types only. This module declares the payment layer's vocabulary once — the port's three operations,
 * the shapes they exchange, the per-rail operations subset, the rung vocabulary and the registration
 * shape — so every rail wrapper shares one dialect. It holds no store, no transport and no authority
 * code, and it has no side effects: the module performs nothing. See funds-contract/funds-contract.md.
 */

/**
 * `#de8ec0` FundsStep — the port's own three operations, and nothing more. The port is a closed set;
 * a rail declares the subset of these it has, so a leg without a `submit` is a declared fact.
 */
export type FundsStep = 'obtain' | 'submit' | 'reconcile'

/**
 * `#de8ec0` FundsOperations — the non-empty subset of the port's operations a rail exposes. The
 * declared plan is this subset's ordered projection in the port's canonical order (`obtain`, then
 * `submit`, then `reconcile`); a passive leg omits `submit` and is legal by that declaration.
 */
export type FundsOperations = readonly [FundsStep, ...FundsStep[]]

/**
 * `#a8e2cf` FundsAuthorityKind — derived from a leg's method, never asserted beside it. `local` is a
 * proof repository the app itself holds; `remote-and-observable` is one it can only address through a
 * rail, so the leg's binding carries a verification expectation instead of a reconciliation handle.
 */
export type FundsAuthorityKind = 'local' | 'remote-and-observable'

/**
 * `#6f9f08` FundsProgress — the progress markers, in order, before any proof rung is reached.
 * A leg climbs these with the rail's own calls; none of them is a settlement.
 */
export type FundsProgress = 'intent' | 'attempted' | 'submitted'

/**
 * `#6f9f08` FundsRung — the one proof vocabulary, four rungs. A parenthesised family name in an
 * implementation maps onto one of these, never a rung of its own: `attested` is a party's or an
 * authority's word; `witnessed-settled` is a cryptographic artifact checkable against the leg's own
 * expectation; `unresolved` means no witness yet and one may still arrive; `abandoned` means the
 * window elapsed and no artifact will arrive. Only a cryptographic witness settles.
 */
export type FundsRung = 'attested' | 'witnessed-settled' | 'unresolved' | 'abandoned'

/**
 * `#6f9f08` FundsWitnessKind — the witness kinds, split by what can be forged. Cryptographic kinds
 * (`preimage`, a `zap_receipt` whose preimage validates, a `mint_quote_state` a wrapper re-derives
 * from a local mint) may settle a leg; declared kinds (`lnurl_verify`, `seller_attestation`, `ack`)
 * are a reporter's word and may move a leg no further than `attested`.
 */
export type FundsWitnessKind = 'preimage' | 'zap_receipt' | 'mint_quote_state' | 'lnurl_verify' | 'seller_attestation' | 'ack'

/**
 * `#d16b28` FundsIntent — what opens a leg. The rail's own parameters only: the contract
 * holds no transport, so an intent names the leg and the amount and leaves the rail's surface to the
 * wrapper's own deeper types.
 */
export interface FundsIntent {
	readonly wrapperId: string
	readonly legId: string
	readonly method: string
	readonly amountSat: number
	readonly description?: string
}

/**
 * `#d16b28` FundsQuote — `obtain`'s settled arm: the leg's durable reference in the
 * rail's own form (an invoice and its payment hash, a mint's quote), the authority kind derived from
 * the method, the operations the leg exposes and their ordered plan.
 */
export interface FundsQuote {
	readonly wrapperId: string
	readonly legId: string
	readonly method: string
	readonly authorityKind: FundsAuthorityKind
	readonly operations: FundsOperations
	readonly plan: readonly FundsStep[]
	/** the durable reference, opaque to the contract: the wrapper names its shape */
	readonly reference: string
}

/**
 * `#d16b28` FundsRefusal — `obtain`'s other arm: a fail-closed refusal that names the
 * field it fails on and never echoes the offending value.
 */
export interface FundsRefusal {
	readonly refused: true
	readonly reason: string
	readonly field: string
}

/**
 * `#d16b28` FundsWitness — the artifact that closes a leg: its kind, its source, when it
 * was observed, and (for a kind whose reference is not bearer material) the reference it was read
 * from. It is never bearer material and is never erased.
 */
export interface FundsWitness {
	readonly kind: FundsWitnessKind
	readonly source: string
	readonly observedAt: number
	readonly reference?: string
}

/**
 * `#6f9f08` FundsState — a leg's state: its progress marker and, once a proof exists, its rung. A
 * leg whose only source is untrusted carries `untrusted` beside its rung and never settles.
 */
export interface FundsState {
	readonly progress: FundsProgress
	readonly rung?: FundsRung
	readonly untrusted?: boolean
}

/**
 * `#d16b28` FundsHandle — what `submit` and `reconcile` return: the leg's state and the
 * witness that closes it, plus an explicit `unwitnessed` marker when none does (never an empty
 * string). It carries no bearer material and, where the authority is remote, the leg's absolute
 * reconcile deadline.
 */
export interface FundsHandle {
	readonly wrapperId: string
	readonly legId: string
	readonly progress: FundsProgress
	readonly rung: FundsRung
	readonly witness?: FundsWitness
	/** explicit marker that no witness closes this leg — never an empty string */
	readonly unwitnessed: boolean
	/** absolute, computed from an injected clock; absent for a local authority */
	readonly reconcileDeadlineAt?: number
}

/**
 * `#87e7a5` WrapperRegistration — the declaration a wrapper hands the aggregator's acceptance gate:
 * its stable identity, method, port, method-derived authority kind, the operations it exposes with
 * their ordered plan, its declared durable store and the store's kind, the witness kinds it can
 * produce, a reconcile deadline where the authority is remote, the shape and boundary of its journal
 * reference, its ceiling and the contract version it was written against. The gate checks the shape
 * and self-consistency of this declaration, never its conduct.
 */
export interface WrapperRegistration {
	readonly wrapperId: string
	readonly method: string
	readonly port: string
	readonly authorityKind: FundsAuthorityKind
	readonly operations: FundsOperations
	readonly plan: readonly FundsStep[]
	readonly store: string
	readonly storeKind: string
	readonly witnessKinds: readonly FundsWitnessKind[]
	readonly reconcileDeadlineMs?: number
	readonly journalReference: { readonly shape: string; readonly writtenBefore: string }
	readonly ceiling: number
	readonly contractVersion: string
}
