/**
 * shippingRead.test.ts — the typed read for kind 30406, and **the constraint each case pins**.
 *
 * Every event below is built by the module's **own write side** (`buildShippingOptionEventData`) wherever
 * a conforming event is needed, so the read is asserted against what this module actually publishes —
 * a round-trip, not a hand-shaped fixture. The malformed companions are the write side's output with
 * **one element removed**, so each refusal is attributable to that removal and nothing else.
 *
 * **The mutations that turn each case red** (one per case, stated in the case itself):
 * - case 1 — make `ShippingOptionPrice.unit` optional (or read `price[2] ?? ''`): the round-trip's unit
 *   assertion fails, and the type no longer forbids an amount with no unit.
 * - case 2 — default a missing unit (`price[2] ?? 'USD'` / `?? ''`) instead of refusing: the outcome
 *   becomes `'read'` and the defect is back.
 * - case 3 — accept any `service` string (`service as ShippingService` without the domain check): an
 *   unknown service resolves instead of being refused.
 * - case 4 — accept a non-ISO unit (`'usd'`) rather than refusing: `bad-price-unit` is never raised.
 * - case 5 — `filter` the malformed event out of the corpus instead of refusing it: the refusal list goes
 *   empty and the "no silent disappearance" count assertion fails.
 * - case 6 — key the map by `id` instead of `ref`: the checkout's own rule reports the chosen ref as
 *   unresolved and `isResolved` is `false`.
 * - case 7 — build the ref with an empty seller (`30406::ship-1`): a seller-less event resolves.
 * - case 8 — empty `SHIPPING_READ_ASSUMPTIONS` (or drop a falsifier): the assumption register is not a value.
 */

import { describe, expect, test } from 'bun:test'

import { resolveCheckoutDeliveryRequirements } from '../checkout/deliveryRequirements'
import {
	readShippingOption,
	readShippingOptions,
	resolveShippingServicesByRef,
	servicesByShippingRef,
	SHIPPING_OPTION_CONSTRAINTS,
	SHIPPING_READ_ASSUMPTIONS,
	SHIPPING_REF_KIND,
	SHIPPING_SERVICE_DOMAIN,
	type ShippingOptionReadEvent,
} from './shippingRead'
import { buildShippingOptionEventData, type ShippingOptionFormInput } from './shippingWorkflow'

const SELLER = 'b'.repeat(64)
const OTHER_SELLER = 'c'.repeat(64)

const baseForm: ShippingOptionFormInput = {
	title: 'Standard',
	description: 'Usually arrives soon',
	price: '5',
	currency: 'USD',
	countries: ['USA'],
	service: 'standard',
}

/** A conforming event, published by this module's own write side, plus the envelope the host owns. */
function published(form: ShippingOptionFormInput, id: string, seller = SELLER): ShippingOptionReadEvent {
	return { ...buildShippingOptionEventData(form, id), pubkey: seller, created_at: 1_760_000_000 }
}

/** The same event with one tag's elements trimmed — the mutation that isolates a single refusal. */
function withPriceElements(event: ShippingOptionReadEvent, elements: string[]): ShippingOptionReadEvent {
	return { ...event, tags: event.tags.map((tag) => (tag[0] === 'price' ? ['price', ...elements] : [...tag])) }
}

describe('a kind-30406 event reads into a shipping service that carries its unit', () => {
	test('case 1: the write side round-trips, and the amount arrives bound to its unit', () => {
		const event = published(baseForm, 'ship-1')
		const read = readShippingOption(event)

		expect(read.outcome).toBe('read')
		if (read.outcome !== 'read') return
		expect(read.service.ref).toBe(`${SHIPPING_REF_KIND}:${SELLER}:ship-1`)
		expect(read.service.service).toBe('standard')
		// The unit, from the price tag's own third element — not defaulted, not inferred.
		expect(read.service.price).toEqual({ amount: '5', unit: 'USD' })
		expect(read.service.countries).toEqual(['USA'])
	})

	test('case 2: an amount with NO unit is refused by name — never handed back unit-less', () => {
		const event = withPriceElements(published(baseForm, 'ship-1'), ['5'])
		const read = readShippingOption(event)

		expect(read.outcome).toBe('refused')
		if (read.outcome !== 'refused') return
		expect(read.refusal.constraint).toBe('missing-price-unit')
		expect(read.refusal.tag).toBe('price')
		expect(read.refusal.ref).toBe(`${SHIPPING_REF_KIND}:${SELLER}:ship-1`)
		expect(read.refusal.message).toContain('no unit')
	})

	test('case 3: an unknown service is refused, never coerced to a known one', () => {
		const event = {
			...published(baseForm, 'ship-1'),
			tags: published(baseForm, 'ship-1').tags.map((tag) => (tag[0] === 'service' ? ['service', 'drone'] : [...tag])),
		}
		const read = readShippingOption(event)

		expect(read.outcome).toBe('refused')
		if (read.outcome !== 'refused') return
		expect(read.refusal.constraint).toBe('unknown-service')
		expect(read.refusal.tag).toBe('service')
		expect(read.refusal.message).toContain(SHIPPING_SERVICE_DOMAIN.join(', '))
	})

	test('case 4: a unit that is not an ISO 4217 code is refused, not accepted as a unit', () => {
		const event = withPriceElements(published(baseForm, 'ship-1'), ['5', 'usd'])
		const read = readShippingOption(event)

		expect(read.outcome).toBe('refused')
		if (read.outcome !== 'refused') return
		expect(read.refusal.constraint).toBe('bad-price-unit')
		expect(read.refusal.tag).toBe('price')
	})

	test('case 5: a malformed event in a corpus is REFUSED beside the good ones — no silent disappearance', () => {
		const good = published(baseForm, 'ship-1')
		const noUnit = withPriceElements(published(baseForm, 'ship-2'), ['5'])
		const result = readShippingOptions([good, noUnit])

		expect(result.services.map((service) => service.ref)).toEqual([`${SHIPPING_REF_KIND}:${SELLER}:ship-1`])
		expect(result.refusals).toHaveLength(1)
		expect(result.services.length + result.refusals.length).toBe(2)
	})
})

