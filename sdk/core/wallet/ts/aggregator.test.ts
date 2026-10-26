/**
 * wallet/ts/aggregator.test.ts — the aggregator's conformance suite.
 *
 * Test support, out of contract: it mints no statement. Every wrapper is a fake injected port and the store
 * is the in-memory test store, so the aggregator is driven with no live node, mint or wallet. The suite
 * carries the negative cases the design implies — a set that must not complete while a leg is untrusted, a
 * declared witness that must not settle, time that must not settle, a wrapper refused for no reconciliation,
 * and a second refund set that must be refused.
 */
import { expect, test } from 'bun:test'
import { FundsDuplicateRefundError, FundsRegistrationError, MemorySetStore, PayAggregator, deriveSetState } from './index'
import type { AggregatorOptions, AggregatorWrapper, LegEntry, LegIntent, SetIntent } from './index'
import type { FundsHandle, WrapperRegistration } from '../../funds-contract/ts/index'

/** The injected self-contained witness check: only a `ok:<hash>` reference validates against the hash. */
const verifier = { verify: (hash: string, witness: { reference?: string }) => witness.reference === `ok:${hash}` }

const registration = (over: Partial<WrapperRegistration> = {}): WrapperRegistration =>
	({
		wrapperId: 'rail-a',
		method: 'm-a',
		port: 'funds-contract',
		authorityKind: 'remote-and-observable',
		operations: ['obtain', 'submit', 'reconcile'],
		plan: ['obtain', 'submit', 'reconcile'],
		store: 'leg-store',
		storeKind: 'memory',
		witnessKinds: ['preimage'],
		reconcileDeadlineMs: 60_000,
		journalReference: { shape: 'invoice+hash', writtenBefore: 'submit' },
		ceiling: 1_000_000,
		contractVersion: '0.1',
		...over,
	}) as WrapperRegistration

class FakeWrapper implements AggregatorWrapper {
	constructor(
		readonly registration: WrapperRegistration,
		private readonly answers: Record<string, FundsHandle>,
	) {}
	async reconcileLeg(legId: string): Promise<FundsHandle> {
		const answer = this.answers[legId]
		if (!answer) throw new Error('no answer')
		return answer
	}
}

const wrapperFor = (answers: Record<string, FundsHandle>, over: Partial<WrapperRegistration> = {}) =>
	new FakeWrapper(registration(over), answers)

const options = (wrappers: readonly AggregatorWrapper[], over: Partial<AggregatorOptions> = {}): AggregatorOptions => ({
	store: new MemorySetStore(),
	verifier,
	contractVersion: '0.1',
	toleranceSat: 2,
	wrappers,
	now: () => 1_000_000,
	...over,
})

const legIntent = (over: Partial<LegIntent> = {}): LegIntent => ({
	wrapperId: 'rail-a',
	legId: 'leg-1',
	method: 'm-a',
	frozenShare: 1000,
	expectedPaymentHash: 'h1',
	authorityKind: 'remote-and-observable',
	operations: ['obtain', 'submit', 'reconcile'],
	plan: ['obtain', 'submit', 'reconcile'],
	reconcileDeadlineMs: 60_000,
	...over,
})

const settled = (over: Partial<LegEntry> = {}): LegEntry =>
	({
		wrapperId: 'rail-a',
		legId: 'leg-1',
		method: 'm-a',
		authorityKind: 'remote-and-observable',
		expectedPaymentHash: 'h1',
		frozenShare: 100,
		operations: ['obtain', 'submit', 'reconcile'],
		plan: ['obtain', 'submit', 'reconcile'],
		rung: 'witnessed-settled',
		observedAmountSat: 100,
		untrusted: false,
		...over,
	}) as LegEntry

const handle = (over: Partial<FundsHandle> = {}): FundsHandle =>
	({ wrapperId: 'rail-a', legId: 'leg-1', progress: 'submitted', rung: 'unresolved', unwitnessed: true, ...over }) as FundsHandle

// ── the conservation rule, as a pure derivation ────────────────────────────────────────────────────────────

test('a set cannot be complete while one of its legs is untrusted', () => {
	const legs = [settled({ legId: 'a' }), settled({ legId: 'b' }), settled({ legId: 'c', untrusted: true })]
	// every leg reports itself settled and each within its band, yet the untrusted leg is excluded entirely
	const state = deriveSetState(legs, 300, 2)
	expect(state).not.toBe('complete')
	expect(state).toBe('unfinished')
})

