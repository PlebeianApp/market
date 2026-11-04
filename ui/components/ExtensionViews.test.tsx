import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PublicExtensionDescriptor } from '@sdk/core/extensions'
import { ExtensionCard, ExtensionLogo, ExtensionsEmptyState, ImageDescribePanel } from './ExtensionViews'

const descriptor: PublicExtensionDescriptor = {
	id: 'product-image-describer',
	version: '0.1.0',
	displayName: 'Product image describer',
	icon: '/images/extension-product-image-describer.svg',
	capabilities: ['product.image.describe'],
	config: { maxChars: 600 },
	actions: [
		{
			name: 'describe-image',
			description: 'Draft a description',
			auth: 'user',
			rateLimit: { perPubkey: 30, windowSeconds: 3600 },
			transports: ['http'],
		},
	],
}

describe('extension views', () => {
	test('card shows logo, name, version, capabilities, and action limits', () => {
		const markup = renderToStaticMarkup(<ExtensionCard descriptor={descriptor} />)
		expect(markup).toContain('src="/images/extension-product-image-describer.svg"')
		expect(markup).toContain('alt="Product image describer logo"')
		expect(markup).toContain('v0.1.0')
		expect(markup).toContain('product.image.describe')
		expect(markup).toContain('30 calls per hour')
	})

	test('logo falls back to a placeholder without an icon', () => {
		const markup = renderToStaticMarkup(<ExtensionLogo name="x" />)
		expect(markup).not.toContain('<img')
		expect(markup).toContain('aria-hidden="true"')
	})

	test('empty state explains how operators enable extensions', () => {
		expect(renderToStaticMarkup(<ExtensionsEmptyState envExample="EXTENSION_X_ENABLED=true" />)).toContain('EXTENSION_X_ENABLED=true')
	})

	test('describe panel labels mock output and renders it as text, not HTML', () => {
		const markup = renderToStaticMarkup(
			<ImageDescribePanel
				pending={false}
				onDescribe={() => {}}
				result={{ description: '<b>bold</b> mug', provider: 'mock', mock: true }}
				errorMessage="Too many requests."
			/>,
		)
		expect(markup).toContain('Mock-up — no image analysis')
		expect(markup).toContain('&lt;b&gt;bold&lt;/b&gt; mug')
		expect(markup).toContain('Too many requests.')
	})
})
