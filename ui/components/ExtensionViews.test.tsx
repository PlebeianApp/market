import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PublicExtensionDescriptor, SuggestedBinding } from '@sdk/core/extensions'
import {
	AcceptBindingsSummary,
	BindingRow,
	ExtensionCard,
	ExtensionLogo,
	ExtensionsEmptyState,
	ExtensionStoreButton,
	ExtensionStoreEntry,
	ExtensionTile,
	ImageDescribePanel,
	pendingSuggestedBindings,
	RemoteActionTryPanel,
	RepositoryEntryCard,
	RepositorySection,
	suggestableTools,
} from './ExtensionViews'
import { SettingsPageHeader } from './OperatorSettingsViews'

const suggestion: SuggestedBinding = { actionName: 'get-quote', capability: 'shipping.quote', auth: 'user', source: 'server' }

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
		expect(renderToStaticMarkup(<ExtensionsEmptyState />)).toContain('No extensions added yet.')
	})

	test('extension tile renders inside the given link with kind, subtitle, and warning', () => {
		const markup = renderToStaticMarkup(
			<ExtensionTile
				name="Dummy Image Describer"
				icon="https://cdn.example/logo.svg"
				kind="external"
				description="Drafts product descriptions"
				subtitle="2 actions"
				warning="Needs review"
				testId="extension-tile-x"
				link={<a href="/dashboard/app-settings/extensions/remote.abc" />}
			/>,
		)
		expect(markup).toMatch(/^<a href="\/dashboard\/app-settings\/extensions\/remote\.abc"/)
		expect(markup).toContain('data-testid="extension-tile-x"')
		expect(markup).toContain('External')
		expect(markup).toContain('2 actions')
		expect(markup).toContain('Drafts product descriptions')
		expect(markup).toContain('Needs review')
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
	const builtin = {
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
		canEnable: false,
	} as const

	test('built-in entry is one compact row with logo, state, ports, and the enable variable', () => {
		const markup = renderToStaticMarkup(
			<ExtensionStoreEntry entry={{ ...builtin, hostPorts: ['http'], egress: ['https://api.example'] }} />,
		)
		expect(markup).toContain('src="/images/extension-product-image-describer.svg"')
		expect(markup).toContain('Available')
		expect(markup).toContain('>http<')
		expect(markup).toContain('EXTENSION_PRODUCT_IMAGE_DESCRIBER_ENABLED=true')
		expect(markup).toContain('>Drafts a description.<')
		expect(renderToStaticMarkup(<ExtensionStoreEntry entry={{ ...builtin, state: 'installed_enabled' }} />)).not.toContain('ENABLED=true')
		expect(
			renderToStaticMarkup(<ExtensionStoreEntry entry={{ ...builtin, state: 'misconfigured', problem: 'invalid private config' }} />),
		).toContain('invalid private config')
	})

	test('admins can disable enabled built-ins and enable those that need no secrets', () => {
		const controls = { onToggle: () => {}, pending: false }
		const enabled = renderToStaticMarkup(
			<ExtensionStoreEntry entry={{ ...builtin, state: 'installed_enabled', canEnable: true }} controls={controls} />,
		)
		expect(enabled).toContain('data-testid="builtin-toggle-product-image-describer"')
		expect(enabled).toContain('Disable')
		const disabled = renderToStaticMarkup(
			<ExtensionStoreEntry entry={{ ...builtin, state: 'installed_disabled', canEnable: true }} controls={controls} />,
		)
		expect(disabled).toContain('Disabled')
		expect(disabled).toContain('>Enable<')
		expect(disabled).not.toContain('ENABLED=true')
		const needsSecrets = renderToStaticMarkup(<ExtensionStoreEntry entry={{ ...builtin, canEnable: false }} controls={controls} />)
		expect(needsSecrets).not.toContain('builtin-toggle-')
		expect(needsSecrets).toContain('EXTENSION_PRODUCT_IMAGE_DESCRIBER_ENABLED=true')
	})

	test('header renders top-right actions', () => {
		const markup = renderToStaticMarkup(
			<SettingsPageHeader
				icon={() => null}
				title="Extensions"
				description="d"
				actions={
					<ExtensionStoreButton>
						<a href="/dashboard/app-settings/extension-store" />
					</ExtensionStoreButton>
				}
			/>,
		)
		expect(markup).toContain('Extension store')
		expect(markup).toContain('href="/dashboard/app-settings/extension-store"')
	})
})

