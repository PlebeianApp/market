/**
 * Contract tests for `parseListing`.
 *
 * The suite is organised around the failures the browsing spec calls out: required tags, the
 * frequency-vocabulary divergence, unknown-tag tolerance, the NSFW flag, and stock semantics. Every
 * fixture is a plain object — the package must not need a relay, an NDK wrapper or a browser.
 */
import { describe, expect, test } from 'bun:test'

import { deriveInStock, parseListing, PRODUCT_KIND } from '../parse'
import type { ProductListing } from '../types'

const PUBKEY = 'a'.repeat(64)
const ID = 'b'.repeat(64)

const tags = (...t: unknown[][]): unknown[][] => t

const event = (over: Partial<Record<string, unknown>> = {}) => ({
	kind: PRODUCT_KIND,
	id: ID,
	pubkey: PUBKEY,
	created_at: 1_700_000_000,
	content: 'A thing for sale.',
	tags: tags(['d', 'widget'], ['title', 'Widget'], ['price', '10.99', 'USD']),
	...over,
})

/** Narrow a result to a successful value, failing loudly if it is a rejection. */
const valueOf = (result: ReturnType<typeof parseListing>): ProductListing => {
	if (!result.ok) throw new Error(`expected ok, got problems: ${JSON.stringify(result.problems)}`)
	return result.value
}

describe('parseListing — acceptance', () => {
	test('a minimal valid listing parses, with spec defaults applied', () => {
		const result = parseListing(event())
		expect(result.ok).toBe(true)
		const listing = valueOf(result)
		expect(listing.title).toBe('Widget')
		expect(listing.price).toEqual({ amount: '10.99', currency: 'USD' })
		// Gamma defaults: type simple/digital, visibility on-sale.
		expect(listing.type).toBe('simple')
		expect(listing.format).toBe('digital')
		expect(listing.visibility).toBe('on-sale')
		// No stock tag means out of stock, matching the application's existing rule.
		expect(listing.inStock).toBe(false)
		expect(listing.coordinate).toBe(`${PRODUCT_KIND}:${PUBKEY}:widget`)
		expect(listing.dTag).toBe('widget')
		expect(listing.nsfw).toBe(false)
		expect(result.problems).toHaveLength(0)
	})

	test('unknown tags are tolerated — the spec requires it, and the old union did not allow it', () => {
		const result = parseListing(
			event({
				tags: tags(
					['d', 'widget'],
					['title', 'Widget'],
					['price', '1', 'BTC'],
					['client', 'some-client'],
					['nonce', '12345', '20'],
					['alt', 'a description nobody standardised'],
				),
			}),
		)
		expect(result.ok).toBe(true)
		expect(valueOf(result).title).toBe('Widget')
	})

	test('a noun-format frequency is rejected, because we implement Gamma not NIP-99', () => {
		// NIP-99 says "month"; Gamma says "M". Same slot, mutually unintelligible — so this is a
		// rejection rather than a silently-ignored field.
		const noun = parseListing(event({ tags: tags(['d', 'w'], ['title', 'W'], ['price', '5', 'USD', 'month']) }))
		expect(noun.ok).toBe(false)
		if (!noun.ok) expect(noun.problems[0]?.code).toBe('malformed-required-tag')

		const iso = parseListing(event({ tags: tags(['d', 'w'], ['title', 'W'], ['price', '5', 'USD', 'M']) }))
		expect(iso.ok).toBe(true)
		expect(valueOf(iso).price.frequency).toBe('M')
	})
})

