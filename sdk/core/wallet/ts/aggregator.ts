/**
 * wallet/ts/aggregator.ts — the set: the set record, the conservation rule, the watcher, the
 * witness-versus-expectation comparison and the refund guard.
 *
 * `#c5418e` the set record records a witness per leg, never a verdict, and the set state is derived from what is
 * proven, excluding any untrusted leg — so a set can never be reported paid while one of its legs is
 * untrusted. `#16a79e` conservation is a per-leg band summed for the aggregate, with a signed residual and two
 * directions. `#dc848c` the watcher reaches the rule-reached terminals and time alone never settles a leg.
 * `#92fc64` the refund guard is the durable authority on "no refund exists for this order", keyed on the resolved
 * purchase set's identity. `#d91675` the aggregator cites only the contract and takes each wrapper as an injected
 * port, so adding a rail edits the app's registry and not this module.
 */
import { FundsDuplicateRefundError, FundsRegistrationError, PayAggregatorError } from './errors'
import { FundsRegistrationGate } from './gate'
import type {
	AggregatorOptions,
	AggregatorWrapper,
	LegEntry,
	LegIntent,
	LegPartition,
	RefundRequest,
	SetHandle,
	SetIntent,
	SetRecord,
} from './types'
import type { FundsHandle, FundsWitness } from '../../funds-contract/ts/index'

/** The cryptographic witness kinds: only these may settle a leg; every declared kind reaches `attested`. */
const CRYPTOGRAPHIC: readonly string[] = ['preimage', 'zap_receipt', 'mint_quote_state']

const isCryptographic = (kind: string): boolean => CRYPTOGRAPHIC.includes(kind)

const isSettledLeg = (leg: LegEntry): boolean => leg.rung === 'witnessed-settled' && !leg.untrusted

const isTerminalLeg = (leg: LegEntry): boolean => isSettledLeg(leg) || leg.rung === 'abandoned'

/**
 * `#16a79e` deriveSetState — the set's state derived from what is proven, never a stored verdict: a leg counts
 * toward the settled sum only when it is `witnessed-settled` and not `untrusted`, so a set can never be
 * `complete` while one of its legs is untrusted. The aggregate band is the per-leg band summed,
 * `N x toleranceSat`; a fully settled set inside the band is `complete`, and beyond it the signed residual
 * gives `short-settled` (below) or `over-settled` (above), never `abandoned`.
 */
export function deriveSetState(legs: readonly LegEntry[], frozenTotal: number, toleranceSat: number): SetRecord['state'] {
	if (legs.length === 0) return 'unfinished'
	const allSettled = legs.every(isSettledLeg)
	const allTerminal = legs.every(isTerminalLeg)
	const anyAbandoned = legs.some((leg) => leg.rung === 'abandoned')

	if (allSettled) {
		const sum = legs.reduce((total, leg) => total + (leg.observedAmountSat ?? leg.frozenShare), 0)
		const residual = sum - frozenTotal
		const band = legs.length * toleranceSat
		if (residual < -band) return 'short-settled'
		if (residual > band) return 'over-settled'
		return 'complete'
	}
	if (allTerminal && anyAbandoned) return 'abandoned'
	return 'unfinished'
}

const handleFor = (record: SetRecord, mismatch?: boolean): SetHandle => ({
	setId: record.setId,
	direction: record.direction,
	orderId: record.orderId,
	state: deriveSetState(record.legs, record.frozenTotal, record.toleranceSat),
	frozenTotal: record.frozenTotal,
	legs: record.legs.map((leg) => ({
		wrapperId: leg.wrapperId,
		legId: leg.legId,
		rung: leg.rung,
		witness: leg.witness,
		untrusted: leg.untrusted,
	})),
	...(mismatch ? { mismatch: true } : {}),
})

/**
 * `#c5418e` PayAggregator — the set's owner. It takes each wrapper as an injected port and cites only the funds
 * contract, so it names no rail; it holds each leg's witness expectation and the handle by which the owning
 * wrapper is asked, never a copy of any reference, and it exposes `pay`, `status`, `reconcile` and
 * `openRefund` over the set.
 */
export class PayAggregator {
	private readonly options: AggregatorOptions
	private readonly gate: FundsRegistrationGate
	private readonly portsByWrapper = new Map<string, AggregatorWrapper>()
	private sequence = 0

