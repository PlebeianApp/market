import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PublicExtensionDescriptor } from '@sdk/core/extensions'
import {
	ExtensionCard,
	ExtensionLogo,
	ExtensionsEmptyState,
	ExtensionStoreButton,
	ExtensionStoreEntry,
	ImageDescribePanel,
	RepositoryEntryCard,
	RepositorySection,
} from './ExtensionViews'
import { SettingsPageHeader } from './OperatorSettingsViews'

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

describe('extension store views', () => {
	const entry = {
		id: 'product-image-describer',
		version: '0.1.0',
		displayName: 'Product image describer',
		icon: '/images/extension-product-image-describer.svg',
		description: 'Drafts a description.',
		capabilities: ['product.image.describe'],
		runtimes: ['server'],
		hostPorts: [],
		egress: [],
		actions: [],
		hasPrivateConfig: false,
		state: 'available',
		managedBy: 'environment',
		envPrefix: 'EXTENSION_PRODUCT_IMAGE_DESCRIBER_',
	} as const

	test('store entry shows logo, state, permissions, and how to enable', () => {
		const markup = renderToStaticMarkup(<ExtensionStoreEntry entry={entry} />)
		expect(markup).toContain('src="/images/extension-product-image-describer.svg"')
		expect(markup).toContain('Available')
		expect(markup).toContain('No relay, network, or storage access.')
		expect(markup).toContain('EXTENSION_PRODUCT_IMAGE_DESCRIBER_ENABLED=true')
	})

	test('enabled entries omit enable instructions; misconfigured ones show the problem', () => {
		expect(renderToStaticMarkup(<ExtensionStoreEntry entry={{ ...entry, state: 'installed_enabled' }} />)).not.toContain('To enable')
		const broken = renderToStaticMarkup(
			<ExtensionStoreEntry
				entry={{
					...entry,
					state: 'misconfigured',
					problem: 'invalid private config',
					hostPorts: ['http'],
					egress: ['https://api.example'],
				}}
			/>,
		)
		expect(broken).toContain('Needs attention')
		expect(broken).toContain('invalid private config')
		expect(broken).toContain('https://api.example')
	})

	test('header renders top-right actions', () => {
		const markup = renderToStaticMarkup(
			<SettingsPageHeader icon={() => null} title="Extensions" description="d" actions={<ExtensionStoreButton onClick={() => {}} />} />,
		)
		expect(markup).toContain('Extension store')
		expect(markup).toContain('justify-between')
	})
})

describe('repository views', () => {
	const server = 'a'.repeat(64)
	const curator = 'b'.repeat(64)
	const entry = {
		serverPubkey: server,
		listedBy: [curator],
		sideloaded: false,
		state: 'listed' as const,
		name: 'Shipping rates',
		about: 'Live carrier rates',
		website: 'https://rates.example/',
		version: '2.1.0',
		tools: [
			{
				name: 'quote',
				title: 'Get a quote',
				description: 'Rates for a parcel',
				inputFields: ['weight'],
				price: { amount: '10', unit: 'sats' },
			},
		],
		paid: true,
		encrypted: true,
	}

	test('repository entry is labelled third-party and paid, links safely, and is not installable', () => {
		const markup = renderToStaticMarkup(<RepositoryEntryCard entry={entry} />)
		expect(markup).toContain('Third-party')
		expect(markup).toContain('Paid')
		expect(markup).toContain('10 sats')
		expect(markup).toContain('rel="noopener noreferrer nofollow"')
		expect(markup).toContain('Paid extensions cannot be installed')
		expect(markup).toContain(`title="${curator}"`)
	})

	test('section explains how to add registries and surfaces relay problems', () => {
		expect(
			renderToStaticMarkup(<RepositorySection repository={undefined} registryEnvExample="EXTENSIONS_REGISTRY_CURATORS=npub1…" />),
		).toContain('EXTENSIONS_REGISTRY_CURATORS=npub1…')
		const markup = renderToStaticMarkup(
			<RepositorySection
				registryEnvExample=""
				repository={{
					sideloaded: [],
					curators: [curator],
					relays: ['wss://relay.example'],
					entries: [],
					missingRegistries: [curator],
					fetchedAt: 0,
					problem: 'Could not read',
				}}
			/>,
		)
		expect(markup).toContain('Could not read')
		expect(markup).toContain('No registry list found for')
		expect(markup).toContain('No extensions are listed yet')
	})
})

describe('sideload views', () => {
	const server = 'c'.repeat(64)
	const controls = {
		onAdd: () => {},
		onRemove: () => {},
		pending: false,
		errorMessage: 'Enter a server pubkey as 64-character hex or npub',
	}
	const sideloaded = {
		serverPubkey: server,
		listedBy: [],
		sideloaded: true,
		state: 'unavailable' as const,
		name: 'cccccccc…',
		tools: [],
		paid: false,
		encrypted: false,
		problem: 'No server announcement found on the configured relays',
	}

	test('sideloaded entries are labelled and removable', () => {
		const markup = renderToStaticMarkup(<RepositoryEntryCard entry={sideloaded} onRemove={() => {}} />)
		expect(markup).toContain('Sideloaded')
		expect(markup).toContain('added by an admin of this marketplace')
		expect(markup).toContain(`data-testid="repository-remove-${server}"`)
		expect(markup).not.toContain('listed by')
		expect(renderToStaticMarkup(<RepositoryEntryCard entry={{ ...sideloaded, sideloaded: false }} onRemove={() => {}} />)).not.toContain(
			'repository-remove-',
		)
	})

	test('section shows the sideload form and registry setup hint with no curators', () => {
		const markup = renderToStaticMarkup(
			<RepositorySection
				registryEnvExample="EXTENSIONS_REGISTRY_CURATORS=npub1…"
				sideload={controls}
				repository={{
					curators: [],
					relays: ['wss://app.example'],
					sideloaded: [server],
					entries: [sideloaded],
					missingRegistries: [],
					fetchedAt: 0,
				}}
			/>,
		)
		expect(markup).toContain('data-testid="sideload-form"')
		expect(markup).toContain('Enter a server pubkey as 64-character hex or npub')
		expect(markup).toContain('No registries are configured')
		expect(markup).toContain('Sideloaded')
	})
})