describe('parseListing — required failures reject', () => {
	test('a non-event is rejected', () => {
		for (const input of [null, undefined, 42, 'nope', {}, { kind: 30402 }]) {
			const result = parseListing(input)
			expect(result.ok).toBe(false)
		}
	})

	test('the wrong kind is rejected', () => {
		const result = parseListing(event({ kind: 30405 }))
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.problems[0]?.code).toBe('wrong-kind')
	})

	test('a missing d or title is rejected, and the problem names the tag', () => {
		for (const missing of ['d', 'title'] as const) {
			const all = tags(['d', 'widget'], ['title', 'Widget'], ['price', '1', 'USD'])
			const result = parseListing(event({ tags: all.filter((t) => t[0] !== missing) }))
			expect(result.ok).toBe(false)
			if (!result.ok) {
				expect(result.problems[0]?.code).toBe('missing-required-tag')
				expect(result.problems[0]?.tag).toBe(missing)
			}
		}
	})

	test('a missing price is tolerated and named, but a malformed price is not (decision D8)', () => {
		// Absent: the listing resolves, the absence is recorded, and `price` is undefined — so the
		// surface can say "price unavailable" instead of dropping a listing a buyer can still read.
		const absent = parseListing(event({ tags: tags(['d', 'w'], ['title', 'W']) }))
		expect(absent.ok).toBe(true)
		expect(valueOf(absent).price).toBeUndefined()
		if (absent.ok) {
			expect(absent.problems).toHaveLength(1)
			expect(absent.problems[0]?.tag).toBe('price')
			expect(absent.problems[0]?.code).toBe('missing-required-tag')
		}

		// Malformed: refused, because the publisher asserted a price and we must not silently drop it.
		expect(parseListing(event({ tags: tags(['d', 'w'], ['title', 'W'], ['price', 'free', 'USD']) })).ok).toBe(false)
	})

	test('a malformed price is rejected (bad amount, bad currency)', () => {
		expect(parseListing(event({ tags: tags(['d', 'w'], ['title', 'W'], ['price', 'free', 'USD']) })).ok).toBe(false)
		expect(parseListing(event({ tags: tags(['d', 'w'], ['title', 'W'], ['price', '1', 'dollars']) })).ok).toBe(false)
	})

	test('a malformed identity is rejected', () => {
		expect(parseListing(event({ id: 'short' })).ok).toBe(false)
		expect(parseListing(event({ pubkey: 'Z'.repeat(64) })).ok).toBe(false)
		expect(parseListing(event({ created_at: 0 })).ok).toBe(false)
	})
})

describe('parseListing — optional failures are recorded, not fatal', () => {
	test('a malformed optional tag leaves the listing valid and names the field', () => {
		const result = parseListing(
			event({
				tags: tags(['d', 'w'], ['title', 'W'], ['price', '1', 'USD'], ['weight', 'heavy', 'kg']),
			}),
		)
		expect(result.ok).toBe(true)
		expect(valueOf(result).weight).toBeUndefined()
		if (result.ok) {
			expect(result.problems).toHaveLength(1)
			expect(result.problems[0]?.code).toBe('malformed-optional-tag')
			expect(result.problems[0]?.field).toBe('weight')
		}
	})

	test('a duplicate required tag is recorded and the first is used', () => {
		const result = parseListing(event({ tags: tags(['d', 'first'], ['d', 'second'], ['title', 'W'], ['price', '1', 'USD']) }))
		expect(result.ok).toBe(true)
		expect(valueOf(result).dTag).toBe('first')
		if (result.ok) expect(result.problems.some((p) => p.code === 'duplicate-tag')).toBe(true)
	})
})

describe('parseListing — NSFW', () => {
	test('content-warning=nsfw sets the flag', () => {
		const result = parseListing(event({ tags: tags(['d', 'w'], ['title', 'W'], ['price', '1', 'USD'], ['content-warning', 'nsfw']) }))
		expect(valueOf(result).nsfw).toBe(true)
		expect(result.ok && result.problems).toHaveLength(0)
	})

	test('an unrecognised warning value is recorded, and is not silently treated as safe', () => {
		const result = parseListing(event({ tags: tags(['d', 'w'], ['title', 'W'], ['price', '1', 'USD'], ['content-warning', 'sensitive']) }))
		expect(result.ok).toBe(true)
		expect(valueOf(result).nsfw).toBe(false)
		if (result.ok) {
			expect(result.problems[0]?.code).toBe('unrecognised-warning-value')
		}
	})
})