	constructor(options: AggregatorOptions) {
		if (typeof options.now !== 'function') {
			throw new PayAggregatorError('pay_aggregator_configuration', 'the aggregator requires an injected clock')
		}
		if (!Number.isSafeInteger(options.toleranceSat) || options.toleranceSat <= 0) {
			throw new PayAggregatorError('pay_aggregator_configuration', 'toleranceSat must be a positive safe integer')
		}
		this.gate = new FundsRegistrationGate(options.contractVersion)
		this.options = options
		for (const wrapper of options.wrappers) this.register(wrapper)
	}

	/** Validate and accept a wrapper through the gate; a malformed declaration throws and is not registered. */
	register(wrapper: AggregatorWrapper): void {
		this.gate.register(wrapper.registration)
		this.portsByWrapper.set(wrapper.registration.wrapperId, wrapper)
	}

	/** The accepted registrations, as the gate holds them. */
	accepted(): readonly string[] {
		return this.gate.list().map((registration) => registration.wrapperId)
	}

	/**
	 * `#16a79e` partition — the conservation partition: the aggregate is derived from the parts, and the merchant's
	 * share is the residual by construction, so there is one number and it cannot drift.
	 */
	partition(totalSat: number, legs: readonly { readonly legId: string; readonly frozenShare: number }[]): LegPartition {
		const shares = legs.map((leg) => ({ legId: leg.legId, frozenShare: leg.frozenShare }))
		const merchantShare = totalSat - shares.reduce((total, share) => total + share.frozenShare, 0)
		return { frozenTotal: totalSat, shares, merchantShare }
	}

	/**
	 * `#c5418e` pay — open a purchase set: bind the frozen total to the ordered legs and write the set record,
	 * with each leg's witness expectation, **before any leg is submitted**. A payment hash already claimed by
	 * another set refuses the set, so a hash belongs to exactly one leg of exactly one set.
	 */
	async pay(intent: SetIntent): Promise<SetHandle> {
		const now = this.options.now()
		const setId = `purchase:${intent.orderId}:${this.sequence++}`

		const seen = new Set<string>()
		const legs: LegEntry[] = []
		for (const leg of intent.legs) {
			if (seen.has(leg.expectedPaymentHash)) {
				throw new PayAggregatorError('pay_hash_claimed', 'a payment hash belongs to one leg')
			}
			seen.add(leg.expectedPaymentHash)
			legs.push(this.openLeg(leg, now))
		}
		for (const leg of legs) {
			const claimed = await this.options.store.claimedLegByHash(leg.expectedPaymentHash)
			if (claimed && claimed.setId !== setId) {
				throw new PayAggregatorError('pay_hash_claimed', 'a payment hash belongs to one leg of one set')
			}
		}

		const record: SetRecord = {
			setId,
			direction: 'purchase',
			orderId: intent.orderId,
			frozenTotal: intent.totalSat,
			legs,
			state: 'unfinished',
			toleranceSat: this.options.toleranceSat,
			revision: 0,
			createdAt: now,
			updatedAt: now,
		}
		const stored = await this.options.store.createOrGet(record)
		if (stored.created) {
			for (const leg of legs) await this.options.store.claimHash(leg.expectedPaymentHash, setId, leg.legId)
		}
		return handleFor(stored.record)
	}

	/** `#c5418e` status — read a set and derive its state from what is proven. */
	async status(setId: string): Promise<SetHandle> {
		return handleFor(await this.readSet(setId))
	}

	/**
	 * `#dc848c` reconcile — the watcher: ask each owning wrapper for its leg's handle, re-check a returned witness
	 * against the set record's own expectation, and move the set only on a cryptographic settle. A rule-reached
	 * terminal (every leg terminal with at least one abandoned) is reached without a human; a remote leg that
	 * has not answered stays `unresolved`, and time alone never promotes anything to settled.
	 */
	async reconcile(setId: string): Promise<SetHandle> {
		const record = await this.readSet(setId)
		const now = this.options.now()
		let mismatch = false
		const legs: LegEntry[] = []
		for (const leg of record.legs) {
			if (isSettledLeg(leg)) {
				legs.push(leg)
				continue
			}
			const port = this.portsByWrapper.get(leg.wrapperId)
			let handle: FundsHandle | null = null
			if (port) {
				try {
					handle = await port.reconcileLeg(leg.legId)
				} catch {
					handle = null
				}
			}
			legs.push(this.applyHandle(leg, handle, now, () => (mismatch = true)))
		}
		const next: SetRecord = {
			...record,
			legs,
			revision: record.revision + 1,
			updatedAt: now,
		}
		const derived: SetRecord = { ...next, state: deriveSetState(legs, record.frozenTotal, record.toleranceSat) }
		const stored = await this.options.store.compareAndSet(setId, record.revision, derived)
		return handleFor(stored, mismatch)
	}

