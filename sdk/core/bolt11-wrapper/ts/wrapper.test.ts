/**
 * bolt11-wrapper/ts/wrapper.test.ts — the port's conformance suite.
 *
 * Test support, out of contract: it mints no statement. Every library call is a fake, the store is the
 * in-memory test store, and no network is touched, so the port is driven with no live node, mint or
 * network. The suite also carries the negative cases the contract implies — a leg that must not settle on
 * a declared witness, a look-up that cannot conclude and must not submit, and a reference written before
 * the boundary.
 */
import { expect, test } from 'bun:test'
import { Bolt11Wrapper, Bolt11WrapperError, MemoryBolt11LegStore } from './index'
import type {
	Bolt11InvoiceCodec,
	Bolt11LegKind,
	Bolt11LegKey,
	Bolt11LegRecord,
	Bolt11LegStore,
	Bolt11LnurlRequester,
	Bolt11LnurlVerifier,
	Bolt11Signer,
} from './index'
import type { FundsQuote, FundsRefusal, FundsStep } from '../../funds-contract/ts/index'

const invoice = 'lnbc1exampleinvoice'
const paymentHash = `hash:${invoice}`
const validPreimage = `pre:${invoice}`
/** The rail's window, faked: every invoice expires at this absolute instant. */
const EXPIRY = 1_500_000

/**
 * The codec, faked: a payment hash is `hash:<bolt11>`; a preimage is valid iff it is `pre:<bolt11>`; and
 * every invoice expires at `EXPIRY`.
 */
const codec: Bolt11InvoiceCodec = {
	paymentHash: (bolt11) => `hash:${bolt11}`,
	validatePreimage: (bolt11, preimage) => preimage === `pre:${bolt11}`,
	expiresAt: () => EXPIRY,
}

/** A store that records the order of its mutating calls, so "reference before the boundary" is provable. */
class RecordingStore implements Bolt11LegStore {
	private readonly inner = new MemoryBolt11LegStore()
	constructor(private readonly events: string[]) {}
	async createOrGet(record: Bolt11LegRecord) {
		this.events.push('store.createOrGet')
		return this.inner.createOrGet(record)
	}
	async get(key: Bolt11LegKey) {
		return this.inner.get(key)
	}
	async list(wrapperId?: string) {
		return this.inner.list(wrapperId)
	}
	async compareAndSet(key: Bolt11LegKey, expectedRevision: number, next: Bolt11LegRecord) {
		this.events.push('store.compareAndSet')
		return this.inner.compareAndSet(key, expectedRevision, next)
	}
}

class FakeSigner implements Bolt11Signer {
	calls = 0
	constructor(
		private readonly events: string[],
		private readonly result: { preimage?: string },
	) {}
	async sendPayment(): Promise<{ preimage?: string }> {
		this.calls += 1
		this.events.push('signer.sendPayment')
		return this.result
	}
}

class FakeRequester implements Bolt11LnurlRequester {
	calls = 0
	constructor(private readonly response: { bolt11: string; verifyUrl?: string | null }) {}
	async requestInvoice(): Promise<{ bolt11: string; verifyUrl?: string | null }> {
		this.calls += 1
		return this.response
	}
}

class FakeVerifier implements Bolt11LnurlVerifier {
	calls = 0
	constructor(public answer: { ok: true; settled: boolean; preimage?: string } | { ok: false }) {}
	async verify(): Promise<{ ok: true; settled: boolean; preimage?: string } | { ok: false }> {
		this.calls += 1
		return this.answer
	}
}

const asQuote = (quote: FundsQuote | FundsRefusal): FundsQuote => {
	if ('refused' in quote) throw new Error('expected a quote, got a refusal')
	return quote
}

const baseOptions = (store: Bolt11LegStore) => ({
	wrapperId: 'w',
	store,
	storeKind: 'memory',
	codec,
	reconcileDeadlineMs: 60_000,
	ceiling: 1_000_000,
	contractVersion: '0.1',
	now: () => 1_000_000,
})

test('obtain writes the leg with its durable reference before the signer is asked to pay', async () => {
	const events: string[] = []
	const store = new RecordingStore(events)
	const signer = new FakeSigner(events, { preimage: validPreimage })
	const wrapper = new Bolt11Wrapper({ ...baseOptions(store), signer })

	const quote = asQuote(await wrapper.obtain({ kind: 'webln', amountSat: 1000, bolt11: invoice }))
	const stored = await store.get({ wrapperId: 'w', legId: quote.legId })
	expect(stored?.bolt11).toBe(invoice)
	expect(stored?.paymentHash).toBe(paymentHash)

	await wrapper.submit(quote, quote.reference)

	// the reference landed before the irreversible step, and the step did happen
	expect(events).toContain('store.createOrGet')
	expect(events).toContain('signer.sendPayment')
	expect(events.indexOf('store.createOrGet')).toBeLessThan(events.indexOf('signer.sendPayment'))
})

