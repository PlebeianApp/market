import { describe, expect, test } from 'bun:test'
import {
	absolutizeImageUrl,
	buildOgMetaTagsHtml,
	buildOgProductMeta,
	buildOwnedMetaEmissions,
	escapeHtmlAttribute,
	injectIntoHead,
	OG_OWNED_META_SELECTORS,
	OG_OWNED_META_TAGS,
	removeOwnedOgMetaTags,
	renderProductPageHtml,
	resolveServerOrigins,
	resolveShellUrl,
	serveProductPageWithOg,
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

describe('removeOwnedOgMetaTags', () => {
	// Minimal structural fake of document.head. Elements record their selector
	// and a removed flag; querySelectorAll(sel) returns the matching elements.
	const makeElement = (selector: string) => ({
		selector,
		removed: false,
		remove() {
			this.removed = true
		},
	})
	const makeHead = (elements: Array<ReturnType<typeof makeElement>>) => ({
		querySelectorAll(this: unknown, sel: string) {
			return elements.filter((el) => el.selector === sel && !el.removed)
		},
	})

	function ownedSelectors(elements: Array<ReturnType<typeof makeElement>>): string[] {
		return elements.map((el) => el.selector)
	}

	test('removes every owned selector including og:image', () => {
		const elements = OG_OWNED_META_SELECTORS.map((sel) => makeElement(sel))
		const head = makeHead(elements)

		const removed = removeOwnedOgMetaTags(head)

		expect(removed).toBe(OG_OWNED_META_SELECTORS.length)
		expect(elements.every((el) => el.removed)).toBe(true)
		// Keep the selector list honest: what we removed is exactly what we expected.
		expect(ownedSelectors(elements)).toEqual([...OG_OWNED_META_SELECTORS])
	})

	test('removes duplicate owned elements', () => {
		// Two clones of the same owned selector exist — both must go.
		const elements = [...OG_OWNED_META_SELECTORS, ...OG_OWNED_META_SELECTORS].map((sel) => makeElement(sel))
		const head = makeHead(elements)

		const removed = removeOwnedOgMetaTags(head)

		expect(removed).toBe(OG_OWNED_META_SELECTORS.length * 2)
		expect(elements.every((el) => el.removed)).toBe(true)
	})

	test('leaves non-owned meta untouched', () => {
		const elements = [makeElement('meta[name="viewport"]'), makeElement('meta[charset]'), makeElement('meta[name="description"]')]
		const head = makeHead(elements)

		const removed = removeOwnedOgMetaTags(head)

		expect(removed).toBe(1) // only the description meta is owned
		expect(elements.filter((el) => !el.removed)).toHaveLength(2)
		// The two non-owned elements (viewport, charset) are untouched.
		expect(elements.map((el) => el.selector)).toEqual(['meta[name="viewport"]', 'meta[charset]', 'meta[name="description"]'])
		expect(elements.every((el) => el.removed)).toBe(false)
	})

	test('on empty head returns 0 without throwing', () => {
		const head = makeHead([])
		expect(removeOwnedOgMetaTags(head)).toBe(0)
	})

	test('owned selector list covers exactly the tags useDocumentMeta writes', () => {
		const emittedKeys = buildOwnedMetaEmissions({
			title: 'T',
			description: 'D',
			image: 'https://x/i.png',
			url: 'http://localhost:34567/products/abc',
			price: 100,
			currency: 'USD',
		}).map((e) => `meta[${e.attr}="${e.key}"]` as (typeof OG_OWNED_META_SELECTORS)[number])
		for (const sel of emittedKeys) {
			expect(OG_OWNED_META_SELECTORS).toContain(sel)
		}
		// And conversely, no owned selector is orphaned.
		expect(new Set(emittedKeys).size).toBe(OG_OWNED_META_SELECTORS.length)
	})
})

describe('resolveServerOrigins / resolveShellUrl', () => {
	test('unset env resolves to the fixed loopback origin', () => {
		expect(resolveServerOrigins({}, 34567)).toEqual({
			shellOrigin: 'http://localhost:34567',
			publicOrigin: 'http://localhost:34567',
		})
		expect(resolveShellUrl({}, 34567)).toBe('http://localhost:34567/')
	})

	test('APP_SHELL_ORIGIN wins over everything and also sets public origin', () => {
		const env = { APP_SHELL_ORIGIN: 'https://shell.internal' }
		expect(resolveServerOrigins(env, 34567)).toEqual({
			shellOrigin: 'https://shell.internal',
			publicOrigin: 'https://shell.internal',
		})
		expect(resolveShellUrl(env, 34567)).toBe('https://shell.internal/')
	})

	test('APP_PUBLIC_ORIGIN overrides the canonical public origin independently', () => {
		expect(
			resolveServerOrigins({ APP_SHELL_ORIGIN: 'https://shell.internal', APP_PUBLIC_ORIGIN: 'https://market.example' }, 34567),
		).toEqual({
			shellOrigin: 'https://shell.internal',
			publicOrigin: 'https://market.example',
		})
	})

	test('garbage/whitespace env falls back to loopback', () => {
		expect(resolveServerOrigins({ APP_SHELL_ORIGIN: '   ' }, 34567).shellOrigin).toBe('http://localhost:34567')
		expect(resolveServerOrigins({ APP_SHELL_ORIGIN: '' }, 34567).publicOrigin).toBe('http://localhost:34567')
		expect(resolveShellUrl({ APP_SHELL_ORIGIN: '\n	 ' }, 34567)).toBe('http://localhost:34567/')
	})

	// The pin: the function doesn't accept a request argument, so no simulated
	// host header / request URL can change the resolved shell destination.
	test('simulated request inputs cannot redirect the shell URL', () => {
		const requestDerived = 'http://evil.example:1337'
		const env = { APP_SHELL_ORIGIN: 'https://shell.internal', APP_PUBLIC_ORIGIN: 'https://market.example' }
		const shell = resolveShellUrl(env, 34567)
		expect(shell).toBe('https://shell.internal/')
		expect(shell.startsWith(requestDerived)).toBe(false)
	})
})

describe('serveProductPageWithOg (shell acquisition)', () => {
	const SHELL = '<html><head></head><body><div id="root"></div></body></html>'
	const indexShell = () => new Response(SHELL, { headers: { 'Content-Type': 'text/html;charset=utf-8' } })

	function okFetcher(html: string) {
		return async () => ({ ok: true, text: async () => html })
	}

	test('shell fetch failure still serves 200 with the module shell (no 503)', async () => {
		const rejectingFetch = () => Promise.reject(new Error('connection refused'))
		// Stub global fetch used as the default argument when none injected:
		const res = await serveProductPageWithOg(
			'abc',
			{ shellOrigin: 'http://localhost:34567', publicOrigin: 'http://localhost:34567', relayUrl: 'ws://x', indexShell: indexShell(), getProductOgMeta: async () => null },
			rejectingFetch,
		)
		expect(res.status).toBe(200)
		expect(await res.text()).toBe(SHELL)
	})

	test('non-ok shell response serves the module shell with 200', async () => {
		const res = await serveProductPageWithOg(
			'abc',
			{ shellOrigin: 'http://localhost:34567', publicOrigin: 'http://localhost:34567', relayUrl: 'ws://x', indexShell: indexShell(), getProductOgMeta: async () => null },
			async () => ({ ok: false, status: 500, text: async () => '' }),
		)
		expect(res.status).toBe(200)
		expect(await res.text()).toBe(SHELL)
	})

	test('healthy shell fetch injects og tags with the public origin', async () => {
		const res = await serveProductPageWithOg(
			'64hexproductid0123456789abcdef0123456789abcdef0123456789abcdef',
			{
				shellOrigin: 'http://localhost:34567',
				publicOrigin: 'https://market.example',
				relayUrl: 'ws://x',
				indexShell: indexShell(),
				getProductOgMeta: async () => ({ title: 'A', description: 'B', imageUrl: '/img.png', price: 100, currency: 'USD' }),
			},
			okFetcher(SHELL),
		)
		expect(res.status).toBe(200)
		const html = await res.text()
		expect(html).toContain('<meta property="og:title" content="A" />')
		expect(html).toContain('og:url')
		expect(html).toContain('https://market.example/products/64hexproductid0123456789abcdef0123456789abcdef0123456789abcdef')
		expect(html).toContain('og:image')
		// hostile host never reaches the tags (public origin is server-controlled)
		expect(html).not.toContain('evil.example')
	})
})
