/**
 * boot.test.ts — the instance boots, with every edge supplied.
 *
 * "Boots" here means the four things `bootInstance` does and nothing else:
 * resolve this instance's config, choose a product edge, read it, compose the
 * view. Each of the four is asserted on its own, and the two cases that could
 * reach a network (a configured relay set) are driven with an injected transport.
 *
 * The mutations that turn these red:
 * - `resolveProductSource` ignoring `options.source`: the injected source's kind
 *   and its empty result stop coming back.
 * - moving the `config.relayUrls.length === 0` branch: with no relays configured
 *   the boot tries a live read, `captured` stays empty and the case fails.
 * - dropping `now` from `resolveInstanceConfig`'s result: the id/name/currency
 *   assertions fail.
 *
 * The shipping-edge cases have their own mutations, named beside them: boot passing the
 * pre-fix `records: source.kind === 'fixture' ? … : null` (the relay arm never read), the
 * shipping read inferring a service from the ref's own text, the fixture source dropping
 * its own record, and the relay source reporting "not read" for an answer that was read
 * and empty.
 */

import { describe, expect, test } from 'bun:test'
import { of } from 'rxjs'

import type { Event as NostrEvent } from '@sdk/core/nostr-io/ts/index'
import type { ProductReadEvent } from '@sdk/commerce/discovery'
import { SHIPPING_OPTION_KIND } from '@sdk/commerce/shipping/shippingWorkflow'

import { bootInstance, resolveProductSource } from './boot'
import type { Cart } from './cartState'
import { buildCatalogEvents, DEMO_SELLER_PUBKEY, DEMO_SHIPPING_OPTION_ID, DEMO_SHIPPING_REF } from './catalog'
import { buildCheckoutView } from './checkoutView'
import { resolveInstanceConfig } from './config'
import { type InjectedPool, type ProductSource } from './productSource'

const captured: { relays: string[]; filters: unknown[] }[] = []

/** A transport with no socket behind it. Empty event stream is enough for boot. */
function emptyPool(): InjectedPool {
	return {
		request(relays, filters) {
			captured.push({ relays, filters })
			return of(...([] as unknown as NostrEvent[]))
		},
		subscribe() {
			throw new Error('boot must not subscribe')
		},
		async publish() {
			return []
		},
		async count() {
			return { count: 0, approximate: true }
		},
		status() {
			return []
		},
		close() {
			// nothing is open
		},
	}
}

describe('instance config resolves from an injected environment', () => {
	test('defaults are this instance’s own, and relays default to none', () => {
		expect(resolveInstanceConfig({})).toEqual({
			instanceId: 'demo-shop',
			displayName: 'Demo Shop',
			displayCurrency: 'BTC',
			relayUrls: [],
		})
	})

	test('an operator can name the instance and its relays; blanks are dropped', () => {
		const config = resolveInstanceConfig({
			DEMO_SHOP_INSTANCE_ID: ' shop-two ',
			DEMO_SHOP_NAME: 'Shop Two',
			DEMO_SHOP_CURRENCY: 'USD',
			DEMO_SHOP_RELAYS: 'wss://a.test, ,wss://b.test',
		})

		expect(config).toEqual({ instanceId: 'shop-two', displayName: 'Shop Two', displayCurrency: 'USD', relayUrls: ['wss://a.test', 'wss://b.test'] })
	})
})

describe('the instance boots', () => {
	test('with no relays configured it serves its own catalog, and reaches nothing', async () => {
		const runtime = await bootInstance({ env: {}, now: () => 1_760_000_000_000 })

		expect(runtime.sourceKind).toBe('fixture')
		expect(runtime.loadedAtMs).toBe(1_760_000_000_000)
		expect(runtime.view.items).toHaveLength(5)
		expect(runtime.view.summaryLine).toBe('5 listings · 1 not on sale')
	})

	test('an injected source wins, and its kind is reported', async () => {
		// A hand-written source performs no shipping read, and says so with `null` rather
		// than with an empty corpus it did not read.
		const injected: ProductSource = {
			kind: 'relay',
			async listProducts() {
				return []
			},
			async listShippingRecords() {
				return null
			},
		}
		const runtime = await bootInstance({ source: injected })

		expect(runtime.sourceKind).toBe('relay')
		expect(runtime.view.items).toEqual([])
		expect(runtime.view.summaryLine).toBe('0 listings')
	})

	test('a configured relay set composes the SDK seam over the injected transport', async () => {
		captured.length = 0
		const runtime = await bootInstance({ env: { DEMO_SHOP_RELAYS: 'wss://relay.boot.test' }, pool: emptyPool() })

		expect(runtime.sourceKind).toBe('relay')
		expect(runtime.config.relayUrls).toEqual(['wss://relay.boot.test'])
		// Two REQs through the one injected transport now: the kind-30402 listings, and the
		// kind-30406 shipping corpus this edge reads (the gap this increment closes).
		expect(captured).toHaveLength(2)
		expect(captured.map((request) => (request.filters[0] as { kinds?: number[] }).kinds?.[0]).sort()).toEqual([30402, SHIPPING_OPTION_KIND])
		expect(captured[0]?.relays[0]).toContain('relay.boot.test')
		expect(runtime.view.items).toEqual([])
	})

	test('view options reach the read model', async () => {
		const runtime = await bootInstance({ env: {}, view: { exclude: 'mug' } })

		expect(runtime.view.items.map((item) => item.id)).not.toContain('ceramic-mug')
	})
})

