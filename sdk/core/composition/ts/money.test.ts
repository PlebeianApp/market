/**
 * money.test.ts — **the offline end-to-end set run over bolt11**: a real payment set driven through the
 * registered composition, with the rail's own fakes and no network.
 *
 * This is the increment's second criterion, and it is the cheapest falsification of the registration:
 * `composeMoney` constructs the rail's adapter and registers it through `PayAggregator.register`, and then
 * the **real** aggregator opens a set and reconciles it against the **real** rail, reached only through the
 * registered adapter's `reconcileLeg`. Every library call is a fake — the invoice codec, the signer and the
 * leg store — so nothing here touches a live node, mint or network.
 *
 * What it proves, and the careless implementation each case turns red:
 *
 * 1. `pay()` then `reconcile()` run against the real rail: the leg id the set holds is resolved through the
 *    rail's own leg store to the stored invoice, the rail settles on its validated preimage, and the set
 *    derives `complete`. **Red** if `reconcileLeg` is not registered (the aggregator asks no port and the leg
 *    stays `unresolved`), if the seam hands the raw leg id to the rail's own `reconcile` (the codec refuses a
 *    leg id that is not `lnbc…`, so no settle), or if the app's witness check is bypassed.
 * 2. A rail-produced **declared** witness (`ack`) never completes the set through the composition: the leg
 *    reaches only `attested` and the set stays `unfinished`. **Red** if the aggregator trusts the rail's rung
 *    instead of re-checking the witness kind.
 * 3. A leg id the rail's store does not carry fails **closed**: `reconcileLeg` refuses it, the aggregator
 *    records no settlement, and the set stays `unfinished` — the argument is never decoded as a reference.
 *
 * **A measured observation, not repaired here.** The aggregator's witness check is `verify(expectedHash,
 * witness)`, and the bolt11 rail's cryptographic witness is `{ kind: 'preimage', source, observedAt }` — it
 * carries **no** `reference` and no preimage (the rail's witness is never bearer material), so a check that
 * re-derives the preimage from the set record alone cannot be written for this rail. The app's check below
 * therefore re-checks the rail's own settled **kind** (the rail emits `preimage` only after its injected codec
 * validated the preimage against the leg's invoice). Whether the rail's witness should carry a checkable
 * reference is a design question for the rail's own increment, not for this registration.
 */
import { expect, test } from 'bun:test'

import { composeMoney } from './money'
import type { Bolt11CompositionInputs } from './money'
import { MemoryBolt11LegStore } from '../../bolt11-wrapper/ts/index'
import type {
	Bolt11InvoiceCodec,
	Bolt11LegKey,
	Bolt11LegRecord,
	Bolt11LegStore,
	Bolt11Signer,
} from '../../bolt11-wrapper/ts/index'
import { MemorySetStore } from '../../wallet/ts/index'
import type { SetHandle, WitnessVerifier } from '../../wallet/ts/index'
import type { FundsQuote, FundsRefusal } from '../../funds-contract/ts/index'

const INVOICE = 'lnbc1moneytestinvoice'
const HASH = `hash:${INVOICE}`
/** The rail's window, faked: every invoice expires far in the future, so nothing reaches `abandoned`. */
const EXPIRY = 9_999_999_999
const NOW = 1_000_000

/** Every input the codec was asked to decode — so "the leg id is never read as a reference" is provable. */
const codecInputs: string[] = []

/**
 * The invoice codec, faked: it decodes a **genuine invoice** only (`lnbc…`) and refuses anything else, so
 * the leg id (the payment hash, never an `lnbc…` string) is not decodable as a reference. A preimage
 * validates only against the invoice it was minted for.
 */
const codec: Bolt11InvoiceCodec = {
	paymentHash: (bolt11) => {
		codecInputs.push(bolt11)
		if (!bolt11.startsWith('lnbc')) throw new Error(`not an invoice: ${bolt11}`)
		return `hash:${bolt11}`
	},
	validatePreimage: (bolt11, preimage) => preimage === `pre:${bolt11}`,
	expiresAt: () => EXPIRY,
}

/** The browser signer, faked: it returns the validating preimage (a cryptographic settle) or nothing (ack). */
const signerReturning = (preimage?: string): Bolt11Signer => ({
	sendPayment: async () => (preimage === undefined ? {} : { preimage }),
})

/** The leg store that records the keys it was read at, so "the legId was resolved through the store" is provable. */
class RecordingLegStore implements Bolt11LegStore {
	private readonly inner = new MemoryBolt11LegStore()
	readonly gets: Bolt11LegKey[] = []
	async createOrGet(record: Bolt11LegRecord) {
		return this.inner.createOrGet(record)
	}
	async get(key: Bolt11LegKey) {
		this.gets.push(key)
		return this.inner.get(key)
	}
	async list(wrapperId?: string) {
		return this.inner.list(wrapperId)
	}
	async compareAndSet(key: Bolt11LegKey, expectedRevision: number, next: Bolt11LegRecord) {
		return this.inner.compareAndSet(key, expectedRevision, next)
	}
}

/**
 * The composing app's witness check for a bolt11 leg: it re-checks the rail's settled **kind**. See the file
 * comment — the rail's cryptographic witness carries no preimage, so a re-derivation from the set record
 * alone is not writable for this rail.
 */
const appVerifier: WitnessVerifier = {
	verify: (_expectedPaymentHash, witness) => witness.kind === 'preimage' && witness.source === 'webln',
}

const railInputs = (store: Bolt11LegStore, signer: Bolt11Signer): Bolt11CompositionInputs => ({
	wrapperId: 'bolt11',
	store,
	storeKind: 'memory',
	codec,
	signer,
	reconcileDeadlineMs: 60_000,
	ceiling: 1_000_000,
	contractVersion: '0.1',
})

