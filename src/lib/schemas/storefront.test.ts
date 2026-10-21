import { describe, expect, test } from 'bun:test'
import {
	STOREFRONT_LIMITS,
	STOREFRONT_PAGE_VERSION,
	STOREFRONT_TUNE_BOUNDS,
	STOREFRONT_TUNE_DEFAULTS,
	createEmptyStorefrontPage,
	isSafeHref,
	isSafeMediaSrc,
	parseStorefrontPage,
	validateStorefrontPageForPublish,
	type StorefrontPage,
} from './storefront'

/**
 * These tests are the enforcement of ADR-019's guardrail: "a hostile page event
 * (script URLs, `javascript:` hrefs, unknown block types, oversized payloads)
 * renders inert".
 *
 * They are written against the parser rather than the renderer because the
 * parser is the boundary — the renderer only ever sees blocks the parser has
 * already accepted, so a hostile value that cannot survive parsing cannot reach
 * the DOM by any route.
 */

function block(type: string, props: Record<string, unknown>) {
	return { type, props: { id: `${type}-1`, ...props } }
}

function documentWith(content: unknown[], extra: Record<string, unknown> = {}) {
	return JSON.stringify({ version: STOREFRONT_PAGE_VERSION, enabled: true, root: { props: {} }, content, ...extra })
}

describe('isSafeHref', () => {
	test('accepts https and in-app absolute paths', () => {
		expect(isSafeHref('https://example.com/thing')).toBe(true)
		expect(isSafeHref('/products/abc')).toBe(true)
		expect(isSafeHref('/')).toBe(true)
	})

	test('rejects script-bearing schemes', () => {
		expect(isSafeHref('javascript:alert(1)')).toBe(false)
		expect(isSafeHref('JavaScript:alert(1)')).toBe(false)
		expect(isSafeHref('vbscript:msgbox(1)')).toBe(false)
		expect(isSafeHref('data:text/html;base64,PHNjcmlwdD4=')).toBe(false)
		expect(isSafeHref('blob:https://example.com/abc')).toBe(false)
		expect(isSafeHref('file:///etc/passwd')).toBe(false)
	})

	test('rejects schemes obfuscated with control characters and whitespace', () => {
		// A browser strips these before resolving the scheme, so a naive
		// startsWith check would pass them straight through.
		expect(isSafeHref('java\tscript:alert(1)')).toBe(false)
		expect(isSafeHref('java\nscript:alert(1)')).toBe(false)
		expect(isSafeHref('  javascript:alert(1)')).toBe(false)
		// Constructed from char codes: a literal NUL byte in source is fragile
		// and does not survive formatting.
		expect(isSafeHref(String.fromCharCode(0) + 'javascript:alert(1)')).toBe(false)
		expect(isSafeHref(String.fromCharCode(1, 2, 3) + 'javascript:alert(1)')).toBe(false)
	})

	test('rejects protocol-relative URLs, which silently leave the app', () => {
		expect(isSafeHref('//evil.example/phish')).toBe(false)
	})

	test('rejects plaintext http and non-strings', () => {
		expect(isSafeHref('http://example.com')).toBe(false)
		expect(isSafeHref(null)).toBe(false)
		expect(isSafeHref(undefined)).toBe(false)
		expect(isSafeHref(42)).toBe(false)
		expect(isSafeHref('')).toBe(false)
	})

	test('rejects oversized URLs', () => {
		expect(isSafeHref(`https://example.com/${'a'.repeat(STOREFRONT_LIMITS.maxUrlLength)}`)).toBe(false)
	})

	test('media sources use the same gate', () => {
		expect(isSafeMediaSrc('https://cdn.example/img.png')).toBe(true)
		expect(isSafeMediaSrc('javascript:alert(1)')).toBe(false)
		expect(isSafeMediaSrc('data:image/svg+xml,<svg onload=alert(1)>')).toBe(false)
	})
})

