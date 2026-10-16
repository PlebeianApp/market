/**
 * wallet/ts/types.ts — the set's own vocabulary, and the wrapper port it takes as an injection.
 *
 * `#d91675` the aggregator cites only the funds contract: the set record, the conservation partition, the gate
 * and the refund guard name no rail, and each wrapper arrives as an injected port. This file adds the set
 * record's shape and the injected port interfaces; it re-declares no contract type.
 */
import type { FundsAuthorityKind, FundsHandle, FundsWitness, FundsWitnessKind, WrapperRegistration } from '../../funds-contract/ts/index'

/**
 * `#d91675` AggregatorWrapper — the port the aggregator takes one per rail, injected by the composing app: the
 * wrapper's registration and its handle-keyed reconcile. It names no rail, so adding a rail edits the app's
 * registry and not this module, and the aggregator holds a leg handle rather than a copy of any reference.
 */
export interface AggregatorWrapper {
	readonly registration: WrapperRegistration
	/** ask the owning wrapper for its leg's handle, keyed on the leg id — never on a raw reference copy */
	reconcileLeg(legId: string): Promise<FundsHandle>
}

/**
 * `#c5418e` SetDirection — a set is either the purchase direction (buyer to seller) or the refund direction
 * (seller to buyer); the refund is a separate set, never a mutation of the purchase set.
 */
export type SetDirection = 'purchase' | 'refund'

/**
 * `#16a79e` SetState — the set's own vocabulary, never a wallet operation's name: `unfinished` while any leg is
 * open, `complete` when every leg is settled and the sum is inside the aggregate band, `short-settled` or
 * `over-settled` when a fully settled set is beyond the band in each direction, and `abandoned` when every
 * leg is terminal and at least one is abandoned.
 */
export type SetState = 'unfinished' | 'complete' | 'short-settled' | 'over-settled' | 'abandoned'

/**
 * `#c5418e` LegEntry — one leg of the set record: the witness it saw, from which source, when and its reference,
 * never a verdict. It carries the leg's expectation (the payment hash the set already holds) and its frozen
 * share, and an `untrusted` marker that excludes the leg from the derivation and from its amounts, so a set
 * can never be reported paid while one of its legs is untrusted.
 */
export interface LegEntry {
	readonly wrapperId: string
	readonly legId: string
	readonly method: string
	readonly authorityKind: FundsAuthorityKind
	readonly expectedPaymentHash: string
	readonly frozenShare: number
	readonly operations: readonly string[]
	readonly plan: readonly string[]
	readonly rung: 'attested' | 'witnessed-settled' | 'unresolved' | 'abandoned'
	readonly witness?: FundsWitness
	/** the net amount the leg is observed to have settled, when it has; absent until a settlement is seen */
	readonly observedAmountSat?: number
	/** a leg whose only source is untrusted: excluded from the derivation and from the settled sum */
	readonly untrusted: boolean
	/** absolute, computed from the injected clock; present only where the authority is remote */
	readonly reconcileDeadlineAt?: number
}

/**
 * `#c5418e` SetRecord — the set: the frozen total, the order join key it is keyed to, its own identity, the
 * ordered leg entries and the derived state. It holds each leg's witness expectation and the handle by which
 * the owning wrapper is asked — never a copy of any leg's reference — and it is written before any leg is
 * submitted.
 */
export interface SetRecord {
	readonly setId: string
	readonly direction: SetDirection
	/** the stable join key: the order's own identity, and for a refund, the purchase set it reverses */
	readonly orderId: string
	readonly frozenTotal: number
	readonly legs: readonly LegEntry[]
	readonly state: SetState
	readonly toleranceSat: number
	/** a refund set names the purchase set it reverses */
	readonly refundOfSetId?: string
	/** a successor set names the abandoned set it supersedes, for a late artifact */
	readonly successorOf?: string
	readonly revision: number
	readonly createdAt: number
	readonly updatedAt: number
}

/**
 * `#c5418e` SetHandle — what the aggregator returns from `pay`, `status`, `reconcile` and `openRefund`: the set's
 * identity, its derived state, and per leg its rung, witness or explicit absence, and the trust marker.
 */