describe('the read makes a chosen shipping ref resolve in the checkout rule', () => {
	test('case 6: servicesByShippingRef resolves the ref the checkout is asked about', () => {
		const events = [published(baseForm, 'standard'), published({ ...baseForm, service: 'pickup' }, 'pickup', OTHER_SELLER)]
		const { services } = readShippingOptions(events)
		const byRef = servicesByShippingRef(services)

		// The map is keyed by the **ref**, which is what a listing's `shipping_option` tag carries.
		expect(Object.keys(byRef).sort()).toEqual(
			[`${SHIPPING_REF_KIND}:${SELLER}:standard`, `${SHIPPING_REF_KIND}:${OTHER_SELLER}:pickup`].sort(),
		)
		expect(byRef[`${SHIPPING_REF_KIND}:${SELLER}:standard`]).toBe('standard')

		// …and the checkout's own rule, over that map, resolves the chosen ref rather than reporting it.
		const requirements = resolveCheckoutDeliveryRequirements({
			products: [{ id: 'coat', shippingMethodId: `${SHIPPING_REF_KIND}:${SELLER}:standard` }],
			servicesByShippingRef: byRef,
		})
		expect(requirements.isResolved).toBe(true)
		expect(requirements.unresolvedShippingRefs).toEqual([])
		expect(requirements.hasPhysicalDelivery).toBe(true)
	})

	test('the one-call convenience returns the map AND every refusal beside it', () => {
		const events = [published(baseForm, 'ship-1'), { ...published(baseForm, 'ship-2'), pubkey: 'not-hex' }]
		const { servicesByShippingRef: byRef, refusals } = resolveShippingServicesByRef(events)

		expect(Object.keys(byRef)).toEqual([`${SHIPPING_REF_KIND}:${SELLER}:ship-1`])
		expect(refusals.map((refusal) => refusal.constraint)).toEqual(['missing-seller'])
	})

	test('case 7: an event with no 64-hex seller cannot be the one a ref names', () => {
		const read = readShippingOption({ ...published(baseForm, 'ship-1'), pubkey: 'not-hex' })

		expect(read.outcome).toBe('refused')
		if (read.outcome !== 'refused') return
		expect(read.refusal.constraint).toBe('missing-seller')
		expect(read.refusal.tag).toBeUndefined()
	})
})

describe('the read’s refusal vocabulary and assumptions are values, not silences', () => {
	test('a non-30406 event is refused as not-a-shipping-option', () => {
		const read = readShippingOption({ kind: 30402, pubkey: SELLER, tags: [['d', 'x']] })

		expect(read.outcome).toBe('refused')
		if (read.outcome !== 'refused') return
		expect(read.refusal.constraint).toBe('not-a-shipping-option')
	})

	test('every missing required tag is refused, naming the tag the publisher omitted', () => {
		for (const tag of ['d', 'title', 'country', 'service'] as const) {
			const event = { ...published(baseForm, 'ship-1'), tags: published(baseForm, 'ship-1').tags.filter((t) => t[0] !== tag) }
			const read = readShippingOption(event)
			expect(read.outcome).toBe('refused')
			if (read.outcome !== 'refused') continue
			expect(read.refusal.tag).toBe(tag)
		}
	})

	test('case 8: the assumption register is non-empty, and every entry names its falsifier', () => {
		expect(SHIPPING_READ_ASSUMPTIONS.length).toBeGreaterThan(0)
		for (const entry of SHIPPING_READ_ASSUMPTIONS) {
			expect(entry.assumption.length).toBeGreaterThan(0)
			expect(entry.falsifiedBy.length).toBeGreaterThan(0)
		}
		// The constraint this increment exists to name is in the closed vocabulary.
		expect(SHIPPING_OPTION_CONSTRAINTS).toContain('missing-price-unit')
		expect(new Set(SHIPPING_OPTION_CONSTRAINTS).size).toBe(SHIPPING_OPTION_CONSTRAINTS.length)
	})
})