describe('parseStorefrontPage — hostile documents render inert', () => {
	test('drops a link block carrying a javascript: href', () => {
		const raw = documentWith([
			block('LinkList', {
				title: 'Links',
				layout: 'row',
				links: [{ label: 'Click me', href: 'javascript:alert(document.cookie)' }],
			}),
		])

		const result = parseStorefrontPage(raw)
		expect(result.error).toBeNull()
		expect(result.page?.content).toHaveLength(0)
		expect(result.droppedBlocks).toBe(1)
	})

	test('drops an image block pointing at a data: URI', () => {
		const raw = documentWith([
			block('Image', { url: 'data:text/html,<script>alert(1)</script>', alt: '', width: 'normal', rounded: true, href: '' }),
		])

		const result = parseStorefrontPage(raw)
		expect(result.page?.content).toHaveLength(0)
		expect(result.droppedBlocks).toBe(1)
	})

	test('drops an unknown block type but keeps the rest of the page', () => {
		const raw = documentWith([
			block('Text', { markdown: 'kept', align: 'left', width: 'normal' }),
			block('RemoteScript', { src: 'https://evil.example/x.js' }),
			block('Divider', {}),
		])

		const result = parseStorefrontPage(raw)
		expect(result.page?.content.map((b) => b.type)).toEqual(['Text', 'Divider'])
		expect(result.droppedBlocks).toBe(1)
	})

	test('truncates an oversized block list instead of rendering it', () => {
		const tooMany = Array.from({ length: STOREFRONT_LIMITS.maxBlocks + 25 }, (_, i) => ({
			type: 'Divider',
			props: { id: `d-${i}` },
		}))

		const result = parseStorefrontPage(documentWith(tooMany))
		expect(result.page?.content).toHaveLength(STOREFRONT_LIMITS.maxBlocks)
		expect(result.droppedBlocks).toBe(25)
	})

	test('drops text longer than the limit rather than truncating it silently', () => {
		const raw = documentWith([block('Text', { markdown: 'a'.repeat(STOREFRONT_LIMITS.maxTextLength + 1), align: 'left', width: 'normal' })])
		expect(parseStorefrontPage(raw).page?.content).toHaveLength(0)
	})

	test('a prop that is an object where a string is expected does not crash the parser', () => {
		const raw = documentWith([block('Hero', { title: { toString: 'nope' }, subtitle: [], minHeight: 'tall' })])
		const result = parseStorefrontPage(raw)
		expect(result.error).toBeNull()
		expect(result.page?.content).toHaveLength(0)
	})
})

describe('parseStorefrontPage — malformed documents fall back rather than throw', () => {
	test('returns an error for non-JSON content', () => {
		const result = parseStorefrontPage('this is not json')
		expect(result.page).toBeNull()
		expect(result.error).toBeTruthy()
	})

	test('returns an error for empty or missing content', () => {
		expect(parseStorefrontPage('').page).toBeNull()
		expect(parseStorefrontPage(null).page).toBeNull()
		expect(parseStorefrontPage(undefined).page).toBeNull()
	})

	test('rejects a document declaring an unknown version', () => {
		const raw = JSON.stringify({ version: 99, enabled: true, root: { props: {} }, content: [] })
		expect(parseStorefrontPage(raw).page).toBeNull()
	})

	test('rejects a JSON array where a document object is expected', () => {
		expect(parseStorefrontPage('[]').page).toBeNull()
	})
})

describe('parseStorefrontPage — valid documents', () => {
	test('applies schema defaults to omitted props', () => {
		const raw = documentWith([{ type: 'ProfileHeader', props: { id: 'p1' } }])
		const page = parseStorefrontPage(raw).page
		expect(page?.content[0]).toEqual({
			type: 'ProfileHeader',
			props: { id: 'p1', showBanner: true, fullScreen: false, showAbout: true, showNip05: true, align: 'center' },
		})
	})

	test('preserves the full-screen profile header option', () => {
		const raw = documentWith([block('ProfileHeader', { fullScreen: true })])
		expect(parseStorefrontPage(raw).page?.content[0]?.props).toMatchObject({ fullScreen: true })
	})

	test('preserves the enabled flag, which decides whether the page is shown', () => {
		expect(parseStorefrontPage(documentWith([], { enabled: false })).page?.enabled).toBe(false)
		expect(parseStorefrontPage(documentWith([], { enabled: true })).page?.enabled).toBe(true)
	})

	test('accepts safe https and in-app links', () => {
		const raw = documentWith([
			block('LinkList', {
				title: 'Links',
				layout: 'row',
				links: [
					{ label: 'Site', href: 'https://example.com' },
					{ label: 'Shop', href: '/products' },
				],
			}),
		])
		const page = parseStorefrontPage(raw).page
		expect(page?.content).toHaveLength(1)
	})

	test('accepts a valid theme id on the root', () => {
		const raw = JSON.stringify({ version: STOREFRONT_PAGE_VERSION, enabled: true, root: { props: { theme: 'midnight' } }, content: [] })
		expect(parseStorefrontPage(raw).page?.root.props.theme).toBe('midnight')
	})
})