	/**
	 * `#92fc64` openRefund — the refund guard: the durable authority on "no refund exists for this order". It
	 * resolves the named purchase set and keys on **that resolved set's own identity**, refusing a duplicate
	 * refund for the order, an unresolvable correlation, and a refund above the purchase total; a second refund
	 * set for one order is unreachable. The refund set record is written before any refund leg moves money.
	 */
	async openRefund(request: RefundRequest): Promise<SetHandle> {
		const now = this.options.now()
		const purchase = await this.options.store.get(request.purchaseSetId)
		if (!purchase || purchase.direction !== 'purchase') {
			throw new FundsDuplicateRefundError('unresolvable')
		}
		const orderId = purchase.orderId
		const existing = await this.options.store.refundForOrder(orderId)
		if (existing) throw new FundsDuplicateRefundError('duplicate', existing)
		if (request.refundTotalSat > purchase.frozenTotal) {
			throw new FundsDuplicateRefundError('over-total')
		}

		const setId = `refund:${orderId}:${this.sequence++}`
		const legs = request.legs.map((leg) => this.openLeg(leg, now))
		const record: SetRecord = {
			setId,
			direction: 'refund',
			orderId,
			frozenTotal: request.refundTotalSat,
			legs,
			state: 'unfinished',
			toleranceSat: this.options.toleranceSat,
			refundOfSetId: purchase.setId,
			revision: 0,
			createdAt: now,
			updatedAt: now,
		}
		const stored = await this.options.store.createOrGet(record)
		if (stored.created) await this.options.store.recordRefund(orderId, setId)
		return handleFor(stored.record)
	}

	private openLeg(leg: LegIntent, now: number): LegEntry {
		const deadline =
			leg.authorityKind === 'remote-and-observable' && leg.reconcileDeadlineMs !== undefined ? now + leg.reconcileDeadlineMs : undefined
		return {
			wrapperId: leg.wrapperId,
			legId: leg.legId,
			method: leg.method,
			authorityKind: leg.authorityKind,
			expectedPaymentHash: leg.expectedPaymentHash,
			frozenShare: leg.frozenShare,
			operations: [...leg.operations],
			plan: [...leg.plan],
			rung: 'unresolved',
			untrusted: false,
			reconcileDeadlineAt: deadline,
		}
	}

	private applyHandle(leg: LegEntry, handle: FundsHandle | null, now: number, onMismatch: () => void): LegEntry {
		if (!handle) return this.window(leg, now)
		const witness: FundsWitness | undefined = handle.witness
		if (handle.rung === 'witnessed-settled') {
			const settles =
				witness !== undefined && isCryptographic(witness.kind) && this.options.verifier.verify(leg.expectedPaymentHash, witness)
			if (settles && witness) {
				return {
					...leg,
					rung: 'witnessed-settled',
					witness,
					untrusted: false,
					observedAmountSat: leg.observedAmountSat ?? leg.frozenShare,
				}
			}
			// A claimed settle the set cannot substantiate: a declared kind, or a witness that disagrees with
			// the expectation. It is surfaced as a mismatch, not merged — the leg reaches only `attested`.
			onMismatch()
			return { ...leg, rung: 'attested', witness, observedAmountSat: undefined }
		}
		if (handle.rung === 'attested') return { ...leg, rung: 'attested', witness }
		if (handle.rung === 'abandoned') return { ...leg, rung: 'abandoned' }
		return this.window(leg, now)
	}

	private window(leg: LegEntry, now: number): LegEntry {
		if (leg.rung === 'abandoned' || isSettledLeg(leg)) return leg
		if (leg.reconcileDeadlineAt !== undefined && now >= leg.reconcileDeadlineAt) {
			return { ...leg, rung: 'abandoned' }
		}
		return { ...leg, rung: 'unresolved' }
	}

	private async readSet(setId: string): Promise<SetRecord> {
		const record = await this.options.store.get(setId)
		if (!record) throw new PayAggregatorError('pay_set_unknown', 'no set for that handle')
		return record
	}
}

/** Re-exported so a caller can branch on the gate's refusal without importing the error module directly. */
export { FundsRegistrationError }