test('a fully settled set inside the aggregate band is complete', () => {
	// three legs, each within its per-leg tolerance of 2, residual +1, aggregate band 3 x 2 = 6
	const legs = [
		settled({ legId: 'a', observedAmountSat: 100 }),
		settled({ legId: 'b', observedAmountSat: 100 }),
		settled({ legId: 'c', observedAmountSat: 101 }),
	]
	expect(deriveSetState(legs, 300, 2)).toBe('complete')
})

test('a beyond-band fully-settled set takes the direction its sign implies, never abandoned', () => {
	const short = [settled({ legId: 'a', observedAmountSat: 95 }), settled({ legId: 'b', observedAmountSat: 100 })]
	const over = [settled({ legId: 'a', observedAmountSat: 105 }), settled({ legId: 'b', observedAmountSat: 100 })]
	// residual -5 and +5, beyond the aggregate band of 2 x 2 = 4
	const shortState = deriveSetState(short, 200, 2)
	const overState = deriveSetState(over, 200, 2)
	expect(shortState).toBe('short-settled')
	expect(overState).toBe('over-settled')
	expect(shortState).not.toBe('abandoned')
	expect(overState).not.toBe('abandoned')
})

// ── the acceptance gate ────────────────────────────────────────────────────────────────────────────────────

test('a wrapper with no reconciliation in its plan is refused', () => {
	const bad = wrapperFor({}, { plan: ['obtain', 'submit'] })
	let error: FundsRegistrationError | undefined
	try {
		new PayAggregator(options([bad]))
	} catch (thrown) {
		error = thrown as FundsRegistrationError
	}
	expect(error).toBeInstanceOf(FundsRegistrationError)
	expect(error?.field).toBe('plan')
	expect(error?.reason).toBe('no-reconcile-step')
	// positive control: the same wrapper with reconcile in the plan registers cleanly
	const good = new PayAggregator(options([wrapperFor({})]))
	expect(good.accepted()).toEqual(['rail-a'])
})

test('the gate accepts a declaration with witness kinds the wrapper may never produce', () => {
	// the gate checks the shape of the declaration, never its conduct: a well-formed list that oversells is
	// accepted, and whether such a witness is ever produced is the conformance suite's question, not the gate's
	const wrapper = wrapperFor({}, { witnessKinds: ['preimage', 'zap_receipt'] })
	const aggregator = new PayAggregator(options([wrapper]))
	expect(aggregator.accepted()).toEqual(['rail-a'])
})

test('the refusal names the field and never echoes the offending value', () => {
	const sentinel = 'SENTINEL'
	const bad = wrapperFor({}, { wrapperId: `bad${sentinel}\u0000` })
	let error: FundsRegistrationError | undefined
	try {
		new PayAggregator(options([bad]))
	} catch (thrown) {
		error = thrown as FundsRegistrationError
	}
	expect(error).toBeInstanceOf(FundsRegistrationError)
	expect(error?.message).toContain('wrapperId')
	expect(error?.message).not.toContain(sentinel)
	expect(error?.field).toBe('wrapperId')
	expect(error?.reason).toBe('control-character')
})

// ── the watcher: time never settles, a declared witness never settles ───────────────────────────────────────

test('time alone never settles a leg, and reaches the non-settlement terminal by rule', async () => {
	let clock = 1_000_000
	const wrapper = wrapperFor({ 'leg-1': handle({ rung: 'unresolved', unwitnessed: true }) })
	const aggregator = new PayAggregator(options([wrapper], { now: () => clock }))
	const intent: SetIntent = { orderId: 'order-1', totalSat: 1000, legs: [legIntent()] }
	const opened = await aggregator.pay(intent)

	// within the deadline: the leg stays unresolved, the set unfinished, nothing settled
	const within = await aggregator.reconcile(opened.setId)
	expect(within.legs[0].rung).toBe('unresolved')
	expect(within.state).toBe('unfinished')

	// past the deadline with no witness: the leg reaches the non-settlement terminal, never settled
	clock = 1_100_000
	const late = await aggregator.reconcile(opened.setId)
	expect(late.legs[0].rung).toBe('abandoned')
	expect(late.legs[0].rung).not.toBe('witnessed-settled')
	expect(late.state).toBe('abandoned')
})

test('a declared witness never settles a leg', async () => {
	const wrapper = wrapperFor({
		'leg-1': handle({ rung: 'witnessed-settled', unwitnessed: false, witness: { kind: 'ack', source: 'rail-a', observedAt: 1 } }),
	})
	const aggregator = new PayAggregator(options([wrapper]))
	const opened = await aggregator.pay({ orderId: 'order-2', totalSat: 1000, legs: [legIntent()] })
	const result = await aggregator.reconcile(opened.setId)
	expect(result.legs[0].rung).not.toBe('witnessed-settled')
	expect(result.legs[0].rung).toBe('attested')
	expect(result.state).toBe('unfinished')
	expect(result.mismatch).toBe(true)
})