describe('edge selection', () => {
	test('an injected source always wins over the configured relay set', () => {
		const injected: ProductSource = {
			kind: 'fixture',
			async listProducts() {
				return []
			},
			async listShippingRecords() {
				return null
			},
		}
		const config = resolveInstanceConfig({ DEMO_SHOP_RELAYS: 'wss://relay.boot.test' })

		expect(resolveProductSource(config, { source: injected })).toBe(injected)
	})

	test('a source built from an empty relay set never reads a relay', async () => {
		const source = resolveProductSource(resolveInstanceConfig({}))
		const items: ProductReadEvent[] = await source.listProducts()

		expect(source.kind).toBe('fixture')
		expect(items).toHaveLength(6)
	})
})

describe('the shipping edge a relay boot reads, over an injected transport', () => {
	const listing = buildCatalogEvents()[0] as ProductReadEvent

	/** A transport that answers each REQ with the events filed under the kind it asked for. */
	function kindRoutedPool(byKind: Record<number, readonly unknown[]>, requested: number[][]): InjectedPool {
		return {
			request(_relays, filters) {
				const kinds = (filters as { kinds?: number[] }[])[0]?.kinds ?? []
				requested.push(kinds)
				return of(...(kinds.flatMap((kind) => byKind[kind] ?? []) as NostrEvent[]))
			},
			subscribe() {
				throw new Error('boot must not subscribe')
			},
			async publish() {
				return []
			},
			async count() {
				return { count: 0, approximate: true }
			},
			status() {
				return []
			},
			close() {
				// nothing is open
			},
		}
	}

	/**
	 * One kind-30406 record as the wire carries it. Its `d` is the option id every listing's
	 * ref names, so it is *the* record `DEMO_SHIPPING_REF` resolves under — and its service
	 * is `express`, which the ref's own text (`:standard`) cannot produce. `service: null`
	 * omits the required tag, which is the malformed record case 2 needs.
	 */
	function shippingRecord(options: { service?: string | null } = {}): unknown {
		const service = options.service === undefined ? 'express' : options.service
		return {
			kind: SHIPPING_OPTION_KIND,
			pubkey: DEMO_SELLER_PUBKEY,
			created_at: 1_760_000_700,
			content: 'Posted the next working day.',
			tags: [
				['d', DEMO_SHIPPING_OPTION_ID],
				['title', 'Express shipping'],
				['price', '250', 'SAT'],
				...(service === null ? [] : [['service', service]]),
				['country', 'FR'],
			],
			id: 'wire-shipping-record',
			sig: 'sig',
		}
	}

	/**
	 * Case 1. Mutation that turns it red: boot composing the shipping corpus the pre-fix
	 * way (`records: source.kind === 'fixture' ? buildShippingCatalogEvents() : null`) — the
	 * relay arm then reports `not-read-on-this-edge`, `servicesByShippingRef` is empty, and
	 * both the edge and the ref assertions below fail.
	 */
	test('resolves the seller’s published ref to the record the wire answered', async () => {
		const requested: number[][] = []
		const pool = kindRoutedPool({ [30402]: [listing], [SHIPPING_OPTION_KIND]: [shippingRecord()] }, requested)

		const runtime = await bootInstance({ env: { DEMO_SHOP_RELAYS: 'wss://relay.shipping.test' }, pool })

		expect(runtime.sourceKind).toBe('relay')
		// The relay arm, not the fixture one.
		expect(runtime.shipping.edge).toBe('relay')
		expect(runtime.shipping.summaryLine).toBe('1 of the 1 shipping ref a listing publishes resolved through the kind-30406 read')
		// The service is the wire record's (`express`), not the ref's own last segment (`standard`).
		expect(runtime.shipping.servicesByShippingRef[DEMO_SHIPPING_REF]).toBe('express')
		expect(runtime.shipping.refusals).toEqual([])

		const options = runtime.shipping.optionsBySeller[DEMO_SELLER_PUBKEY] ?? []
		expect(options.map((option) => option.ref)).toEqual([DEMO_SHIPPING_REF])
		expect(options[0]?.known).toBe(true)
		expect(options[0]?.service).toBe('express')
		// The amount and its unit are the record's, joined to the listing's own tagged amount.
		expect(options[0]?.price).toEqual({ amount: '250', unit: 'SAT' })
		expect(options[0]?.taggedAmount).toBe('250')

		// The seam asked the wire for both kinds, through the one injected transport.
		expect(requested.map((kinds) => kinds[0]).sort()).toEqual([30402, SHIPPING_OPTION_KIND].sort())

		// …and that is what lets the checkout resolve a chosen ref for a live listing.
		const [item] = runtime.view.items
		expect(item).toBeDefined()
		const cart: Cart = {
			lines: [
				{ productRef: item!.coordinates, id: item!.id, sellerPubkey: item!.sellerPubkey, amount: 1, shippingMethodId: DEMO_SHIPPING_REF },
			],
		}
		const checkout = buildCheckoutView(cart, { servicesByShippingRef: runtime.shipping.servicesByShippingRef })
		expect(checkout.requirements.isResolved).toBe(true)
		expect(checkout.shippingRefsWithoutRecord).toEqual([])
	})

	/**
	 * Case 2. Mutation that turns it red: `buildShippingRead` resolving a ref from its own
	 * text (`service: record?.service ?? shippingOptionIdOf(ref)`) — the ref would then
	 * resolve to `standard` and every assertion below fails.
	 */
	test('a record missing its service tag is refused by name, and its ref stays unresolved', async () => {
		const requested: number[][] = []
		const pool = kindRoutedPool({ [30402]: [listing], [SHIPPING_OPTION_KIND]: [shippingRecord({ service: null })] }, requested)

		const runtime = await bootInstance({ env: { DEMO_SHOP_RELAYS: 'wss://relay.refuse.test' }, pool })

		expect(runtime.shipping.edge).toBe('relay')
		// Refused BY NAME, never dropped: the read's own constraint vocabulary, its tag, its ref.
		expect(runtime.shipping.refusals).toHaveLength(1)
		expect(runtime.shipping.refusals[0]?.constraint).toBe('missing-tag')
		expect(runtime.shipping.refusals[0]?.tag).toBe('service')
		expect(runtime.shipping.refusals[0]?.ref).toBe(DEMO_SHIPPING_REF)
		expect(runtime.shipping.refusals[0]?.message).toBe('the required `service` tag is missing or empty')

		// …and the ref stays UNRESOLVED: nothing was inferred from `30406:…:standard`.
		expect(runtime.shipping.servicesByShippingRef[DEMO_SHIPPING_REF]).toBeUndefined()
		expect(runtime.shipping.servicesByShippingRef).toEqual({})
		const option = runtime.shipping.optionsBySeller[DEMO_SELLER_PUBKEY]?.[0]
		expect(option?.ref).toBe(DEMO_SHIPPING_REF)
		expect(option?.known).toBe(false)
		expect(option?.service).toBeNull()
		expect(option?.refusal).toBe('missing-tag')
	})

	/**
	 * Case 3. Mutation that turns it red: `createFixtureProductSource` answering `[]` (or
	 * `null`) for its shipping records — the demo seller's ref then stops resolving on the
	 * edge every existing fixture test uses.
	 */
	test('the fixture edge is unchanged: its own record still resolves the demo seller’s ref', async () => {
		const runtime = await bootInstance({ env: {} })

		expect(runtime.sourceKind).toBe('fixture')
		expect(runtime.shipping.edge).toBe('fixture-catalog')
		expect(runtime.shipping.servicesByShippingRef[DEMO_SHIPPING_REF]).toBe('standard')
	})

	/**
	 * Case 4. Mutation that turns it red: the relay source reporting `null` for an answer
	 * that was read and empty (`wire.events.length === 0 ? null : wire.events`) — the run
	 * would then say "this edge read no kind-30406 record" about a read it performed.
	 */
	test('a relay run that answered no kind-30406 event says so, and does not blame the seller', async () => {
		const requested: number[][] = []
		const pool = kindRoutedPool({ [30402]: [listing] }, requested)

		const runtime = await bootInstance({ env: { DEMO_SHOP_RELAYS: 'wss://relay.empty.test' }, pool })

		// The read was performed, so this is NOT the "not read on this edge" arm.
		expect(runtime.shipping.edge).toBe('relay')
		expect(runtime.shipping.summaryLine).toBe(
			'the kind-30406 read this edge performed answered no record, so the 1 shipping ref a listing publishes resolves as unresolved',
		)
		expect(requested.map((kinds) => kinds[0])).toContain(SHIPPING_OPTION_KIND)

		// The seller's own published ref is still reported, unresolved — the empty map is the
		// read's answer, not a claim that this listing publishes no shipping.
		expect(runtime.shipping.optionsBySeller[DEMO_SELLER_PUBKEY]?.map((option) => option.ref)).toEqual([DEMO_SHIPPING_REF])
		expect(runtime.shipping.servicesByShippingRef).toEqual({})
	})

	test('an edge that performed no shipping read says that instead', async () => {
		const stub: ProductSource = {
			kind: 'relay',
			async listProducts() {
				return []
			},
			async listShippingRecords() {
				return null
			},
		}
		const runtime = await bootInstance({ source: stub })

		expect(runtime.shipping.edge).toBe('not-read-on-this-edge')
		expect(runtime.shipping.summaryLine).toBe(
			'this edge read no kind-30406 record, so the 0 shipping refs a listing publishes resolve as unresolved',
		)
	})
})