describe('parseStorefrontPage — a bad root prop falls back to its default, the page still renders', () => {
	test('an unknown theme id does not take down the whole document', () => {
		const raw = JSON.stringify({
			version: STOREFRONT_PAGE_VERSION,
			enabled: true,
			root: { props: { theme: 'rainbow-explosion-9000' } },
			content: [block('Text', { markdown: 'still here' })],
		})

		const result = parseStorefrontPage(raw)
		expect(result.error).toBeNull()
		expect(result.page?.root.props.theme).toBe('default')
		expect(result.page?.content).toHaveLength(1)
	})

	test('a non-string theme value falls back the same way', () => {
		const raw = JSON.stringify({ version: STOREFRONT_PAGE_VERSION, enabled: true, root: { props: { theme: 42 } }, content: [] })
		expect(parseStorefrontPage(raw).page?.root.props.theme).toBe('default')
	})

	test('a missing root object entirely still parses, using every default', () => {
		const raw = JSON.stringify({ version: STOREFRONT_PAGE_VERSION, enabled: true, content: [] })
		const page = parseStorefrontPage(raw).page
		expect(page?.root.props).toEqual({ title: '', theme: 'default', palette: '', tune: STOREFRONT_TUNE_DEFAULTS })
	})

	describe('theme tune and palette — the theme-config half of a page', () => {
		const doc = (props: Record<string, unknown>) =>
			JSON.stringify({ version: STOREFRONT_PAGE_VERSION, enabled: true, root: { props }, content: [] })

		test('a page with no tune gets the declared defaults', () => {
			expect(parseStorefrontPage(doc({ theme: 'pleb' })).page?.root.props.tune).toEqual(STOREFRONT_TUNE_DEFAULTS)
		})

		test('a layout, palette and tune from the closed sets survive a round trip', () => {
			const tune = { radiusPx: 20, shadow: 1, glass: 0, spacing: 1.45, texture: 0.5, handmade: 0.25 }
			const parsed = parseStorefrontPage(doc({ theme: 'pleb', palette: 'night-market', tune })).page?.root.props
			expect(parsed?.theme).toBe('pleb')
			expect(parsed?.palette).toBe('night-market')
			expect(parsed?.tune).toEqual(tune)
		})

		test('an out-of-range tune value is clamped, not rejected — the page keeps its theme and its title', () => {
			const raw = doc({ title: 'My shop', theme: 'brut', tune: { radiusPx: 9999, shadow: -5, spacing: 99 } })
			const parsed = parseStorefrontPage(raw).page?.root.props
			expect(parsed?.title).toBe('My shop')
			expect(parsed?.theme).toBe('brut')
			expect(parsed?.tune.radiusPx).toBe(STOREFRONT_TUNE_BOUNDS.radiusPx.max)
			expect(parsed?.tune.shadow).toBe(STOREFRONT_TUNE_BOUNDS.shadow.min)
			expect(parsed?.tune.spacing).toBe(STOREFRONT_TUNE_BOUNDS.spacing.max)
		})

		test('a non-numeric tune value falls back per axis rather than throwing', () => {
			const raw = doc({ theme: 'art', tune: { radiusPx: 'round please', shadow: null } })
			expect(parseStorefrontPage(raw).page?.root.props.tune).toEqual(STOREFRONT_TUNE_DEFAULTS)
		})

		test('a partially specified tune keeps the axes it names and defaults the rest', () => {
			const tune = parseStorefrontPage(doc({ theme: 'art', tune: { radiusPx: 4 } })).page?.root.props.tune
			expect(tune?.radiusPx).toBe(4)
			expect(tune?.glass).toBe(STOREFRONT_TUNE_DEFAULTS.glass)
		})

		test('an unknown palette key costs only the palette, never the rest of the root props', () => {
			const parsed = parseStorefrontPage(doc({ title: 'kept', theme: 'farm', palette: 'not-a-palette' })).page?.root.props
			expect(parsed?.title).not.toBe('')
			expect(parsed?.theme).toBe('farm')
		})

		test('a page published before palettes existed still validates unchanged', () => {
			const parsed = parseStorefrontPage(doc({ title: 'old page', theme: 'midnight' })).page?.root.props
			expect(parsed?.theme).toBe('midnight')
			expect(parsed?.palette).toBe('')
			expect(parsed?.tune).toEqual(STOREFRONT_TUNE_DEFAULTS)
		})
	})

	test('a non-boolean enabled value is treated as false — the safer reading, not a thrown error', () => {
		const raw = JSON.stringify({ version: STOREFRONT_PAGE_VERSION, enabled: 'yes-please', root: { props: {} }, content: [] })
		const result = parseStorefrontPage(raw)
		expect(result.error).toBeNull()
		expect(result.page?.enabled).toBe(false)
	})

	test('a non-array content value is treated as an empty page rather than failing', () => {
		const raw = JSON.stringify({ version: STOREFRONT_PAGE_VERSION, enabled: true, root: { props: {} }, content: 'not-an-array' })
		const result = parseStorefrontPage(raw)
		expect(result.error).toBeNull()
		expect(result.page?.content).toEqual([])
	})
})