const server = 'e'.repeat(64)
const serverControls = {
	onAdd: () => {},
	onRemove: () => {},
	pending: false,
	errorMessage: 'Enter a server pubkey as 64-character hex or npub',
}
const bindingControls = {
	onBind: async () => true,
	onBindMany: async () => true,
	onUpdate: () => {},
	onRemove: () => {},
	pending: false,
}
const tools = [
	{
		name: 'describe_product_image',
		inputFields: [],
		inputSchemaHash: 'a'.repeat(64),
		suggestedBinding: suggestion,
		description: 'Long description',
	},
	{
		name: 'suggest_tags',
		inputFields: [],
		inputSchemaHash: 'b'.repeat(64),
		suggestedBinding: { actionName: 'suggest-tags', capability: 'tool.suggest.tags', auth: 'admin' as const, source: 'derived' as const },
	},
	{
		name: 'premium',
		inputFields: [],
		inputSchemaHash: 'c'.repeat(64),
		suggestedBinding: suggestion,
		price: { amount: '100', unit: 'sats' },
	},
]
const entry = {
	serverPubkey: server,
	listedBy: ['d'.repeat(64)],
	added: true,
	sideloaded: false,
	state: 'listed' as const,
	name: 'Dummy',
	about: 'About text',
	website: 'https://dummy.example/',
	tools,
	paid: true,
	encrypted: false,
}
const binding = (change: Record<string, unknown> = {}) => ({
	serverPubkey: server,
	serverName: 'Dummy',
	toolName: 'describe_product_image',
	actionName: 'get-quote',
	capability: 'shipping.quote',
	auth: 'user' as const,
	rateLimit: { perPubkey: 30, windowSeconds: 3600 },
	enabled: true,
	state: 'installed_enabled' as const,
	...change,
})

describe('repository entry', () => {
	test('Add on a listed extension offers its suggestions for the add dialog', () => {
		expect(suggestableTools({ ...entry, added: false }, []).map((tool) => tool.name)).toEqual(['describe_product_image', 'suggest_tags'])
		expect(suggestableTools({ ...entry, added: false, state: 'unavailable' }, [])).toEqual([])
	})

	test('not added: only the Add button, no tools or suggestions', () => {
		const markup = renderToStaticMarkup(
			<RepositoryEntryCard entry={{ ...entry, added: false }} serverControls={serverControls} bindingControls={bindingControls} />,
		)
		expect(markup).toContain(`data-testid="repository-add-${server}"`)
		expect(markup).not.toContain('accept-all-')
		expect(markup).not.toContain('suggested-binding-')
		expect(markup).not.toContain('describe_product_image')
	})

	test('added: one Accept suggested button for all unpaid tools; long text stays out of the page', () => {
		const markup = renderToStaticMarkup(
			<RepositoryEntryCard entry={entry} serverControls={serverControls} bindingControls={bindingControls} />,
		)
		expect(markup).toContain(`data-testid="accept-all-${server}"`)
		expect(markup).toContain('Accept suggested (2)')
		expect(markup).toContain('data-testid="suggested-binding-describe_product_image"')
		expect(markup).toContain('data-testid="suggested-binding-suggest_tags"')
		expect(markup).not.toContain('accept-binding-')
		expect(markup).not.toContain('suggested-binding-premium')
		expect(markup).toContain('100 sats')
		expect(markup).toContain('rel="noopener noreferrer nofollow"')
		expect(markup).toContain('>About text<')
		expect(markup).not.toContain('>Long description<')
		expect(markup).toContain('Paid')
	})

	test('bound tools show a compact binding instead of a suggestion; removal is blocked while bound', () => {
		const markup = renderToStaticMarkup(
			<RepositoryEntryCard entry={entry} serverControls={serverControls} bindings={[binding()]} bindingControls={bindingControls} />,
		)
		expect(markup).toContain('Bound')
		expect(markup).not.toContain('suggested-binding-describe_product_image')
		expect(markup).toContain('Accept suggested (1)')
		expect(markup).toContain('title="Remove its bindings first"')
	})

	test('a suggestion whose action name is taken is not offered for bulk accept', () => {
		const taken = binding({ toolName: 'other', actionName: 'get-quote' })
		expect(pendingSuggestedBindings(entry, [taken]).map((tool) => tool.name)).toEqual(['suggest_tags'])
		expect(pendingSuggestedBindings({ ...entry, added: false }, [])).toEqual([])
	})

	test('sideloaded and unavailable entries are labelled', () => {
		const markup = renderToStaticMarkup(
			<RepositoryEntryCard
				entry={{ ...entry, listedBy: [], sideloaded: true, state: 'unavailable', problem: 'No server announcement found' }}
				serverControls={serverControls}
			/>,
		)
		expect(markup).toContain('Sideloaded')
		expect(markup).toContain('Unavailable')
		expect(markup).toContain('title="No server announcement found"')
	})
})

