/**
 * Unit tests for multi-relay fallback logic in ogMeta.ts.
 *
 * These tests verify:
 * - buildRelayList assembles the correct ordered relay list (primary → env fallbacks → defaults)
 * - tryRelaysInOrder tries relays sequentially and returns the first success
 * - When all relays fail, null is returned → graceful degradation (SPA shell without og tags)
 */
import { describe, expect, mock, test } from 'bun:test'
import { buildRelayList, tryRelaysInOrder } from '../../server/ogMeta'
import { buildOgProductMeta, renderProductPageHtml, type OgTagSourceEvent } from '../ogTags'

const BASE_HTML = `<html>
	<head>
		<title>Plebeian Market</title>
	</head>
	<body>
		<div id="root"></div>
	</body>
</html>`

const PRODUCT_EVENT: OgTagSourceEvent = {
	content: 'A hand-crafted test product.',
	tags: [
		['d', 'test-product'],
		['title', 'Test Product'],
		['price', '100', 'USD'],
		['status', 'active'],
		['image', 'https://cdn.satellite.earth/first.png'],
	],
}

describe('buildRelayList', () => {
	test('primary first, then env fallbacks, then defaults', () => {
		const list = buildRelayList('wss://primary.example.com', 'wss://fb1.example.com,wss://fb2.example.com')
		expect(list[0]).toBe('wss://primary.example.com')
		expect(list[1]).toBe('wss://fb1.example.com')
		expect(list[2]).toBe('wss://fb2.example.com')
		// defaults come after the explicit relays
		expect(list.length).toBeGreaterThan(3)
	})

	test('deduplicates relays (primary appearing in fallbacks is not repeated)', () => {
		const list = buildRelayList('wss://primary.example.com', 'wss://primary.example.com,wss://fb1.example.com')
		const unique = new Set(list)
		expect(list.length).toBe(unique.size)
		expect(list[0]).toBe('wss://primary.example.com')
	})

	test('uses defaults when no primary and no fallbacks configured', () => {
		const list = buildRelayList(undefined, undefined)
		expect(list.length).toBeGreaterThan(0)
		// Every entry should be a well-known default
		for (const url of list) {
			expect(url).toMatch(/^wss:\/\//)
		}
	})

	test('excludes undefined/empty primary, starts with fallbacks', () => {
		const list = buildRelayList(undefined, 'wss://fb1.example.com')
		expect(list[0]).toBe('wss://fb1.example.com')
	})

	test('trims whitespace in fallback env values', () => {
		const list = buildRelayList('wss://primary.example.com', ' wss://fb1.example.com , wss://fb2.example.com ')
		expect(list).toContain('wss://fb1.example.com')
		expect(list).toContain('wss://fb2.example.com')
	})
})

describe('tryRelaysInOrder', () => {
	test('primary relay down → fallback relay used → OG tags present', async () => {
		// Simulate: first relay fails (returns null), second succeeds (returns event)
		const fetchFn = mock((url: string): Promise<unknown> => {
			if (url === 'wss://primary.example.com') return Promise.resolve(null)
			if (url === 'wss://fb1.example.com') return Promise.resolve(PRODUCT_EVENT)
			return Promise.resolve(null)
		})

		const event = await tryRelaysInOrder(['wss://primary.example.com', 'wss://fb1.example.com'], fetchFn)

		expect(event).not.toBeNull()
		expect(fetchFn).toHaveBeenCalledTimes(2)

		// Verify OG tags are present when meta is built from the returned event
		const meta = buildOgProductMeta(event as OgTagSourceEvent)
		expect(meta).not.toBeNull()
		expect(meta?.title).toBe('Test Product')

		const html = renderProductPageHtml(BASE_HTML, meta, 'http://localhost:3333/products/abc', 'http://localhost:3333')
		expect(html).toContain('<meta property="og:title" content="Test Product" />')
		expect(html).toContain('<meta property="og:type" content="product" />')
		expect(html).toContain('<div id="root"></div>')
	})

	test('all relays down → null returned → SPA HTML unchanged (no og tags)', async () => {
		const fetchFn = mock((): Promise<unknown> => Promise.resolve(null))

		const event = await tryRelaysInOrder(['wss://primary.example.com', 'wss://fb1.example.com', 'wss://fb2.example.com'], fetchFn)

		expect(event).toBeNull()
		expect(fetchFn).toHaveBeenCalledTimes(3)

		// When meta is null, renderProductPageHtml returns baseHtml unchanged
		const html = renderProductPageHtml(BASE_HTML, null, 'http://localhost:3333/products/abc', 'http://localhost:3333')
		expect(html).toBe(BASE_HTML)
		expect(html).not.toContain('og:title')
		expect(html).not.toContain('og:type')
	})
})
