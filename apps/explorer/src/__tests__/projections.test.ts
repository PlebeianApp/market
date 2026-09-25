/**
 * Projection tests — the three implementations of the same interface, checked against each other.
 *
 * A browser probe proved the live view renders real relay data once. This file is the durable version
 * of that claim, and it covers the two projections a probe cannot reach reliably:
 *
 *   - the **CMS** composition, which reads manifests and resolves data generically;
 *   - the **sandbox** binding, which is a capability object rather than a network.
 *
 * The interesting assertion is the last one: given the same fixtures, all three bindings must produce
 * the same validated listings. That is the cross-adapter invariant the architecture rests on
 * (`browsing-explore-search.md` §9), and if it ever fails, a component has learned something about its
 * host.
 */
import { describe, expect, test } from 'bun:test'

import { parseListing } from '@plebeian/product'
import { createStaticEnvironment, type ModuleEnvironment, type RawEvent } from '@plebeian/contract'
import { createNappletEnvironment } from '@plebeian/napplet'

import { fieldsFor, filterForManifest, findManifest, productGridManifest, resolvePageData, type PageDefinition } from '../cms'

const PUBKEY = 'a'.repeat(64)

const listing = (d: string, over: Partial<RawEvent> = {}): RawEvent => ({
	kind: 30402,
	id: (d + '0'.repeat(64)).slice(0, 64).replace(/[^a-f0-9]/g, 'f'),
	pubkey: PUBKEY,
	created_at: 1_700_000_000,
	content: '',
	tags: [
		['d', d],
		['title', `Listing ${d}`],
		['price', '40000', 'SATS'],
	],
	...over,
})

const CATEGORY_EVENT: RawEvent = {
	...listing('shirt'),
	tags: [
		['d', 'shirt'],
		['title', 'A shirt'],
		['price', '10', 'GBP'],
		['t', 'clothing'],
	],
}

const FIXTURES: readonly RawEvent[] = [listing('one'), listing('two'), CATEGORY_EVENT]

/** The same fixtures, reached through the sandbox binding instead of memory. */
const sandboxEnvironment = (events: readonly RawEvent[]): ModuleEnvironment =>
	createNappletEnvironment({
		runtime: {
			outbox: { query: async () => events },
			resource: {},
		},
	})

describe('CMS composition — generic over manifests', () => {
	test('the manifest is the only place a component’s arguments and data needs live', () => {
		expect(productGridManifest.dependencies.packages).toContain('@plebeian/product')
		expect(productGridManifest.dependencies.renderers).toEqual(['react'])
		expect(Object.keys(productGridManifest.arguments).sort()).toEqual(['category', 'showOutOfStock', 'title'])
		expect(productGridManifest.dataRequirements.kinds).toEqual([30402])
	})

	test('fields are generated from the manifest — nothing is hand-written per component', () => {
		const fields = fieldsFor(productGridManifest)
		expect(fields.map((f) => f.key)).toEqual(['title', 'category', 'showOutOfStock'])
		expect(fields.find((f) => f.key === 'showOutOfStock')?.field.type).toBe('boolean')
	})

	test('the filter is built from the declaration, not from the component', () => {
		expect(filterForManifest(productGridManifest, {})).toEqual({ kinds: [30402], limit: 40 })
		expect(filterForManifest(productGridManifest, { category: 'clothing' })).toEqual({ kinds: [30402], limit: 40, '#t': ['clothing'] })
	})

	test('a page definition resolves to validated listings, block by block', async () => {
		const page: PageDefinition = {
			title: 'test page',
			blocks: [
				{ component: 'product-grid', args: { title: 'All' } },
				{ component: 'product-grid', args: { title: 'Clothing', category: 'clothing' } },
				{ component: 'not-registered', args: {} },
			],
		}
		const env = createStaticEnvironment({ events: FIXTURES })
		const resolved = await resolvePageData(page, env, parseListing as never)

		expect(resolved.get(0)).toHaveLength(3)
		expect(resolved.get(1)).toHaveLength(1)
		expect(resolved.get(1)?.[0]?.title).toBe('A shirt')
		// An unregistered block resolves to nothing rather than throwing — the page still renders.
		expect(resolved.get(2)).toEqual([])
	})

	test('a block whose component declares no data package gets no data', async () => {
		const page: PageDefinition = { title: 't', blocks: [{ component: 'collection', args: { dTag: 'summer' } }] }
		const env = createStaticEnvironment({ events: FIXTURES })
		const resolved = await resolvePageData(page, env, parseListing as never)
		expect(resolved.get(0)).toEqual([])
	})
})

describe('cross-adapter invariant', () => {
	test('the static binding, the sandbox binding and a direct parse produce identical validated listings', async () => {
		const staticEnv = createStaticEnvironment({ events: FIXTURES })
		const nappletEnv = sandboxEnvironment(FIXTURES)

		const collect = async (env: ModuleEnvironment) => {
			const result = await env.nostr.read([{ kinds: [30402], limit: 40 }])
			if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
			return result.events
				.map((event) => parseListing(event))
				.filter((parsed) => parsed.ok)
				.map((parsed) => (parsed.ok ? parsed.value : null))
				.map((value) => `${value?.coordinate}|${value?.title}|${value?.price?.amount}${value?.price?.currency}`)
				.sort()
		}

		const fromStatic = await collect(staticEnv)
		const fromSandbox = await collect(nappletEnv)
		const direct = FIXTURES.map((event) => parseListing(event))
			.filter((parsed) => parsed.ok)
			.map((parsed) => (parsed.ok ? parsed.value : null))
			.map((value) => `${value?.coordinate}|${value?.title}|${value?.price?.amount}${value?.price?.currency}`)
			.sort()

		expect(fromStatic).toEqual(direct)
		expect(fromSandbox).toEqual(direct)
		expect(fromStatic).toHaveLength(3)
		// The SATS currency survived: this is the live-data case (decision D7) reaching the component.
		expect(fromStatic.some((row) => row.includes('40000SATS'))).toBe(true)
	})

	test('a failure in one binding does not become an empty result in the component layer', async () => {
		const failing = createStaticEnvironment({ events: FIXTURES, failWith: { ok: false, reason: 'transport', detail: 'relay refused' } })
		const result = await failing.nostr.read([{ kinds: [30402] }])
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.reason).toBe('transport')
	})
})

describe('manifest registry', () => {
	test('every registered component declares dependencies, renderers, arguments and data', () => {
		for (const name of ['product-grid', 'collection']) {
			const manifest = findManifest(name)
			expect(manifest).toBeDefined()
			expect(manifest?.dependencies.packages.length).toBeGreaterThan(0)
			expect(manifest?.dependencies.renderers.length).toBeGreaterThan(0)
			expect(Object.keys(manifest?.arguments ?? {}).length).toBeGreaterThan(0)
			expect(manifest?.dataRequirements.kinds.length).toBeGreaterThan(0)
		}
	})

	test('an unregistered component has no manifest — which is what makes it unpublishable', () => {
		expect(findManifest('nope')).toBeUndefined()
	})
})