test('the browser-signer leg settles on a preimage validated against the payment hash', async () => {
	const events: string[] = []
	const wrapper = new Bolt11Wrapper({ ...baseOptions(new RecordingStore(events)), signer: new FakeSigner(events, { preimage: validPreimage }) })
	const quote = asQuote(await wrapper.obtain({ kind: 'webln', amountSat: 1000, bolt11: invoice }))
	const handle = await wrapper.submit(quote, quote.reference)
	expect(handle.rung).toBe('witnessed-settled')
	expect(handle.witness?.kind).toBe('preimage')
	expect(handle.unwitnessed).toBe(false)
})

test('a bare acknowledgement does not settle the browser-signer leg', async () => {
	const events: string[] = []
	const wrapper = new Bolt11Wrapper({ ...baseOptions(new RecordingStore(events)), signer: new FakeSigner(events, {}) })
	const quote = asQuote(await wrapper.obtain({ kind: 'webln', amountSat: 1000, bolt11: invoice }))
	const handle = await wrapper.submit(quote, quote.reference)
	expect(handle.rung).not.toBe('witnessed-settled')
	expect(handle.rung).toBe('attested')
	expect(handle.witness?.kind).toBe('ack')
})

test('the manual-preimage leg settles on the buyer-supplied preimage', async () => {
	const events: string[] = []
	const wrapper = new Bolt11Wrapper(baseOptions(new RecordingStore(events)))
	const quote = asQuote(await wrapper.obtain({ kind: 'manual-preimage', amountSat: 1000, bolt11: invoice }))
	const handle = await wrapper.submit(quote, validPreimage)
	expect(handle.rung).toBe('witnessed-settled')
	expect(handle.witness?.kind).toBe('preimage')
	expect(handle.witness?.source).toBe('manual')
})

test('the manual leg does not settle on a preimage that does not validate', async () => {
	const events: string[] = []
	const wrapper = new Bolt11Wrapper(baseOptions(new RecordingStore(events)))
	const quote = asQuote(await wrapper.obtain({ kind: 'manual-preimage', amountSat: 1000, bolt11: invoice }))
	const handle = await wrapper.submit(quote, 'not-the-preimage')
	expect(handle.rung).toBe('unresolved')
	expect(handle.unwitnessed).toBe(true)
	expect(handle.witness).toBeUndefined()
})

test('reconcile never submits and is idempotent', async () => {
	const events: string[] = []
	const store = new RecordingStore(events)
	const signer = new FakeSigner(events, { preimage: validPreimage })
	const verifier = new FakeVerifier({ ok: true, settled: true, preimage: validPreimage })
	const wrapper = new Bolt11Wrapper({ ...baseOptions(store), signer, lnurlVerifier: verifier })
	const quote = asQuote(await wrapper.obtain({ kind: 'webln', amountSat: 1000, bolt11: invoice, verifyUrl: 'https://seller/verify' }))

	const first = await wrapper.reconcile(quote.reference)
	const second = await wrapper.reconcile(quote.reference)

	expect(first.rung).toBe('witnessed-settled')
	expect(second.rung).toBe('witnessed-settled')
	// the second reconcile is a write-once read: it does not re-ask the authority
	expect(verifier.calls).toBe(1)
	// reconcile submitted nothing, ever
	expect(signer.calls).toBe(0)
})

test('a look-up that cannot conclude leaves the leg blocked and does not submit', async () => {
	const events: string[] = []
	const store = new RecordingStore(events)
	const signer = new FakeSigner(events, { preimage: validPreimage })
	const verifier = new FakeVerifier({ ok: false })
	const wrapper = new Bolt11Wrapper({ ...baseOptions(store), signer, lnurlVerifier: verifier })
	const quote = asQuote(await wrapper.obtain({ kind: 'webln', amountSat: 1000, bolt11: invoice, verifyUrl: 'https://seller/verify' }))

	const handle = await wrapper.reconcile(quote.reference)

	expect(handle.rung).toBe('unresolved')
	expect(handle.unwitnessed).toBe(true)
	expect(signer.calls).toBe(0)
})

