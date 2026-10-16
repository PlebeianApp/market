/**
 * assumptions.test.ts — the register's own suite.
 *
 * The maintainer's requirement is that assumptions are *documented* **and**
 * *surfaced in the app*. `ssr.test.ts` holds the second half (the register is in
 * the served bytes on every route). This file holds the first: the register is
 * complete, traceable, and cannot quietly lose an entry or claim an edge the run
 * did not take.
 *
 * Six arms, each with the mutation that turns it red:
 *
 * - **every entry is whole.** Mutation: drop `falsifiedBy` from an entry — the
 *   entry arm names the id, because a statement with no falsifier is a
 *   disclaimer, not a register.
 * - **the ids are unique.** Mutation: copy the shipping composer twice — the
 *   collision arm names the id.
 * - **the SDK registers are carried, not copied.** Mutation: retype a statement
 *   here instead of importing it — the verbatim arm fails, because the module's
 *   own string and the page's must be the same string.
 * - **the required programme assumptions are present by id.** Mutation: delete
 *   the unlabelled-price entry — the required arm names it.
 * - **the register describes the run it was built for.** Mutation: build with
 *   `sourceKind: 'relay'` and claim the fixture — the edge arm fails, and the
 *   same mutation is caught on the page in `ssr.test.ts`.
 * - **the figures in the entries are derived.** Mutation: change the declared
 *   `BTC` precision the mispricing factor comes from — the derived-factor arm
 *   moves with it.
 */

import { describe, expect, test } from 'bun:test'

import { CART_CURRENCY_PRECISION } from '@sdk/commerce/cart'
import { CURRENCY_ASSUMPTIONS } from '@sdk/commerce/currency/assumptions'
import { SHIPPING_READ_ASSUMPTIONS } from '@sdk/commerce/shipping/shippingRead'

import {
	APP_SOURCE,
	bitcoinVersusSatsShift,
	buildAssumptionRegister,
	CURRENCY_REGISTER_SOURCE,
	SHIPPING_REGISTER_SOURCE,
	UNLABELLED_PRICE_EXAMPLE,
	type RegisterInput,
} from './assumptions'

const FIXTURE_RUN: RegisterInput = { sourceKind: 'fixture', relayUrls: [], displayCurrency: 'BTC' }
const RELAY_RUN: RegisterInput = { sourceKind: 'relay', relayUrls: ['wss://relay.example.test'], displayCurrency: 'BTC' }

const register = buildAssumptionRegister(FIXTURE_RUN)
const byId = new Map(register.entries.map((entry) => [entry.id, entry]))

/** The ids the programme has already earned, and that the page must carry. */
const REQUIRED_IDS = [
	'app-listing-edge',
	'app-no-live-relay-read-performed',
	'app-catalog-authored-in-btc',
	'app-unlabelled-price-is-refused',
	'app-cvm-rate-is-a-dependency',
]

describe('every entry is whole, and traceable to the code that leans on it', () => {
	test('no entry is missing a statement, a falsifier, a source or an id', () => {
		const incomplete = register.entries.filter(
			(entry) =>
				entry.id.trim().length === 0 ||
				entry.statement.trim().length === 0 ||
				entry.falsifiedBy.trim().length === 0 ||
				entry.source.trim().length === 0,
		)

		expect(incomplete).toEqual([])
		expect(register.entries.length).toBeGreaterThan(0)
	})

	test('the ids are unique', () => {
		const ids = register.entries.map((entry) => entry.id)

		expect(new Set(ids).size).toBe(ids.length)
	})

	test('every per-source count adds up to the entries that are there', () => {
		const counted = register.bySource.reduce((total, group) => total + group.count, 0)

		expect(counted).toBe(register.entries.length)
		// …and the summary the page renders states the same number.
		expect(register.summaryLine).toContain(`${register.entries.length} assumptions`)
	})

	test('the app’s own entries point at a real locus, and only the dependency names a module', () => {
		const appEntries = register.entries.filter(
			(entry) => entry.source !== CURRENCY_REGISTER_SOURCE && entry.source !== SHIPPING_REGISTER_SOURCE,
		)
		const namedByFile = appEntries.filter((entry) => entry.source.includes('apps/demo-shop/instance/'))

		// Five of the six are leaned on by a file in this app, so a falsified
		// assumption has somewhere to be looked for…
		expect(namedByFile).toHaveLength(5)
		// …and the sixth is the dependency, which names the module it depends on
		// rather than pretending to be a line of app code.
		const dependency = appEntries.filter((entry) => entry.source.startsWith('sdk/'))
		expect(dependency.map((entry) => entry.id)).toEqual(['app-cvm-rate-is-a-dependency'])
		expect(APP_SOURCE).toContain('apps/demo-shop')
	})
})

