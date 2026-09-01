import { describe, expect, test } from 'bun:test'
import {
	absolutizeImageUrl,
	buildOgMetaTagsHtml,
	buildOgProductMeta,
	escapeHtmlAttribute,
	injectIntoHead,
	renderProductPageHtml,
	truncateForMeta,
	type OgTagSourceEvent,
} from '../ogTags'

/** Minimal kind 30402 fixture builder. */
function productEvent(overrides: Partial<OgTagSourceEvent> & { tags?: string[][] } = {}): OgTagSourceEvent {
	return {
		content: overrides.content ?? 'A hand-crafted test product.',
		tags:
			overrides.tags ??
			([
				['d', 'test-product'],
				['title', 'Test Product'],
				['price', '100', 'USD'],
				['status', 'active'],
				['image', 'https://cdn.satellite.earth/first.png'],
			] as string[][]),
	}
}

const BASE_HTML = `<html>
	<head>
		<title>Plebeian Market</title>
	</head>
	<body>
		<div id="root"></div>
	</body>
</html>`

describe('buildOgProductMeta', () => {
	test('derives title, description, image, and price from tags', () => {
		const meta = buildOgProductMeta(productEvent())

		expect(meta).not.toBeNull()
		expect(meta?.title).toBe('Test Product')
		expect(meta?.description).toBe('A hand-crafted test product.')
		expect(meta?.imageUrl).toBe('https://cdn.satellite.earth/first.png')
		expect(meta?.price).toBe(100)
		expect(meta?.currency).toBe('USD')
	})

	test('returns null for NSFW products so gated content never reaches head', () => {
		const event = productEvent({
			tags: [
				['d', 'gated'],
				['title', 'Gated Product'],
				['content-warning', 'nsfw'],
			],
		})

		expect(buildOgProductMeta(event)).toBeNull()
	})

	test('falls back to Untitled Product when no title tag', () => {
		const meta = buildOgProductMeta(productEvent({ tags: [['d', 'x']] }))
		expect(meta?.title).toBe('Untitled Product')
	})

	test('omits price when the price tag is not a finite number', () => {
		const event = productEvent({
			tags: [
				['d', 'x'],
				['title', 'No Price'],
				['price', 'not-a-number', 'USD'],
			],
		})

		const meta = buildOgProductMeta(event)
		expect(meta?.price).toBeUndefined()
		expect(meta?.currency).toBe('USD')
	})

	test('picks the first image by the optional order tag', () => {
		const event = productEvent({
			tags: [
				['d', 'x'],
				['title', 'Ordered'],
				['image', 'https://cdn.satellite.earth/second.png', '800x600', '2'],
				['image', 'https://cdn.satellite.earth/first.png', '800x600', '1'],
			],
		})

		expect(buildOgProductMeta(event)?.imageUrl).toBe('https://cdn.satellite.earth/first.png')
	})
})

describe('escapeHtmlAttribute', () => {
	test('escapes ampersands, quotes, and angle brackets', () => {
		expect(escapeHtmlAttribute('a"&<b>&')).toBe('a&quot;&amp;&lt;b&gt;&amp;')
	})
})

describe('truncateForMeta', () => {
	test('returns short values unchanged', () => {
		expect(truncateForMeta('short', 160)).toBe('short')
	})

	test('truncates long values with an ellipsis without splitting emoji', () => {
		const emoji = '🌊' // astral plane: 2 UTF-16 units, 1 code point
		const value = emoji.repeat(10)
		const truncated = truncateForMeta(value, 5)

		expect(Array.from(truncated).length).toBe(8) // 5 emoji + 3-char ellipsis
		expect(truncated.endsWith('...')).toBe(true)
	})

	test('long ascii description is capped at the code point budget', () => {
		const value = 'a'.repeat(300)
		const truncated = truncateForMeta(value, 160)
		expect(truncated.length).toBe(163) // 160 chars + '...'
	})
})