export interface SetHandle {
	readonly setId: string
	readonly direction: SetDirection
	readonly orderId: string
	readonly state: SetState
	readonly frozenTotal: number
	readonly legs: readonly LegHandle[]
	/** set when a returned witness disagreed with the stored expectation: surfaced, never merged */
	readonly mismatch?: boolean
}

/** `#c5418e` LegHandle — one leg of a `SetHandle`: the rung, the witness or its explicit absence, and the trust marker. */
export interface LegHandle {
	readonly wrapperId: string
	readonly legId: string
	readonly rung: LegEntry['rung']
	readonly witness?: FundsWitness
	readonly untrusted: boolean
}

/**
 * `#c5418e` SetStore — the aggregator's durable store: the CAS'd set records and the two indexes it is the sole
 * authority for — the hash-to-set index (a payment hash belongs to exactly one leg of exactly one set) and
 * the refund index keyed on an order (no second refund set for one order). `compareAndSet` MUST atomically
 * reject any revision other than `expectedRevision`.
 */
export interface SetStore {
	createOrGet(record: SetRecord): Promise<{ record: SetRecord; created: boolean }>
	get(setId: string): Promise<SetRecord | null>
	list(): Promise<readonly SetRecord[]>
	compareAndSet(setId: string, expectedRevision: number, next: SetRecord): Promise<SetRecord>
	claimedLegByHash(paymentHash: string): Promise<{ setId: string; legId: string } | null>
	claimHash(paymentHash: string, setId: string, legId: string): Promise<void>
	refundForOrder(orderId: string): Promise<string | null>
	recordRefund(orderId: string, setId: string): Promise<void>
}

/**
 * `#35b51d` WitnessVerifier — the injected self-contained witness check: a pure function over the witness a
 * wrapper returned and the leg's stored expectation, so the aggregator re-checks the cryptographic kinds
 * from its own record alone. It exercises no authority and holds no reference.
 */
export interface WitnessVerifier {
	verify(expectedPaymentHash: string, witness: FundsWitness): boolean
}

/**
 * `#c5418e` SetIntent — what opens a set: the frozen total, the join key and the ordered legs, each naming its
 * wrapper, its leg, its frozen share, its expectation and — where the authority is remote — its deadline. The
 * set record is derived from this and written before any leg is submitted.
 */
export interface SetIntent {
	readonly orderId: string
	readonly totalSat: number
	readonly legs: readonly LegIntent[]
}

/** `#c5418e` LegIntent — one leg of a `SetIntent`. */
export interface LegIntent {
	readonly wrapperId: string
	readonly legId: string
	readonly method: string
	readonly frozenShare: number
	readonly expectedPaymentHash: string
	readonly authorityKind: FundsAuthorityKind
	readonly operations: readonly string[]
	readonly plan: readonly string[]
	readonly reconcileDeadlineMs?: number
}

/**
 * `#92fc64` RefundRequest — what asks for a refund set: the purchase set's identity (resolved by the guard, not
 * trusted as a free string) and the refund's frozen total, which may not exceed the resolved purchase total.
 */
export interface RefundRequest {
	readonly purchaseSetId: string
	readonly refundTotalSat: number
	readonly legs: readonly LegIntent[]
}

/**
 * `#16a79e` LegPartition — the conservation partition: the frozen total, each leg's frozen share, and the
 * merchant's share as the residual by construction (`frozenTotal - Σ shares`), so the aggregate is derived
 * from the parts and holds one number.
 */
export interface LegPartition {
	readonly frozenTotal: number
	readonly shares: readonly { readonly legId: string; readonly frozenShare: number }[]
	readonly merchantShare: number
}

/**
 * `#72fd75` AggregatorOptions — what the composing app injects: the clock (never a host clock global), the
 * conservation tolerance, the contract version, the injected wrapper ports and the durable set store.
 */
export interface AggregatorOptions {
	readonly store: SetStore
	readonly verifier: WitnessVerifier
	readonly contractVersion: string
	readonly toleranceSat: number
	readonly wrappers: readonly AggregatorWrapper[]
	/** Unix milliseconds. Required so the module never reads a host clock global. */
	readonly now: () => number
}

/** `#16a79e` SettlingWitnessKind — the witness kinds that may settle a leg: the cryptographic kinds, keyed off the contract's own split. */
export type SettlingWitnessKind = Extract<FundsWitnessKind, 'preimage' | 'zap_receipt' | 'mint_quote_state'>