test('a declared LNURL verification reaches only attested, never settled', async () => {
	const events: string[] = []
	const verifier = new FakeVerifier({ ok: true, settled: true })
	const wrapper = new Bolt11Wrapper({ ...baseOptions(new RecordingStore(events)), lnurlVerifier: verifier })
	const quote = asQuote(await wrapper.obtain({ kind: 'broadcast-quote', amountSat: 500, bolt11: invoice, verifyUrl: 'https://seller/verify' }))
	const handle = await wrapper.reconcile(quote.reference)
	expect(handle.rung).toBe('attested')
	expect(handle.rung).not.toBe('witnessed-settled')
	expect(handle.witness?.kind).toBe('lnurl_verify')
})

test('a cryptographic LNURL verification settles the leg', async () => {
	const events: string[] = []
	const verifier = new FakeVerifier({ ok: true, settled: true, preimage: validPreimage })
	const wrapper = new Bolt11Wrapper({ ...baseOptions(new RecordingStore(events)), lnurlVerifier: verifier })
	const quote = asQuote(await wrapper.obtain({ kind: 'lnurl-request', amountSat: 500, bolt11: invoice, verifyUrl: 'https://seller/verify' }))
	const handle = await wrapper.reconcile(quote.reference)
	expect(handle.rung).toBe('witnessed-settled')
	expect(handle.witness?.kind).toBe('preimage')
})

test('the LNURL-request leg obtains its invoice from the injected requester and keeps the verify URL', async () => {
	const events: string[] = []
	const store = new RecordingStore(events)
	const requester = new FakeRequester({ bolt11: invoice, verifyUrl: 'https://seller/verify' })
	const wrapper = new Bolt11Wrapper({ ...baseOptions(store), lnurlRequester: requester })
	const quote = asQuote(await wrapper.obtain({ kind: 'lnurl-request', amountSat: 500, lnurl: 'seller@host' }))
	const stored = await store.get({ wrapperId: 'w', legId: quote.legId })
	expect(requester.calls).toBe(1)
	expect(stored?.verifyUrl).toBe('https://seller/verify')
	expect(stored?.bolt11).toBe(invoice)
})

test('the passive broadcast-quote leg declares no submit, and submit fails closed', async () => {
	const events: string[] = []
	const wrapper = new Bolt11Wrapper(baseOptions(new RecordingStore(events)))
	expect(wrapper.operationsFor('broadcast-quote')).toEqual(['obtain', 'reconcile'])
	expect(wrapper.operationsFor('broadcast-quote')).not.toContain('submit')
	const quote = asQuote(await wrapper.obtain({ kind: 'broadcast-quote', amountSat: 500, bolt11: invoice }))

	let code = ''
	try {
		await wrapper.submit(quote, quote.reference)
	} catch (error) {
		code = (error as Bolt11WrapperError).code
	}
	expect(code).toBe('bolt11_operation_absent')
})

test('the reconcile deadline is absolute and computed from the injected clock', async () => {
	const events: string[] = []
	const store = new RecordingStore(events)
	const wrapper = new Bolt11Wrapper({ ...baseOptions(store), now: () => 1_000_000 })
	const quote = asQuote(await wrapper.obtain({ kind: 'manual-preimage', amountSat: 1000, bolt11: invoice }))
	const stored = await store.get({ wrapperId: 'w', legId: quote.legId })
	expect(stored?.reconcileDeadlineAt).toBe(1_060_000)
})

test('each leg declares its operations as the ordered projection of the port canonical order', () => {
	const events: string[] = []
	const wrapper = new Bolt11Wrapper(baseOptions(new RecordingStore(events)))
	const kinds: Bolt11LegKind[] = ['webln', 'broadcast-quote', 'manual-preimage', 'lnurl-request']
	const canonical: FundsStep[] = ['obtain', 'submit', 'reconcile']
	for (const kind of kinds) {
		const operations = wrapper.operationsFor(kind)
		const projected = canonical.filter((step) => (operations as readonly string[]).includes(step))
		expect([...wrapper.planFor(kind)]).toEqual(projected)
	}
	expect(wrapper.registration.operations).toEqual(['obtain', 'submit', 'reconcile'])
	expect(wrapper.registration.plan).toEqual(['obtain', 'submit', 'reconcile'])
	expect(wrapper.registration.authorityKind).toBe('remote-and-observable')
})

// --- the non-settlement terminal, and the LNURL verify path's own evidence ---