describe('binding row', () => {
	test('needs-review bindings show the reason and Approve; enabled ones a pause control', () => {
		const review = renderToStaticMarkup(
			<BindingRow binding={binding({ state: 'misconfigured', problem: 'The tool definition changed' })} controls={bindingControls} />,
		)
		expect(review).toContain('Needs review')
		expect(review).toContain('The tool definition changed')
		expect(review).toContain('Approve')
		const enabled = renderToStaticMarkup(<BindingRow binding={binding()} controls={bindingControls} />)
		expect(enabled).toContain('aria-label="Disable get-quote"')
		expect(enabled).not.toContain('Approve')
	})
})

describe('repository section', () => {
	test('add-server form, short status lines, and binding errors', () => {
		const markup = renderToStaticMarkup(
			<RepositorySection
				registryEnvExample="EXTENSIONS_REGISTRY_CURATORS=npub1…"
				servers={serverControls}
				bindingControls={{ ...bindingControls, errorMessage: 'Remove failed' }}
				repository={{
					curators: [],
					relays: ['wss://app.example'],
					added: [],
					entries: [],
					missingRegistries: ['d'.repeat(64)],
					fetchedAt: 0,
					problem: 'Could not read',
				}}
			/>,
		)
		expect(markup).toContain('data-testid="add-server-form"')
		expect(markup).toContain('Enter a server pubkey as 64-character hex or npub')
		expect(markup).toContain('No registries configured.')
		expect(markup).toContain('1 registry list(s) not found.')
		expect(markup).toContain('Could not read')
		expect(markup).toContain('Remove failed')
		expect(markup).toContain('No extensions yet.')
	})

	test('without a relay, explains the setting', () => {
		expect(
			renderToStaticMarkup(<RepositorySection repository={undefined} registryEnvExample="EXTENSIONS_REGISTRY_RELAYS=wss://x" />),
		).toContain('EXTENSIONS_REGISTRY_RELAYS=wss://x')
	})
})

describe('accept bindings confirmation', () => {
	test('summary lists each binding and who may call it, with the data-flow notice', () => {
		const markup = renderToStaticMarkup(
			<AcceptBindingsSummary
				serverName="Dummy Image Describer"
				items={[
					{ toolName: 'describe_product_image', suggestion },
					{
						toolName: 'suggest_tags',
						suggestion: { actionName: 'suggest-tags', capability: 'tool.suggest.tags', auth: 'admin', source: 'derived' },
					},
				]}
			/>,
		)
		expect(markup).toContain('describe_product_image')
		expect(markup).toContain('shipping.quote')
		expect(markup).toContain('Any signed-in user')
		expect(markup).toContain('Admins only')
		expect(markup).toContain('Dummy Image Describer')
		expect(markup).toContain('replies are untrusted')
	})
})

describe('remote action try panel', () => {
	test('renders only with actions and labels replies as untrusted', () => {
		expect(renderToStaticMarkup(<RemoteActionTryPanel actions={[]} pending={false} onRun={() => {}} />)).toBe('')
		const markup = renderToStaticMarkup(
			<RemoteActionTryPanel
				actions={[{ extensionId: `remote.${server}`, actionName: 'get-quote', label: 'Rates — get-quote' }]}
				pending={false}
				onRun={() => {}}
				result={{ text: '<i>1200</i> sats', data: { sats: 1200 } }}
			/>,
		)
		expect(markup).toContain('Third-party reply — untrusted')
		expect(markup).toContain('&lt;i&gt;1200&lt;/i&gt; sats')
	})
})
