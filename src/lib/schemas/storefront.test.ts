import { describe, expect, test } from 'bun:test'
import { parseStorefrontPage } from './storefront'

describe('parseStorefrontPage', () => {
	test('keeps valid blocks and drops unsafe or unknown blocks', () => {
		const page = parseStorefrontPage(
			JSON.stringify({
				version: 1,
				blocks: [
					{ type: 'text', text: 'Welcome' },
					{ type: 'linkList', links: [{ label: 'Shop', url: '/products' }] },
					{ type: 'text', text: '<script src="https://evil.example/x.js">' },
					{ type: 'linkList', links: [{ label: 'Bad', url: 'javascript:alert(1)' }] },
					{ type: 'unknown', value: 'ignored' },
					{ type: 'text', text: 'x'.repeat(5001) },
				],
			}),
		)

		expect(page?.blocks).toHaveLength(2)
		expect(page?.blocks[0]).toEqual({ type: 'text', text: 'Welcome' })
	})

	test('rejects malformed documents', () => {
		expect(parseStorefrontPage('{"version":2,"blocks":[]}')).toBeNull()
		expect(parseStorefrontPage('not json')).toBeNull()
	})
})