describe('validateStorefrontPageForPublish — the author is told, not silently trimmed', () => {
	test('reports an unsafe href instead of dropping the block', () => {
		const page = {
			...createEmptyStorefrontPage(),
			content: [block('LinkList', { title: '', layout: 'row', links: [{ label: 'x', href: 'javascript:alert(1)' }] })],
		}

		const result = validateStorefrontPageForPublish(page)
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.errors).toHaveLength(1)
			expect(result.errors[0]).toContain('LinkList')
		}
	})

	test('names the offending block by position and type', () => {
		const page = {
			...createEmptyStorefrontPage(),
			content: [block('Divider', {}), block('Image', { url: 'javascript:alert(1)' })],
		}

		const result = validateStorefrontPageForPublish(page)
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.errors[0]).toContain('Block 2 (Image)')
	})

	test('accepts a well-formed page and returns the normalised document', () => {
		const page: StorefrontPage = {
			...createEmptyStorefrontPage(),
			enabled: true,
			content: [block('Text', { markdown: '# Hi' }) as never],
		}

		const result = validateStorefrontPageForPublish(page)
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.page.enabled).toBe(true)
			expect(result.page.content[0].props).toMatchObject({ markdown: '# Hi', align: 'left', width: 'normal' })
		}
	})

	test('refuses a page over the block limit', () => {
		const page = {
			...createEmptyStorefrontPage(),
			content: Array.from({ length: STOREFRONT_LIMITS.maxBlocks + 1 }, (_, i) => ({ type: 'Divider', props: { id: `d-${i}` } })),
		}
		expect(validateStorefrontPageForPublish(page).ok).toBe(false)
	})
})

describe('round trip', () => {
	test('a published document parses back to what was validated', () => {
		const page = {
			...createEmptyStorefrontPage(),
			enabled: true,
			content: [
				block('Hero', { title: 'Shop', subtitle: 'Nice things', ctaLabel: 'Browse', ctaHref: '/products' }),
				block('ProductGrid', { title: 'All', source: 'all', limit: 6, columns: 3 }),
			],
		}

		const validated = validateStorefrontPageForPublish(page)
		expect(validated.ok).toBe(true)
		if (!validated.ok) return

		const reparsed = parseStorefrontPage(JSON.stringify(validated.page))
		expect(reparsed.droppedBlocks).toBe(0)
		expect(reparsed.page).toEqual(validated.page)
	})
})
