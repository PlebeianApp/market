/**
 * money.ts — **the money composition path**: the rung constructs the bolt11 rail's adapter and registers it
 * with the set aggregator, so `PayAggregator.reconcile` reaches the rail through the one seam it takes per
 * rail.
 *
 * **Why this lives here, and not in the wallet or the rail.** The aggregator names no rail: it takes each
 * wrapper as an **injected port** (`{ registration, reconcileLeg(legId) }`) and cites only the funds
 * contract, so adding a rail edits the app's registry and leaves the wallet byte-identical. The rail's
 * adapter satisfies that port **structurally** and imports neither the wallet nor any rail, for the same
 * reason in the other direction. Something must still *construct* the adapter and hand it to
 * `PayAggregator.register()` — the design's "app's registry". That something is a composition root, and this
 * rung is the one place a composition root may legitimately name its siblings: the `validation` path is
 * `./compose` (`composeCommerce`), and this is the money path beside it. The app (`src/`) still constructs
 * nothing — out of scope, by design.
 *
 * **One clock.** The root takes the clock once and injects it into **both** the rail's leg record and the
 * aggregator's set window, so a leg's reconcile deadline and the set's own deadline are read from the same
 * source and cannot disagree. Every other rail input (the leg store, the invoice codec, the signer, the
 * LNURL ports) is injected unchanged — the rail opens no network of its own, and neither does this file.
 *
 * **Nothing is hand-wired.** The registration is `PayAggregator.register`, so the rail's declaration is
 * validated by the real acceptance gate before the adapter becomes a port; a malformed declaration throws at
 * boot and no rail is registered.
 */
import { Bolt11Adapter } from '../../bolt11-wrapper/ts/index'
import type { Bolt11WrapperOptions } from '../../bolt11-wrapper/ts/index'
import { PayAggregator } from '../../wallet/ts/index'
import type { SetStore, WitnessVerifier } from '../../wallet/ts/index'

/**
 * The bolt11 rail's own injected inputs, with the clock supplied once by this root — see `ComposeMoneyOptions.now`.
 * `Omit` rather than a second clock field, so there is exactly one place a clock enters the composition.
 */
export type Bolt11CompositionInputs = Omit<Bolt11WrapperOptions, 'now'>

/** What the host hands the money composition path: the rail's inputs, the set store and the witness check. */
export interface ComposeMoneyOptions {
	/** The rail's injected ports and its own leg store, minus the clock (supplied by `now` below). */
	readonly bolt11: Bolt11CompositionInputs
	/** The aggregator's durable set store: the CAS'd set records and the hash-to-set and refund indexes. */
	readonly store: SetStore
	/** The injected self-contained witness check the aggregator re-checks a cryptographic witness with. */
	readonly verifier: WitnessVerifier
	/** The contract version the registrations were written against; the gate checks it against itself. */
	readonly contractVersion: string
	/** The set's conservation tolerance in satoshis; the aggregate band is this times the leg count. */
	readonly toleranceSat: number
	/** Unix milliseconds. Injected into BOTH the rail's leg record and the aggregator's window — one clock. */
	readonly now: () => number
}

/** What the money path hands back: the aggregator with the rail registered, and the rail's own adapter. */
export interface ComposedMoney {
	readonly aggregator: PayAggregator
	/**
	 * The rail's adapter — the same object the aggregator holds as a port. It exposes the rail's own port
	 * (`obtain`/`submit`/`reconcile`) beside the aggregator's two-member seam, so a host can drive the rail
	 * directly and the set through one constructed pair.
	 */
	readonly bolt11: Bolt11Adapter
	/** The registrations the real acceptance gate accepted, by wrapper id. */
	readonly accepted: readonly string[]
}

/**
 * `composeMoney` — the money composition path. It constructs the rail's adapter, constructs the aggregator
 * over the host's store, witness check and clock, and **registers the adapter through
 * `PayAggregator.register`**: the gate validates the rail's declaration, and the adapter becomes the port
 * `reconcile` asks for a leg's handle. A malformed declaration throws here, at boot, before any set is opened.
 */
export function composeMoney(options: ComposeMoneyOptions): ComposedMoney {
	const bolt11 = new Bolt11Adapter({ ...options.bolt11, now: options.now })
	const aggregator = new PayAggregator({
		store: options.store,
		verifier: options.verifier,
		contractVersion: options.contractVersion,
		toleranceSat: options.toleranceSat,
		now: options.now,
		// The rail is registered through `register` below — the named call this path exists to make — so the
		// constructor's collection stays empty and there is exactly one registration site.
		wrappers: [],
	})
	aggregator.register(bolt11)
	return { aggregator, bolt11, accepted: aggregator.accepted() }
}