/** Options whose clock reads past `EXPIRY`: the invoice's window has elapsed. */
const expiredOptions = (store: Bolt11LegStore) => ({ ...baseOptions(store), now: () => 2_000_000 })

test('an expired unwitnessed leg reaches the non-settlement terminal abandoned', async () => {
	const events: string[] = []
	const verifier = new FakeVerifier({ ok: true, settled: false })
	const wrapper = new Bolt11Wrapper({ ...expiredOptions(new RecordingStore(events)), lnurlVerifier: verifier })
	const quote = asQuote(
		await wrapper.obtain({ kind: 'lnurl-request', amountSat: 500, bolt11: invoice, verifyUrl: 'https://seller/verify' }),
	)
	const handle = await wrapper.reconcile(quote.reference)
	expect(handle.rung).toBe('abandoned')
	expect(handle.rung).not.toBe('witnessed-settled')
	// the terminal is not a settlement: no witness closes the leg and it stays unwitnessed
	expect(handle.unwitnessed).toBe(true)
	expect(handle.witness).toBeUndefined()
})

test('the terminal is not reachable while a witness may still arrive', async () => {
	const events: string[] = []
	let clock = 1_200_000
	const verifier = new FakeVerifier({ ok: true, settled: false })
	const wrapper = new Bolt11Wrapper({ ...baseOptions(new RecordingStore(events)), lnurlVerifier: verifier, now: () => clock })
	const quote = asQuote(
		await wrapper.obtain({ kind: 'lnurl-request', amountSat: 500, bolt11: invoice, verifyUrl: 'https://seller/verify' }),
	)
	// the invoice is unexpired (EXPIRY is 1_500_000), and 1_300_000 is PAST the 1_260_000 reconcile wait
	// bound: the wait bound is not the window, so a witness may still arrive and the leg stays unresolved.
	clock = 1_300_000
	const handle = await wrapper.reconcile(quote.reference)
	expect(handle.rung).toBe('unresolved')
	expect(handle.rung).not.toBe('abandoned')
})

test('a settled LNURL answer with a validating preimage settles by preimage', async () => {
	const events: string[] = []
	const verifier = new FakeVerifier({ ok: true, settled: true, preimage: validPreimage })
	const wrapper = new Bolt11Wrapper({ ...baseOptions(new RecordingStore(events)), lnurlVerifier: verifier })
	const quote = asQuote(
		await wrapper.obtain({ kind: 'lnurl-request', amountSat: 500, bolt11: invoice, verifyUrl: 'https://seller/verify' }),
	)
	const handle = await wrapper.reconcile(quote.reference)
	expect(handle.rung).toBe('witnessed-settled')
	expect(handle.witness?.kind).toBe('preimage')
	expect(handle.unwitnessed).toBe(false)
})

test('a settled LNURL answer without a preimage does not settle', async () => {
	const events: string[] = []
	const verifier = new FakeVerifier({ ok: true, settled: true })
	const wrapper = new Bolt11Wrapper({ ...baseOptions(new RecordingStore(events)), lnurlVerifier: verifier })
	const quote = asQuote(
		await wrapper.obtain({ kind: 'lnurl-request', amountSat: 500, bolt11: invoice, verifyUrl: 'https://seller/verify' }),
	)
	const handle = await wrapper.reconcile(quote.reference)
	expect(handle.rung).toBe('attested')
	expect(handle.rung).not.toBe('witnessed-settled')
	expect(handle.witness?.kind).toBe('lnurl_verify')
})

test('a failed verify does not negative-settle', async () => {
	const events: string[] = []
	// (a) unexpired: a failed look-up is not a conclusion — the leg stays open.
	const openVerifier = new FakeVerifier({ ok: false })
	const openWrapper = new Bolt11Wrapper({ ...baseOptions(new RecordingStore(events)), lnurlVerifier: openVerifier })
	const openQuote = asQuote(
		await openWrapper.obtain({ kind: 'lnurl-request', amountSat: 500, bolt11: invoice, verifyUrl: 'https://seller/verify' }),
	)
	const openHandle = await openWrapper.reconcile(openQuote.reference)
	expect(openHandle.rung).toBe('unresolved')
	expect(openHandle.rung).not.toBe('witnessed-settled')
	// (b) even with the invoice expired, a FAILED look-up stays open: a witness may still be reported, so
	// it reaches neither a settlement nor the non-settlement terminal.
	const failedVerifier = new FakeVerifier({ ok: false })
	const failedWrapper = new Bolt11Wrapper({ ...expiredOptions(new RecordingStore(events)), lnurlVerifier: failedVerifier })
	const failedQuote = asQuote(
		await failedWrapper.obtain({ kind: 'lnurl-request', amountSat: 500, bolt11: invoice, verifyUrl: 'https://seller/verify' }),
	)
	const failedHandle = await failedWrapper.reconcile(failedQuote.reference)
	expect(failedHandle.rung).toBe('unresolved')
	expect(failedHandle.rung).not.toBe('witnessed-settled')
	expect(failedHandle.rung).not.toBe('abandoned')
})

