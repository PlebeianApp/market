import { describe, expect, test } from 'bun:test'
import { isStorefrontBaseUrl, storefrontNameFromHostname, storefrontPublicHref } from '../storefront-url'
import { parseInstanceConfigEnvironment, resolveInstanceConfig } from '../instance-config'

describe('storefront subdomain configuration', () => {
	test('is opt-in and exposed through resolved instance config', () => {
		expect(resolveInstanceConfig(null).storefrontBaseUrl).toBeUndefined()
		const environment = parseInstanceConfigEnvironment({ INSTANCE_STOREFRONT_BASE_URL: 'https://market.example.com' })
		expect(resolveInstanceConfig(null, environment).storefrontBaseUrl).toBe('https://market.example.com')
	})

	test.each(['https://market.example.com', 'https://market.example.com:8443/', 'http://localhost:3000'])('accepts %s', (url) => {
		expect(isStorefrontBaseUrl(url)).toBe(true)
	})

	test.each([
		'http://market.example.com',
		'https://market.example.com/path',
		'https://user:pass@market.example.com',
		'https://market.example.com?name=x',
		'https://market.example.com/#x',
		'https://127.0.0.1',
		'javascript:alert(1)',
	])('rejects invalid origin %s', (url) => {
		expect(isStorefrontBaseUrl(url)).toBe(false)
		expect(() => parseInstanceConfigEnvironment({ INSTANCE_STOREFRONT_BASE_URL: url })).toThrow()
	})
})

describe('storefront hostname resolution', () => {
	test('matches only one label beneath the exact configured base', () => {
		const base = 'https://market.example.com'
		expect(storefrontNameFromHostname('farm.market.example.com', base)).toBe('farm')
		expect(storefrontNameFromHostname('FARM.market.example.com', base)).toBe('farm')
		for (const host of [
			'market.example.com',
			'farm.market.example.com.evil.test',
			'farm.other.example.com',
			'a.b.market.example.com',
			'-bad.market.example.com',
		]) {
			expect(storefrontNameFromHostname(host, base)).toBeNull()
		}
		expect(storefrontNameFromHostname('farm.localhost', 'http://localhost:3000')).toBe('farm')
		expect(storefrontNameFromHostname('farm.localhost')).toBeNull()
	})

	test('generates subdomains with configured ports and retains path-only legacy names', () => {
		expect(storefrontPublicHref('farm', 'https://market.example.com')).toBe('https://farm.market.example.com/')
		expect(storefrontPublicHref('farm', 'http://localhost:3000')).toBe('http://farm.localhost:3000/')
		expect(storefrontPublicHref('old_name', 'https://market.example.com')).toBe('https://market.example.com/old_name')
		expect(storefrontPublicHref('farm')).toBe('/farm')
	})
})
