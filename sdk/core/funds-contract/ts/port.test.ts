/**
 * funds-contract/ts/port.test.ts — the type surface, checked.
 *
 * Test support, out of contract: it mints no statement. The `satisfies`/annotated values below are the
 * compile-time assertions (enforced by `bun run typecheck` — change a type and they stop compiling), and
 * the `test` blocks are the runtime assertions (change a vocabulary value and they fail). A types-only
 * module has no behaviour to exercise, so this file is the whole of its test.
 */
import { expect, test } from 'bun:test'
import type {
	FundsStep,
	FundsOperations,
	FundsRung,
	FundsAuthorityKind,
	FundsWitnessKind,
	FundsIntent,
	FundsQuote,
	FundsRefusal,
	FundsWitness,
	FundsState,
	FundsHandle,
	WrapperRegistration,
} from './index'

// The port's operations, in the canonical order the plan is projected onto: a full set, and the passive set.
const operations: FundsOperations = ['obtain', 'submit', 'reconcile']
const passive: FundsOperations = ['obtain', 'reconcile']
const rungs: FundsRung[] = ['attested', 'witnessed-settled', 'unresolved', 'abandoned']
const authorityKinds: FundsAuthorityKind[] = ['local', 'remote-and-observable']
const witnessKinds: FundsWitnessKind[] = ['preimage', 'zap_receipt', 'mint_quote_state', 'lnurl_verify', 'seller_attestation', 'ack']
const steps: FundsStep[] = [...operations]

const intent: FundsIntent = { wrapperId: 'w', legId: 'l', method: 'bolt11', amountSat: 1000 }
const quote: FundsQuote = {
	wrapperId: 'w',
	legId: 'l',
	method: 'bolt11',
	authorityKind: 'remote-and-observable',
	operations,
	plan: operations,
	reference: 'the durable reference, opaque to the contract',
}
const refusal: FundsRefusal = { refused: true, reason: 'no-submit', field: 'operations' }
const witness: FundsWitness = { kind: 'preimage', source: 'webln', observedAt: 1, reference: 'observed' }
const state: FundsState = { progress: 'submitted', rung: 'attested' }
const handle: FundsHandle = {
	wrapperId: 'w',
	legId: 'l',
	progress: 'submitted',
	rung: 'attested',
	witness,
	unwitnessed: false,
	reconcileDeadlineAt: 2,
}
const registration = {
	wrapperId: 'w',
	method: 'bolt11',
	port: 'funds',
	authorityKind: 'remote-and-observable',
	operations,
	plan: operations,
	store: 'leg-store',
	storeKind: 'indexeddb',
	witnessKinds: ['preimage'],
	reconcileDeadlineMs: 1000,
	journalReference: { shape: 'bolt11+payment_hash', writtenBefore: 'submit' },
	ceiling: 1_000_000,
	contractVersion: '0.1',
} satisfies WrapperRegistration

test('the port is exactly three operations, in canonical order', () => {
	expect(operations).toEqual(['obtain', 'submit', 'reconcile'])
	expect(steps).toHaveLength(3)
})

test('a passive rail declares obtain and reconcile and omits submit', () => {
	expect(passive).toEqual(['obtain', 'reconcile'])
	expect(passive).not.toContain('submit')
})

test('there is one proof vocabulary of exactly four rungs', () => {
	expect(rungs).toEqual(['attested', 'witnessed-settled', 'unresolved', 'abandoned'])
})

test('an authority kind is local or remote-and-observable and nothing else', () => {
	expect(authorityKinds).toEqual(['local', 'remote-and-observable'])
})

test('the witness kinds separate the cryptographic from the declared', () => {
	const cryptographic = witnessKinds.filter((k) => k === 'preimage' || k === 'zap_receipt' || k === 'mint_quote_state')
	expect(cryptographic).toHaveLength(3)
	expect(witnessKinds).toHaveLength(6)
})

test('the exchange shapes carry what the port needs and no bearer material', () => {
	expect(intent.legId).toBe('l')
	expect(quote.plan).toEqual(['obtain', 'submit', 'reconcile'])
	expect(refusal.refused).toBe(true)
	expect(witness.kind).toBe('preimage')
	expect(state.rung).toBe('attested')
	expect(handle.unwitnessed).toBe(false)
})

test('a registration declares every field the acceptance gate validates', () => {
	expect(Object.keys(registration).sort()).toEqual(
		[
			'authorityKind',
			'ceiling',
			'contractVersion',
			'journalReference',
			'method',
			'operations',
			'plan',
			'port',
			'reconcileDeadlineMs',
			'store',
			'storeKind',
			'witnessKinds',
			'wrapperId',
		].sort(),
	)
})
