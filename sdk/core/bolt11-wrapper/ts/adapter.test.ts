/**
 * bolt11-wrapper/ts/adapter.test.ts — the adapter's own conformance suite.
 *
 * Test support, out of contract: it mints no statement. It proves the seam the adapter exists to repair —
 * that `reconcileLeg(legId)` resolves a **leg id** through the rail's own leg store to the payment hash,
 * and never treats its argument as a raw reference — and it exhibits the adapter's structural parity with
 * the aggregator's two-member seam and the contract's port. Every library call is a fake; no network is
 * touched.
 */
import { expect, test } from 'bun:test'
import { Bolt11Adapter, Bolt11WrapperError, MemoryBolt11LegStore } from './index'
import type {
	Bolt11InvoiceCodec,
	Bolt11LegCommand,
	Bolt11LegKey,
	Bolt11LegRecord,
	Bolt11LegStore,
	Bolt11Signer,
} from './index'
import type {
	FundsHandle,
	FundsQuote,
	FundsRefusal,
	WrapperRegistration,
} from '../../funds-contract/ts/index'

const INVOICE = 'lnbc1adapterinvoice'
const hashOf = (bolt11: string): string => `hash:${bolt11}`
/** The rail's window, faked: every invoice expires at this absolute instant. */
const EXPIRY = 1_500_000

/** Every input the codec was asked to decode, so "the reference is the STORED invoice" is provable. */
const codecInputs: string[] = []

/**
 * The codec, faked: it decodes a **genuine invoice** only — `lnbc…` — and refuses anything else. So the
 * leg id itself (which is the payment hash, never an `lnbc…` string) is NOT decodable as a reference, and
 * a `reconcile` handed the leg id fails closed instead of resolving.
 */
const codec: Bolt11InvoiceCodec = {
	paymentHash: (bolt11) => {
		codecInputs.push(bolt11)
		if (!bolt11.startsWith('lnbc')) throw new Error(`not an invoice: ${bolt11}`)
		return hashOf(bolt11)
	},
	validatePreimage: (bolt11, preimage) => preimage === `pre:${bolt11}`,
	expiresAt: () => EXPIRY,
}

/** A store that records the keys it was read at, so "the legId was resolved through the store" is provable. */
class RecordingStore implements Bolt11LegStore {
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

const signer: Bolt11Signer = { sendPayment: async () => ({ preimage: `pre:${INVOICE}` }) }

const adapterOver = (store: Bolt11LegStore): Bolt11Adapter =>
	new Bolt11Adapter({
		wrapperId: 'w',
		store,
		storeKind: 'memory',
		codec,
		signer,
		reconcileDeadlineMs: 60_000,
		ceiling: 1_000_000,
		contractVersion: '0.1',
		now: () => 1_000_000,
	})

const asQuote = (quote: FundsQuote | FundsRefusal): FundsQuote => {
	if ('refused' in quote) throw new Error('expected a quote, got a refusal')
	return quote
}

/**
 * THE NEW TEST. The seam hands a **leg id**; the rail's own `reconcile(reference)` decodes its argument as
 * an invoice. `reconcileLeg(legId)` must therefore resolve the leg id through the rail's own leg store to
 * the stored invoice, derive the payment hash from THAT, and only then reconcile — the argument is never
 * read as a raw reference.
 *
 * RED MUTATION: replace the body of `reconcileLeg` with `return this.wrapper.reconcile(legId)` — i.e. hand
 * the seam's argument straight to the rail's own reconcile. Then the rail decodes the LEG ID as if it were
 * an invoice; the codec refuses it (a leg id is not `lnbc…`), no store read happens at the leg-id key, and
 * `wrapper.reconcile` rejects with `bolt11_leg_unknown`. The test goes RED on the `handle.legId`
 * assertion (it never resolves). A weaker mutation — resolving the leg but returning a handle with no
 * store read (`{...record}-shaped` handle built without `store.get`) — goes RED on the `store.gets`
 * assertion. Both are covered here.
 */
test('reconcileLeg(legId) resolves the legId through the store to the payment hash, never as a raw reference', async () => {
	codecInputs.length = 0
	const store = new RecordingStore()
	const adapter = adapterOver(store)

	const quote = asQuote(await adapter.obtain({ kind: 'webln', amountSat: 21, bolt11: INVOICE }))
	const legId = quote.legId
	// The leg id is the payment hash the rail stored the leg under — and it is not itself an invoice.
	expect(legId).toBe(hashOf(INVOICE))

	store.gets.length = 0
	codecInputs.length = 0

	const handle = await adapter.reconcileLeg(legId)

	// (1) It RESOLVED: a leg id reached the seam and a handle for that same leg came back.
	expect(handle.legId).toBe(legId)
	expect(handle.rung).toBe('unresolved')
	// (2) It resolved THROUGH THE STORE, at the exact leg-id key the seam handed it — the first read is the
	//     leg-id resolution, before any reference is decoded.
	expect(store.gets.length).toBeGreaterThanOrEqual(1)
	expect(store.gets[0]).toEqual({ wrapperId: 'w', legId })
	// (3) The payment hash was derived from the STORED invoice, never from the argument.
	expect(codecInputs).toContain(INVOICE)
	expect(codecInputs).not.toContain(legId)
})

test('reconcileLeg refuses a legId the store does not carry, rather than decoding it as a reference', async () => {
	const store = new RecordingStore()
	const adapter = adapterOver(store)
	let thrown: unknown
	try {
		await adapter.reconcileLeg('hash:no-such-leg')
	} catch (error) {
		thrown = error
	}
	expect(thrown).toBeInstanceOf(Bolt11WrapperError)
	expect((thrown as Bolt11WrapperError).code).toBe('bolt11_leg_unknown')
	// The unknown leg id was looked up in the store, never decoded by the codec.
	expect(store.gets[0]).toEqual({ wrapperId: 'w', legId: 'hash:no-such-leg' })
	expect(codecInputs).not.toContain('hash:no-such-leg')
})

test('the adapter satisfies the aggregator seam and the contract port structurally', () => {
	const adapter = adapterOver(new RecordingStore())

	// The aggregator's seam: {registration, reconcileLeg(legId)} — the wallet's own shape, named no rail
	// here (the rail must not import the wallet).
	const asSeam: {
		readonly registration: WrapperRegistration
		reconcileLeg(legId: string): Promise<FundsHandle>
	} = adapter
	// The contract's port: the same three verbs the contract's `FundsPort<Command>` fixes.
	const asPort: {
		obtain(command: Bolt11LegCommand): Promise<FundsQuote | FundsRefusal>
		submit(quote: FundsQuote, reference: string): Promise<FundsHandle>
		reconcile(reference: string): Promise<FundsHandle>
	} = adapter

	expect(asSeam).toBe(adapter)
	expect(asPort).toBe(adapter)
	expect(typeof adapter.reconcileLeg).toBe('function')
	expect(adapter.registration.port).toBe('funds-contract')
	expect(adapter.registration.method).toBe('bolt11')
})