describe('absolutizeImageUrl', () => {
	test('keeps absolute http(s) URLs as-is', () => {
		expect(absolutizeImageUrl('https://cdn.example.com/i.png', 'http://localhost:3333')).toBe('https://cdn.example.com/i.png')
	})

	test('prefixes origin for root-relative URLs', () => {
		expect(absolutizeImageUrl('/media/i.png', 'http://localhost:3333')).toBe('http://localhost:3333/media/i.png')
	})

	test('drops values that cannot form an absolute URL', () => {
		expect(absolutizeImageUrl('media/i.png', 'http://localhost:3333')).toBeUndefined()
		expect(absolutizeImageUrl(undefined, 'http://localhost:3333')).toBeUndefined()
	})
})

describe('buildOgMetaTagsHtml', () => {
	test('emits the full og/twitter block with image and price', () => {
		const html = buildOgMetaTagsHtml(
			{
				title: 'Test Product',
				description: 'A hand-crafted test product.',
				imageUrl: 'https://cdn.satellite.earth/first.png',
				price: 100,
				currency: 'USD',
			},
			'http://localhost:3333/products/abc',
			'http://localhost:3333',
		)

		expect(html).toContain('<meta property="og:type" content="product" />')
		expect(html).toContain('<meta property="og:title" content="Test Product" />')
		expect(html).toContain('<meta property="og:url" content="http://localhost:3333/products/abc" />')
		expect(html).toContain('<meta property="og:image" content="https://cdn.satellite.earth/first.png" />')
		expect(html).toContain('<meta property="product:price:amount" content="100" />')
		expect(html).toContain('<meta property="product:price:currency" content="USD" />')
		expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />')
		expect(html).toContain('<meta name="twitter:description" content="A hand-crafted test product. - 100 USD" />')
	})

	test('uses summary card and omits image/price tags when unavailable', () => {
		const html = buildOgMetaTagsHtml(
			{ title: 'Bare', description: 'No image' },
			'http://localhost:3333/products/abc',
			'http://localhost:3333',
		)

		expect(html).toContain('<meta name="twitter:card" content="summary" />')
		expect(html).not.toContain('og:image')
		expect(html).not.toContain('product:price:amount')
	})

	test('escapes hostile title content', () => {
		const html = buildOgMetaTagsHtml(
			{ title: '"><script>alert(1)</script>', description: 'x' },
			'http://localhost:3333/products/abc',
			'http://localhost:3333',
		)

		expect(html).not.toContain('<script>')
		expect(html).toContain('&lt;script&gt;')
	})
})

describe('injectIntoHead', () => {
	test('inserts the block immediately before </head>', () => {
		const result = injectIntoHead(BASE_HTML, '<meta property="og:title" content="X" />')

		expect(result).toContain('</title>\n	<meta property="og:title" content="X" /></head>')
	})

	test('returns the input unchanged when no head close tag exists', () => {
		expect(injectIntoHead('<html><body></body></html>', '<meta />')).toBe('<html><body></body></html>')
	})
})

describe('renderProductPageHtml', () => {
	test('server-rendered product page HTML carries og: tags', () => {
		const html = renderProductPageHtml(
			BASE_HTML,
			buildOgProductMeta(productEvent()),
			'http://localhost:3333/products/abc',
			'http://localhost:3333',
		)

		expect(html).toContain('<meta property="og:type" content="product" />')
		expect(html).toContain('<meta property="og:title" content="Test Product" />')
		expect(html).toContain('<meta property="og:image" content="https://cdn.satellite.earth/first.png" />')
		// The rest of the shell is preserved.
		expect(html).toContain('<div id="root"></div>')
	})

	test('null meta (NSFW, miss, or timeout) serves the shell untouched', () => {
		expect(renderProductPageHtml(BASE_HTML, null, 'http://x/p/1', 'http://x')).toBe(BASE_HTML)
	})
})