test('no expiry alone can ever produce a settled rung', async () => {
	const events: string[] = []
	// an expired leg with nothing to ask reaches the terminal — never a settlement.
	const wrapper = new Bolt11Wrapper(expiredOptions(new RecordingStore(events)))
	const quote = asQuote(await wrapper.obtain({ kind: 'broadcast-quote', amountSat: 500, bolt11: invoice }))
	const handle = await wrapper.reconcile(quote.reference)
	expect(handle.rung).toBe('abandoned')
	expect(handle.rung).not.toBe('witnessed-settled')
	expect(handle.unwitnessed).toBe(true)
	// and the terminal is not reversible: a second reconcile is still abandoned, never settled.
	const again = await wrapper.reconcile(quote.reference)
	expect(again.rung).toBe('abandoned')
	expect(again.rung).not.toBe('witnessed-settled')
})

test('the plain passive leg declares a reconcile but has nothing to ask', async () => {
	const events: string[] = []
	const verifier = new FakeVerifier({ ok: true, settled: true, preimage: validPreimage })
	const wrapper = new Bolt11Wrapper({ ...baseOptions(new RecordingStore(events)), lnurlVerifier: verifier })
	expect(wrapper.operationsFor('broadcast-quote')).toContain('reconcile')
	const quote = asQuote(await wrapper.obtain({ kind: 'broadcast-quote', amountSat: 500, bolt11: invoice }))
	// unexpired and with no verification reference to ask: the reconcile cannot conclude — its honest limit.
	const handle = await wrapper.reconcile(quote.reference)
	expect(handle.rung).toBe('unresolved')
	expect(handle.unwitnessed).toBe(true)
	expect(verifier.calls).toBe(0)
})

test('verifyUrl is persisted from the caller and from the LNURL response', async () => {
	const events: string[] = []
	const store = new RecordingStore(events)
	// (a) from the caller, when the app supplies the invoice directly.
	const wrapper = new Bolt11Wrapper(baseOptions(store))
	const fromCaller = asQuote(
		await wrapper.obtain({ kind: 'broadcast-quote', amountSat: 500, bolt11: invoice, verifyUrl: 'https://caller/verify' }),
	)
	expect((await store.get({ wrapperId: 'w', legId: fromCaller.legId }))?.verifyUrl).toBe('https://caller/verify')
	// (b) from the LNURL response, when the app requests the invoice from the endpoint.
	const requester = new FakeRequester({ bolt11: `${invoice}-two`, verifyUrl: 'https://seller/verify' })
	const wrapper2 = new Bolt11Wrapper({ ...baseOptions(store), lnurlRequester: requester })
	const fromResponse = asQuote(await wrapper2.obtain({ kind: 'lnurl-request', amountSat: 500, lnurl: 'seller@host' }))
	expect((await store.get({ wrapperId: 'w', legId: fromResponse.legId }))?.verifyUrl).toBe('https://seller/verify')
})

test('the terminal is not reachable for a leg that already carries a declared witness', async () => {
	const events: string[] = []
	let clock = 1_400_000
	const verifier = new FakeVerifier({ ok: true, settled: true })
	const wrapper = new Bolt11Wrapper({ ...baseOptions(new RecordingStore(events)), lnurlVerifier: verifier, now: () => clock })
	const quote = asQuote(
		await wrapper.obtain({ kind: 'lnurl-request', amountSat: 500, bolt11: invoice, verifyUrl: 'https://seller/verify' }),
	)
	// first reconcile: a settled answer without a preimage records the DECLARED lnurl_verify witness.
	expect((await wrapper.reconcile(quote.reference)).rung).toBe('attested')
	// now the invoice expires and a later answer is "not settled": the leg already carries a witness, so it
	// is NOT unwitnessed and the terminal is unreachable — it stays attested, never abandoned.
	clock = 2_000_000
	verifier.answer = { ok: true, settled: false }
	const after = await wrapper.reconcile(quote.reference)
	expect(after.rung).toBe('attested')
	expect(after.rung).not.toBe('abandoned')
})