describe('parseListing — currency (decision D7, driven by live data)', () => {
	test('accepts SATS and USDC, which real publishers emit and the old rule rejected', () => {
		// Measured: 30 of ~60 live listings were rejected solely by the old /^[A-Z]{3}$/ rule,
		// on tags like ["price","40000","SATS"].
		for (const [amount, currency] of [
			['40000', 'SATS'],
			['5', 'USDC'],
			['10.99', 'USD'],
		] as const) {
			const result = parseListing(event({ tags: tags(['d', 'w'], ['title', 'W'], ['price', amount, currency]) }))
			expect(result.ok).toBe(true)
			expect(valueOf(result).price).toEqual({ amount, currency })
		}
	})

	test('accepts NIP-99\u2019s own lowercase examples, which the old rule also rejected', () => {
		for (const currency of ['btc', 'eth']) {
			const result = parseListing(event({ tags: tags(['d', 'w'], ['title', 'W'], ['price', '0.5', currency]) }))
			expect(result.ok).toBe(true)
		}
	})

	test('preserves the published case rather than normalising it', () => {
		const result = parseListing(event({ tags: tags(['d', 'w'], ['title', 'W'], ['price', '1', 'sats']) }))
		expect(valueOf(result).price.currency).toBe('sats')
	})

	test('still rejects nonsense currency values', () => {
		for (const currency of ['', 'US', 'DOLLARS', '12', 'U$D']) {
			expect(parseListing(event({ tags: tags(['d', 'w'], ['title', 'W'], ['price', '1', currency]) })).ok).toBe(false)
		}
	})
})

describe('deriveInStock — preserves the application rule exactly', () => {
	test('pre-order is always in stock', () => {
		expect(deriveInStock(undefined, 'pre-order')).toBe(true)
		expect(deriveInStock(0, 'pre-order')).toBe(true)
	})
	test('no stock tag is out of stock', () => {
		expect(deriveInStock(undefined, 'on-sale')).toBe(false)
	})
	test('stock must be greater than zero', () => {
		expect(deriveInStock(0, 'on-sale')).toBe(false)
		expect(deriveInStock(1, 'on-sale')).toBe(true)
	})
})

describe('parseListing — collection structure', () => {
	test('image order sorts lowest first and unordered last (the original comparator was not total)', () => {
		const result = parseListing(
			event({
				tags: tags(
					['d', 'w'],
					['title', 'W'],
					['price', '1', 'USD'],
					['image', 'https://example.com/c.png', '', '10'],
					['image', 'https://example.com/a.png', '', '1'],
					['image', 'https://example.com/d.png'],
					['image', 'https://example.com/b.png', '', '5'],
				),
			}),
		)
		expect(valueOf(result).images.map((i) => i.url)).toEqual([
			'https://example.com/a.png',
			'https://example.com/b.png',
			'https://example.com/c.png',
			'https://example.com/d.png',
		])
	})

	test('a→30405 becomes a collection reference and a→30402 becomes the parent', () => {
		const parent = `30402:${PUBKEY}:base-product`
		const collection = `30405:${PUBKEY}:summer`
		const result = parseListing(
			event({
				tags: tags(['d', 'w'], ['title', 'W'], ['price', '1', 'USD'], ['a', collection], ['a', parent], ['t', 'tools']),
			}),
		)
		const listing = valueOf(result)
		expect(listing.references.collections).toEqual([collection])
		expect(listing.references.parent).toBe(parent)
		expect(listing.categories).toEqual(['tools'])
	})

	test('a second parent reference is recorded as a duplicate', () => {
		const result = parseListing(
			event({
				tags: tags(['d', 'w'], ['title', 'W'], ['price', '1', 'USD'], ['a', `30402:${PUBKEY}:one`], ['a', `30402:${PUBKEY}:two`]),
			}),
		)
		expect(result.ok).toBe(true)
		if (result.ok) expect(result.problems.some((p) => p.code === 'duplicate-tag')).toBe(true)
	})

	test('shipping_option keeps the reference and the optional extra cost', () => {
		const ref = `30406:${PUBKEY}:express`
		const result = parseListing(event({ tags: tags(['d', 'w'], ['title', 'W'], ['price', '1', 'USD'], ['shipping_option', ref, '2.50']) }))
		expect(valueOf(result).shippingOptions).toEqual([{ reference: ref, extraCost: '2.50' }])
	})

	test('a shipping_option pointing at the wrong kind is ignored and recorded', () => {
		const result = parseListing(
			event({ tags: tags(['d', 'w'], ['title', 'W'], ['price', '1', 'USD'], ['shipping_option', `30402:${PUBKEY}:nope`]) }),
		)
		expect(valueOf(result).shippingOptions).toEqual([])
		if (result.ok) expect(result.problems[0]?.field).toBe('shippingOptions')
	})
})