const composedOver = (store: RecordingLegStore, signer: Bolt11Signer) =>
	composeMoney({
		bolt11: railInputs(store, signer),
		store: new MemorySetStore(),
		verifier: appVerifier,
		contractVersion: '0.1',
		toleranceSat: 1,
		now: () => NOW,
	})

const asQuote = (quote: FundsQuote | FundsRefusal): FundsQuote => {
	if ('refused' in quote) throw new Error(`expected a quote, got a refusal: ${quote.reason}`)
	return quote
}

test('the registered rail carries a payment set from pay() to reconcile() to complete', async () => {
	codecInputs.length = 0
	const store = new RecordingLegStore()
	const composed = composedOver(store, signerReturning(`pre:${INVOICE}`))

	// (0) The registration is the real gate's: the rail's declaration was validated and accepted, by id.
	expect(composed.accepted).toEqual(['bolt11'])
	expect(composed.bolt11.registration.method).toBe('bolt11')
	expect(composed.bolt11.registration.port).toBe('funds-contract')

	// (1) The rail's own port, at the composition: obtain writes the durable reference before money moves.
	const quote = asQuote(await composed.bolt11.obtain({ kind: 'webln', amountSat: 1000, bolt11: INVOICE }))
	expect(quote.legId).toBe(HASH)
	expect(quote.reference).toBe(INVOICE)

	// (2) pay() opens the set over the rail's leg, holding the payment hash the rail already wrote.
	const opened = await composed.aggregator.pay({
		orderId: 'order-1',
		totalSat: 1000,
		legs: [
			{
				wrapperId: 'bolt11',
				legId: quote.legId,
				method: 'bolt11',
				frozenShare: 1000,
				expectedPaymentHash: quote.legId,
				authorityKind: quote.authorityKind,
				operations: quote.operations,
				plan: quote.plan,
				reconcileDeadlineMs: 60_000,
			},
		],
	})
	expect(opened.state).toBe('unfinished')

	// (3) The rail's one irreversible step, through the rail's own port.
	const submitted = await composed.bolt11.submit(quote, INVOICE)
	expect(submitted.rung).toBe('witnessed-settled')
	expect(submitted.witness?.kind).toBe('preimage')

	// (4) reconcile(): the aggregator asks the REGISTERED adapter for the leg's handle, keyed on the leg id.
	store.gets.length = 0
	codecInputs.length = 0
	const settled: SetHandle = await composed.aggregator.reconcile(opened.setId)

	// The live `reconcileLeg` call resolved the leg id through the rail's own store, at that exact key.
	expect(store.gets.length).toBeGreaterThanOrEqual(1)
	expect(store.gets[0]).toEqual({ wrapperId: 'bolt11', legId: HASH })
	// …and the payment hash was derived from the STORED invoice: the leg id was never decoded as a reference.
	expect(codecInputs).toContain(INVOICE)
	expect(codecInputs).not.toContain(HASH)
	// The cryptographic witness settled the leg and the set derives complete from what is proven.
	expect(settled.legs[0].rung).toBe('witnessed-settled')
	expect(settled.state).toBe('complete')
	expect(settled.mismatch).toBeUndefined()
})

test('a rail-produced declared witness reaches only attested through the composition, and never completes the set', async () => {
	const store = new RecordingLegStore()
	// The signer acknowledges with no preimage: the rail's own ladder reaches `attested`, never settled.
	const composed = composedOver(store, signerReturning(undefined))

	const quote = asQuote(await composed.bolt11.obtain({ kind: 'webln', amountSat: 1000, bolt11: INVOICE }))
	const opened = await composed.aggregator.pay({
		orderId: 'order-2',
		totalSat: 1000,
		legs: [
			{
				wrapperId: 'bolt11',
				legId: quote.legId,
				method: 'bolt11',
				frozenShare: 1000,
				expectedPaymentHash: quote.legId,
				authorityKind: quote.authorityKind,
				operations: quote.operations,
				plan: quote.plan,
				reconcileDeadlineMs: 60_000,
			},
		],
	})
	const acknowledged = await composed.bolt11.submit(quote, INVOICE)
	expect(acknowledged.rung).toBe('attested')
	expect(acknowledged.witness?.kind).toBe('ack')

	const reconciled = await composed.aggregator.reconcile(opened.setId)
	expect(reconciled.legs[0].rung).toBe('attested')
	expect(reconciled.legs[0].rung).not.toBe('witnessed-settled')
	expect(reconciled.state).toBe('unfinished')
})

test('a leg id the rail store does not carry fails closed through the seam, and settles nothing', async () => {
	codecInputs.length = 0
	const store = new RecordingLegStore()
	const composed = composedOver(store, signerReturning(`pre:${INVOICE}`))

	const opened = await composed.aggregator.pay({
		orderId: 'order-3',
		totalSat: 1000,
		legs: [
			{
				wrapperId: 'bolt11',
				legId: 'hash:absent',
				method: 'bolt11',
				frozenShare: 1000,
				expectedPaymentHash: 'hash:absent',
				authorityKind: 'remote-and-observable',
				operations: ['obtain', 'submit', 'reconcile'],
				plan: ['obtain', 'submit', 'reconcile'],
				reconcileDeadlineMs: 60_000,
			},
		],
	})
	const reconciled = await composed.aggregator.reconcile(opened.setId)

	// The seam refused the unknown leg, the aggregator recorded no settlement, and the set stays unfinished.
	expect(store.gets[0]).toEqual({ wrapperId: 'bolt11', legId: 'hash:absent' })
	expect(codecInputs).not.toContain('hash:absent')
	expect(reconciled.legs[0].rung).toBe('unresolved')
	expect(reconciled.state).toBe('unfinished')
})