describe('the required programme assumptions are present, by id', () => {
	for (const id of REQUIRED_IDS) {
		test(`${id} is on the register`, () => {
			const entry = byId.get(id)

			expect(entry).toBeDefined()
			expect(entry?.falsifiedBy.length ?? 0).toBeGreaterThan(20)
		})
	}

	test('the unlabelled-price entry carries the mechanism and the measurement', () => {
		const entry = byId.get('app-unlabelled-price-is-refused')

		expect(entry?.statement).toContain('refused')
		expect(entry?.statement).toContain('never defaulted to SAT')
		expect(entry?.statement).toContain('missing-currency')
		// The measured consequence, with the worked example in both units.
		expect(entry?.falsifiedBy).toContain(UNLABELLED_PRICE_EXAMPLE.readAsTagged)
		expect(entry?.falsifiedBy).toContain(UNLABELLED_PRICE_EXAMPLE.readAsSats)
	})

	test('the fixture edge and the no-live-read entries are on the register', () => {
		expect(byId.get('app-listing-edge')?.statement).toContain('an injected fixture, not a live relay read')
		expect(byId.get('app-no-live-relay-read-performed')?.statement).toContain(
			'No live relay read has ever been performed by this demo',
		)
	})

	test('the BTC authoring entry names the parser rule that forces it', () => {
		const entry = byId.get('app-catalog-authored-in-btc')

		expect(entry?.statement).toContain('three-letter')
		expect(entry?.statement).toContain('/^[A-Z]{3}$/')
	})

	test('the rate entry says dependency, not fact', () => {
		expect(byId.get('app-cvm-rate-is-a-dependency')?.statement).toContain('not a fact about the world')
	})
})

describe('the SDK registers are carried verbatim, not restated here', () => {
	test('every currency assumption is on the register, as the module wrote it', () => {
		expect(register.entries.filter((entry) => entry.source === CURRENCY_REGISTER_SOURCE)).toHaveLength(
			CURRENCY_ASSUMPTIONS.length,
		)

		for (const assumption of CURRENCY_ASSUMPTIONS) {
			const entry = byId.get(`currency-${assumption.id}`)
			expect(entry?.statement).toBe(assumption.statement)
			expect(entry?.falsifiedBy).toBe(assumption.falsifiedBy)
		}
	})

	test('every shipping-read assumption is on the register, as the module wrote it', () => {
		expect(register.entries.filter((entry) => entry.source === SHIPPING_REGISTER_SOURCE)).toHaveLength(
			SHIPPING_READ_ASSUMPTIONS.length,
		)

		SHIPPING_READ_ASSUMPTIONS.forEach((assumption, index) => {
			const entry = byId.get(`shipping-read-${index + 1}`)
			expect(entry?.statement).toBe(assumption.assumption)
			expect(entry?.falsifiedBy).toBe(assumption.falsifiedBy)
		})
	})

	test('the register is the two modules plus the app’s own six, and nothing else', () => {
		const appEntries = register.entries.filter(
			(entry) => entry.source !== CURRENCY_REGISTER_SOURCE && entry.source !== SHIPPING_REGISTER_SOURCE,
		)

		expect(appEntries).toHaveLength(6)
		expect(register.entries).toHaveLength(CURRENCY_ASSUMPTIONS.length + SHIPPING_READ_ASSUMPTIONS.length + 6)
	})
})

describe('the register describes the run it was built for', () => {
	test('a fixture run says fixture, and a relay run says relay', () => {
		const fixture = buildAssumptionRegister(FIXTURE_RUN)
		const relay = buildAssumptionRegister(RELAY_RUN)
		const edgeOf = (entries: readonly { id: string; statement: string }[]) =>
			entries.find((entry) => entry.id === 'app-listing-edge')?.statement ?? ''

		expect(edgeOf(fixture.entries)).toContain('an injected fixture, not a live relay read')
		expect(edgeOf(fixture.entries)).toContain('0 relay addresses')
		expect(edgeOf(relay.entries)).toContain('came from a live relay read')
		expect(edgeOf(relay.entries)).toContain('wss://relay.example.test')
		expect(edgeOf(relay.entries)).not.toContain('an injected fixture')
	})

	test('the fallback currency the instance was configured with is named as the fallback', () => {
		const entry = buildAssumptionRegister({ ...FIXTURE_RUN, displayCurrency: 'EUR' }).entries.find(
			(candidate) => candidate.id === 'app-unlabelled-price-is-refused',
		)

		expect(entry?.statement).toContain('"EUR"')
		// …and it is still a named fallback rather than a default applied to a price.
		expect(entry?.statement).toContain('never defaulted to SAT')
	})
})

describe('the figures the entries quote are derived from the declarations', () => {
	test('the mispricing factor is the gap between the declared BTC and SAT precisions', () => {
		const btc = CART_CURRENCY_PRECISION.BTC
		const sat = CART_CURRENCY_PRECISION.SAT

		expect(typeof btc).toBe('number')
		expect(typeof sat).toBe('number')
		expect(bitcoinVersusSatsShift()).toBe(10 ** ((btc as number) - (sat as number)))
	})

	test('the worked example is the same numeral read in both units', () => {
		expect(UNLABELLED_PRICE_EXAMPLE.readAsTagged).toContain('185,000 satoshis (0.00185 BTC)')
		expect(UNLABELLED_PRICE_EXAMPLE.readAsSats).toBe('0.00185 satoshis')
		expect(byId.get('app-unlabelled-price-is-refused')?.falsifiedBy).toContain('100,000,000')
	})
})
