/**
 * bolt11-wrapper/ts/adapter.ts — the rail's adapter: the seam the aggregator takes one per rail.
 *
 * `#e168d7` the adapter is the rail's own composition surface: it exposes the rail's port (the contract's
 * three verbs, `#d16b28`) and the aggregator's two-member seam — the wrapper's registration (`#87e7a5`)
 * and a **leg-id-keyed** reconcile. It lives in the rail's own module by decision (the adapter layer is
 * per-rail and co-located); it satisfies both shapes **structurally** and imports neither the wallet nor
 * any rail: the wallet's declaration names no rail, so a rail must equally name no wallet. (The wallet's
 * statement to that effect is not cited here — it is not an ancestor of this module, so citing its token
 * would be a claim this rail is not entitled to make.)
 *
 * THE SEAM THIS ADAPTER REPAIRS. The contract's `reconcile(reference)` means the rail's reference: the
 * bolt11 wrapper **decodes** its argument to a payment hash and looks the leg up under it. The aggregator's
 * seam hands a **leg id**, not a reference (`wallet/ts/aggregator.ts` reconciles `leg.legId`). Handing a
 * leg id to `reconcile` would decode the leg id as if it were an invoice — the parity the seam assumes and
 * the rail's own `reconcile` does not honour. `reconcileLeg` is where that is fixed: it maps
 * `legId → the stored record → the payment hash` through the rail's own leg store (`#0dc3ca`), so the
 * reference is pinned to the leg id and the argument is never read as a raw reference.
 */
import { Bolt11Wrapper } from './wrapper'
import { Bolt11WrapperError } from './errors'
import type {
	Bolt11InvoiceCodec,
	Bolt11LegCommand,
	Bolt11LegStore,
	Bolt11WrapperOptions,
} from './types'
import type {
	FundsHandle,
	FundsQuote,
	FundsRefusal,
	WrapperRegistration,
} from '../../funds-contract/ts/index'

/**
 * `#e168d7` Bolt11Adapter — the bolt11 rail's adapter. It exposes the rail's port over its own
 * `Bolt11Wrapper`, and the aggregator's seam beside it. The leg store and the invoice codec are the same
 * injected ports the wrapper uses, so the leg-id resolution reads exactly the leg the rail wrote at
 * `obtain`.
 */
export class Bolt11Adapter {
	private readonly wrapper: Bolt11Wrapper
	private readonly store: Bolt11LegStore
	private readonly codec: Bolt11InvoiceCodec
	private readonly wrapperId: string

	constructor(options: Bolt11WrapperOptions) {
		this.wrapper = new Bolt11Wrapper(options)
		this.store = options.store
		this.codec = options.codec
		this.wrapperId = options.wrapperId
	}

	/** The declaration the aggregator's acceptance gate validates; the rail's own registration (`#87e7a5`). */
	get registration(): WrapperRegistration {
		return this.wrapper.registration
	}

	/** `#d16b28` the port's first verb, over the rail: resolve the leg's durable reference before money moves. */
	obtain(command: Bolt11LegCommand): Promise<FundsQuote | FundsRefusal> {
		return this.wrapper.obtain(command)
	}

	/** `#d16b28` the port's second verb, over the rail: the one irreversible step. */
	submit(quote: FundsQuote, reference: string): Promise<FundsHandle> {
		return this.wrapper.submit(quote, reference)
	}

	/** `#d16b28` the port's third verb, over the rail: re-read the authority; never submits. */
	reconcile(reference: string): Promise<FundsHandle> {
		return this.wrapper.reconcile(reference)
	}

	/**
	 * `#e168d7` The aggregator's leg-id-keyed reconcile — the seam's parity, repaired here. The argument is
	 * a **leg id**, so it is resolved through the rail's own leg store (`#0dc3ca`) to the record the leg
	 * wrote at `obtain`, and the reference handed to the rail's own `reconcile` is **that stored invoice**,
	 * never the argument. The payment hash is derived from the stored invoice and must equal the leg id —
	 * the pin that makes the leg id and the reference name the same leg. A leg id the store does not carry
	 * fails closed (`bolt11_leg_unknown`); the argument is never treated as a raw reference.
	 */
	async reconcileLeg(legId: string): Promise<FundsHandle> {
		const record = await this.store.get({ wrapperId: this.wrapperId, legId })
		if (!record) {
			throw new Bolt11WrapperError('bolt11_leg_unknown', `reconcileLeg: no leg ${legId}`)
		}
		const paymentHash = this.codec.paymentHash(record.bolt11)
		if (paymentHash !== record.legId) {
			throw new Bolt11WrapperError(
				'bolt11_leg_unknown',
				`reconcileLeg: leg ${legId} does not pin its reference`,
			)
		}
		// The reference is pinned to the leg id: the rail's own reconcile decodes the STORED invoice, which
		// is the payment hash the store keyed the leg under — not the seam's argument.
		return this.wrapper.reconcile(record.bolt11)
	}
}