test('a witness that disagrees with the stored expectation is surfaced, not merged', async () => {
	const wrapper = wrapperFor({
		'leg-1': handle({
			rung: 'witnessed-settled',
			unwitnessed: false,
			witness: { kind: 'preimage', source: 'rail-a', observedAt: 1, reference: 'wrong' },
		}),
	})
	const aggregator = new PayAggregator(options([wrapper]))
	const opened = await aggregator.pay({ orderId: 'order-3', totalSat: 1000, legs: [legIntent({ expectedPaymentHash: 'h1' })] })
	const result = await aggregator.reconcile(opened.setId)
	expect(result.legs[0].rung).toBe('attested')
	expect(result.state).toBe('unfinished')
	expect(result.mismatch).toBe(true)
	// the wrapper produced a cryptographic kind, but a failing check never settles
	expect(result.legs[0].rung).not.toBe('witnessed-settled')
})

test('a cryptographic witness that matches the expectation settles the leg', async () => {
	const wrapper = wrapperFor({
		'leg-1': handle({
			rung: 'witnessed-settled',
			unwitnessed: false,
			witness: { kind: 'preimage', source: 'rail-a', observedAt: 1, reference: 'ok:h1' },
		}),
	})
	const aggregator = new PayAggregator(options([wrapper]))
	const opened = await aggregator.pay({ orderId: 'order-4', totalSat: 1000, legs: [legIntent()] })
	const result = await aggregator.reconcile(opened.setId)
	expect(result.legs[0].rung).toBe('witnessed-settled')
	expect(result.state).toBe('complete')
})

// ── the refund guard ────────────────────────────────────────────────────────────────────────────────────────

test('a second refund set for one order is refused', async () => {
	const aggregator = new PayAggregator(options([wrapperFor({})]))
	const purchase = await aggregator.pay({ orderId: 'order-5', totalSat: 1000, legs: [legIntent()] })
	await aggregator.openRefund({ purchaseSetId: purchase.setId, refundTotalSat: 500, legs: [legIntent({ expectedPaymentHash: 'r1' })] })

	let error: FundsDuplicateRefundError | undefined
	try {
		await aggregator.openRefund({ purchaseSetId: purchase.setId, refundTotalSat: 500, legs: [legIntent({ expectedPaymentHash: 'r2' })] })
	} catch (thrown) {
		error = thrown as FundsDuplicateRefundError
	}
	expect(error).toBeInstanceOf(FundsDuplicateRefundError)
	expect(error?.reason).toBe('duplicate')
	expect(error?.existingRefundSetId).toBeDefined()
})

test('the refund guard refuses an unresolvable correlation and a refund above the purchase total', async () => {
	const aggregator = new PayAggregator(options([wrapperFor({})]))
	const purchase = await aggregator.pay({ orderId: 'order-6', totalSat: 1000, legs: [legIntent()] })

	let unresolvable: FundsDuplicateRefundError | undefined
	try {
		await aggregator.openRefund({ purchaseSetId: 'no-such-set', refundTotalSat: 1, legs: [] })
	} catch (thrown) {
		unresolvable = thrown as FundsDuplicateRefundError
	}
	expect(unresolvable?.reason).toBe('unresolvable')

	let over: FundsDuplicateRefundError | undefined
	try {
		await aggregator.openRefund({ purchaseSetId: purchase.setId, refundTotalSat: 1001, legs: [] })
	} catch (thrown) {
		over = thrown as FundsDuplicateRefundError
	}
	expect(over?.reason).toBe('over-total')
})

test('the partition derives the merchant share as the residual', () => {
	const aggregator = new PayAggregator(options([wrapperFor({})]))
	const partition = aggregator.partition(1000, [
		{ legId: 'a', frozenShare: 500 },
		{ legId: 'b', frozenShare: 300 },
	])
	expect(partition.merchantShare).toBe(200)
	expect(partition.frozenTotal).toBe(1000)
})

test('a payment hash belongs to exactly one leg of exactly one set', async () => {
	const aggregator = new PayAggregator(options([wrapperFor({})]))
	await aggregator.pay({ orderId: 'order-7', totalSat: 1000, legs: [legIntent({ expectedPaymentHash: 'shared' })] })
	let error = ''
	try {
		await aggregator.pay({ orderId: 'order-8', totalSat: 1000, legs: [legIntent({ expectedPaymentHash: 'shared' })] })
	} catch (thrown) {
		error = (thrown as { code?: string }).code ?? ''
	}
	expect(error).toBe('pay_hash_claimed')
})
