/**
 * bolt11-wrapper/ts/types.ts — the bolt11 rail's own types and the ports it injects.
 *
 * `#388e47` the port's vocabulary is obtained from this module's ancestor, the funds contract, and never
 * restated here: this file adds only the rail's four leg kinds, the leg record and store, and the injected
 * library ports. The rail's authority is remote-and-observable, so a leg carries a verification
 * expectation rather than a reconciliation handle.
 */
import type {
	FundsAuthorityKind,
	FundsOperations,
	FundsProgress,
	FundsRung,
	FundsStep,
	FundsWitness,
	FundsWitnessKind,
} from '../../funds-contract/ts/index'

/**
 * `#c912d5` Bolt11LegKind — the rail's four legs: the browser signer, the passive broadcast quote, the
 * manual preimage and the LNURL request.
 */
export type Bolt11LegKind = 'webln' | 'broadcast-quote' | 'manual-preimage' | 'lnurl-request'

/**
 * `#c912d5` Bolt11OperationsDeclaration — the subset of the port's operations one leg has, in the port's
 * canonical order. A passive leg omits `submit`, so its absent submit is a declared fact.
 */
export interface Bolt11OperationsDeclaration {
	readonly kind: Bolt11LegKind
	readonly operations: FundsOperations
	readonly plan: readonly FundsStep[]
}

/**
 * `#e168d7` Bolt11LegCommand — what opens a leg. The rail's own parameters only: the app supplies either a
 * broadcast invoice, or an LNURL-pay endpoint to request one from. The durable reference is resolved from
 * the invoice, so the command names no store.
 */
export interface Bolt11LegCommand {
	readonly kind: Bolt11LegKind
	readonly amountSat: number
	readonly description?: string
	/** the broadcast quote's invoice, when the app supplies one instead of requesting it */
	readonly bolt11?: string
	readonly verifyUrl?: string | null
	/** the LNURL-pay endpoint to request an invoice from, for the lnurl-request leg */
	readonly lnurl?: string
}

/**
 * `#0dc3ca` Bolt11LegKey — the leg store's key: per wrapper and leg. The leg id is the invoice's
 * `payment_hash`, so the reference the port returns also resolves the leg.
 */
export interface Bolt11LegKey {
	readonly wrapperId: string
	readonly legId: string
}

/**
 * `#0dc3ca` Bolt11LegRecord — the wrapper's durable leg record: the reference it binds (the bolt11 and its
 * payment hash, plus the LNURL verification URL when the request supplied one), the leg's declared
 * operations and plan, and where it has reached. It carries no bearer material and no connection secret.
 */
export interface Bolt11LegRecord {
	readonly wrapperId: string
	readonly legId: string
	readonly kind: Bolt11LegKind
	readonly method: string
	readonly authorityKind: FundsAuthorityKind
	readonly operations: FundsOperations
	readonly plan: readonly FundsStep[]
	/** the durable reference: the invoice */
	readonly bolt11: string
	readonly paymentHash: string
	readonly verifyUrl?: string | null
	readonly progress: FundsProgress
	readonly rung: FundsRung
	readonly witness?: FundsWitness
	/** explicit marker that no witness closes this leg — never an empty string */
	readonly unwitnessed: boolean
	/** absolute, computed from the injected clock; present because the authority is remote */
	readonly reconcileDeadlineAt: number
	readonly revision: number
	readonly createdAt: number
	readonly updatedAt: number
}

/**
 * `#0dc3ca` Bolt11LegStore — the durable leg store the wrapper declares and the app injects: the wallet
 * host's store contract, generalised by key per wrapper and leg. `compareAndSet` MUST atomically reject
 * any revision other than `expectedRevision`.
 */
export interface Bolt11LegStore {
	createOrGet(record: Bolt11LegRecord): Promise<{ record: Bolt11LegRecord; created: boolean }>
	get(key: Bolt11LegKey): Promise<Bolt11LegRecord | null>
	list(wrapperId?: string): Promise<readonly Bolt11LegRecord[]>
	compareAndSet(key: Bolt11LegKey, expectedRevision: number, next: Bolt11LegRecord): Promise<Bolt11LegRecord>
}

/**
 * `#885295` Bolt11InvoiceCodec — the injected invoice codec: decode an invoice's payment hash, validate
 * a preimage against it, and read the invoice's own expiry. `#dc6ab1` the invoice's expiry is the rail's
 * window — the fact that decides the non-settlement terminal — and it is decoded here, never asserted
 * beside the record. The market's own codec is `@getalby/lightning-tools`; the module imports neither.
 */
export interface Bolt11InvoiceCodec {
	paymentHash(bolt11: string): string
	validatePreimage(bolt11: string, preimage: string): boolean
	/** the invoice's absolute expiry instant, in Unix milliseconds — the rail's window (`#dc6ab1`) */
	expiresAt(bolt11: string): number
}

/**
 * `#885295` Bolt11Signer — the injected browser signer: hand it an invoice and read the preimage it returns.
 * The market's own signer is `window.webln`; the module imports neither and reads no global.
 */
export interface Bolt11Signer {
	sendPayment(bolt11: string): Promise<{ preimage?: string }>
}

/**
 * `#885295` Bolt11LnurlRequester — the injected LNURL-pay request: ask an endpoint for an invoice and the
 * verification URL its response carries. The module performs no request of its own.
 */
export interface Bolt11LnurlRequester {
	requestInvoice(
		lnurl: string,
		amountSat: number,
		description?: string,
	): Promise<{ bolt11: string; verifyUrl?: string | null }>
}

/**
 * `#885295` Bolt11LnurlVerifier — the injected verification reader. It distinguishes "no answer" (`ok:
 * false`) from "not settled" (`ok: true, settled: false`), so a failed look-up is recorded as unresolved,
 * never as a negative settlement.
 */
export interface Bolt11LnurlVerifier {
	verify(verifyUrl: string): Promise<{ ok: true; settled: boolean; preimage?: string } | { ok: false }>
}

/**
 * `#e168d7` Bolt11WrapperOptions — what the composing app injects: the durable store, the injected library
 * ports and the injected clock. `now` is required so the module never reads a host clock global.
 */
export interface Bolt11WrapperOptions {
	readonly wrapperId: string
	readonly store: Bolt11LegStore
	readonly storeKind: string
	readonly codec: Bolt11InvoiceCodec
	readonly signer?: Bolt11Signer
	readonly lnurlRequester?: Bolt11LnurlRequester
	readonly lnurlVerifier?: Bolt11LnurlVerifier
	/** the wait bound the registration declares and the leg record instantiates, in milliseconds */
	readonly reconcileDeadlineMs: number
	readonly ceiling: number
	readonly contractVersion: string
	/** Unix milliseconds. Required so the module never reads a host clock global. */
	readonly now: () => number
}

/** The witness kind the rail can produce from a source, for the registration's declaration. */
export type Bolt11WitnessKinds = readonly FundsWitnessKind[]
