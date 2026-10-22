import { describe, expect, test } from 'bun:test'
import type { NostrEvent } from '@/lib/nostr/io'
import {
	NSITE_PAGE_KIND,
	buildNsitePageTemplate,
	isBlossomServerUrl,
	isNsitePath,
	isSha256Hex,
	nsiteCoordinate,
	parseNsitePageEvent,
} from './nsitePage'

const VALID_SHA = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'

function event(overrides: Partial<NostrEvent> = {}): NostrEvent {
	return {
		id: 'e'.repeat(64),
		pubkey: 'a'.repeat(64),
		created_at: 1_700_000_000,
		kind: NSITE_PAGE_KIND,
		tags: [
			['d', '/about'],
			['sha256', VALID_SHA],
			['alt', 'Static page for /about'],
			['relay', 'https://blossom.primal.net'],
		],
		content: '# About us',
		sig: 'f'.repeat(128),
		...overrides,
	} as NostrEvent
}

describe('isSha256Hex', () => {
	test('accepts a lowercase 64-character digest', () => {
		expect(isSha256Hex(VALID_SHA)).toBe(true)
	})
	test('rejects uppercase, short, long, and non-hex', () => {
		expect(isSha256Hex(VALID_SHA.toUpperCase())).toBe(false)
		expect(isSha256Hex(VALID_SHA.slice(0, 63))).toBe(false)
		expect(isSha256Hex(`${VALID_SHA}0`)).toBe(false)
		expect(isSha256Hex('z'.repeat(64))).toBe(false)
		expect(isSha256Hex(undefined)).toBe(false)
	})
})

describe('isBlossomServerUrl', () => {
	test('accepts a plain https origin', () => {
		expect(isBlossomServerUrl('https://blossom.primal.net')).toBe(true)
		expect(isBlossomServerUrl('https://blossom.primal.net/')).toBe(true)
	})
	test('rejects http, protocol-relative, credentials, query and fragment', () => {
		expect(isBlossomServerUrl('http://blossom.primal.net')).toBe(false)
		expect(isBlossomServerUrl('//blossom.primal.net')).toBe(false)
		expect(isBlossomServerUrl('https://user:pass@blossom.primal.net')).toBe(false)
		expect(isBlossomServerUrl('https://blossom.primal.net/?x=1')).toBe(false)
		expect(isBlossomServerUrl('https://blossom.primal.net/#f')).toBe(false)
		expect(isBlossomServerUrl('javascript:alert(1)')).toBe(false)
	})
})

describe('isNsitePath', () => {
	test('accepts ordinary absolute paths', () => {
		expect(isNsitePath('/about')).toBe(true)
		expect(isNsitePath('/about-us/team')).toBe(true)
		expect(isNsitePath('/')).toBe(true)
	})
	test('rejects relative, protocol-relative, traversal and control characters', () => {
		expect(isNsitePath('about')).toBe(false)
		expect(isNsitePath('//evil.example')).toBe(false)
		expect(isNsitePath('/../../etc/passwd')).toBe(false)
		expect(isNsitePath('/a b')).toBe(false)
		expect(isNsitePath('/a\tb')).toBe(false)
		expect(isNsitePath(`/${'x'.repeat(300)}`)).toBe(false)
		expect(isNsitePath(undefined)).toBe(false)
	})
})

describe('parseNsitePageEvent', () => {
	test('parses a well-formed page, including the addressable coordinate', () => {
		const { page, error, warnings } = parseNsitePageEvent(event())
		expect(error).toBeNull()
		expect(warnings).toHaveLength(0)
		expect(page?.path).toBe('/about')
		expect(page?.sha256).toBe(VALID_SHA)
		expect(page?.relays).toEqual(['https://blossom.primal.net'])
		expect(page?.content).toBe('# About us')
		expect(page?.onHomepage).toBe(false)
		expect(page?.coordinate).toBe(nsiteCoordinate('a'.repeat(64), '/about'))
	})

	test('refuses the wrong kind', () => {
		expect(parseNsitePageEvent(event({ kind: 30024 })).error).toContain('Not an nsite page event')
	})

	test('refuses an event with no usable path — there is nothing to address', () => {
		expect(parseNsitePageEvent(event({ tags: [['sha256', VALID_SHA]] })).error).toContain('no usable path')
		expect(parseNsitePageEvent(event({ tags: [['d', '../../etc/passwd']] })).error).toContain('no usable path')
		expect(parseNsitePageEvent(event({ tags: [['d', 'about']] })).error).toContain('no usable path')
	})

	test('a malformed sha256 costs the digest, not the page', () => {
		const { page, error, warnings } = parseNsitePageEvent(
			event({
				tags: [
					['d', '/about'],
					['sha256', 'nope'],
				],
			}),
		)
		expect(error).toBeNull()
		expect(page?.sha256).toBeNull()
		expect(warnings).toContain('Ignored a malformed `sha256` tag')
	})

	test('drops relay tags that are not https origins, and keeps the rest', () => {
		const tags = [
			['d', '/about'],
			['relay', 'http://insecure.example'],
			['relay', 'https://blossom.primal.net'],
			['relay', '//protocol-relative.example'],
			['relay', 'https://blossom.band'],
		]
		const { page } = parseNsitePageEvent(event({ tags }))
		expect(page?.relays).toEqual(['https://blossom.primal.net', 'https://blossom.band'])
	})

	test('de-duplicates repeated relay tags', () => {
		const tags = [
			['d', '/a'],
			['relay', 'https://x.example'],
			['relay', 'https://x.example'],
		]
		expect(parseNsitePageEvent(event({ tags })).page?.relays).toEqual(['https://x.example'])
	})

	test('reads homepage_section', () => {
		const tags = [
			['d', '/a'],
			['homepage_section', 'true'],
		]
		expect(parseNsitePageEvent(event({ tags })).page?.onHomepage).toBe(true)
		const other = [
			['d', '/a'],
			['homepage_section', 'false'],
		]
		expect(parseNsitePageEvent(event({ tags: other })).page?.onHomepage).toBe(false)
	})

	test('truncates an oversized body rather than rejecting the page', () => {
		const { page, warnings } = parseNsitePageEvent(event({ content: 'x'.repeat(200_000) }))
		expect(page?.content.length).toBe(100_000)
		expect(warnings).toContain('Truncated an oversized page body')
	})

	test('handles a null event without throwing', () => {
		expect(parseNsitePageEvent(null).error).toBe('No event')
		expect(parseNsitePageEvent(undefined).page).toBeNull()
	})
})

describe('buildNsitePageTemplate', () => {
	test('emits the same tag order nostr-cms emits, so a diff shows only values', () => {
		const template = buildNsitePageTemplate({
			path: '/about',
			content: '# About us',
			sha256: VALID_SHA,
			relays: ['https://blossom.primal.net'],
			onHomepage: true,
		})
		expect(template.kind).toBe(NSITE_PAGE_KIND)
		expect(template.content).toBe('# About us')
		expect(template.tags).toEqual([
			['d', '/about'],
			['sha256', VALID_SHA],
			['alt', 'Static page for /about'],
			['relay', 'https://blossom.primal.net'],
			['homepage_section', 'true'],
		])
	})

	test('omits homepage_section unless asked, and defaults alt', () => {
		const template = buildNsitePageTemplate({ path: '/contact', content: 'hi', sha256: VALID_SHA })
		expect(template.tags).toEqual([
			['d', '/contact'],
			['sha256', VALID_SHA],
			['alt', 'Static page for /contact'],
		])
	})

	test('refuses to build a template from an unusable path or digest', () => {
		expect(() => buildNsitePageTemplate({ path: '../../x', content: '', sha256: VALID_SHA })).toThrow()
		expect(() => buildNsitePageTemplate({ path: '/ok', content: '', sha256: 'short' })).toThrow()
		expect(() => buildNsitePageTemplate({ path: '/ok', content: '', sha256: VALID_SHA, relays: ['http://x.example'] })).toThrow()
	})

	test('round-trips: what we build, the parser accepts', () => {
		const template = buildNsitePageTemplate({
			path: '/round-trip',
			content: 'body',
			sha256: VALID_SHA,
			relays: ['https://blossom.band'],
			onHomepage: true,
		})
		const { page, error } = parseNsitePageEvent(event({ tags: template.tags, content: template.content, kind: template.kind }))
		expect(error).toBeNull()
		expect(page?.path).toBe('/round-trip')
		expect(page?.relays).toEqual(['https://blossom.band'])
		expect(page?.onHomepage).toBe(true)
	})
})
