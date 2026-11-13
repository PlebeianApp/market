/**
 * Local extension-store sandbox (dev only).
 *
 * Starts three dummy ContextVM extension servers on the local relay, and publishes a registry list (NIP-51 kind 30000,
 * d=plebeian-extension-registry) signed by a local curator key. Use it to manually test the Extension store:
 * registries, adding servers (and sideloading), Paid labels, remote bindings, schema pins, and unreachable servers.
 *
 *   bun run dev:extensions                         # start servers + publish registry (keeps running)
 *   bun run dev:extensions --schema-v2             # same, but describe_product_image announces a changed schema
 *   bun run dev:extensions --registry-only         # publish the registry list and exit
 *
 * Side effects: writes data/extensions-dev/keys.json (git-ignored, mode 0600; private keys never printed), publishes
 * kinds 30000/11316/11317 and ContextVM responses to APP_RELAY_URL. Refuses any relay that is not localhost.
 */
import { ApplesauceRelayPool, NostrServerTransport, PrivateKeySigner } from '@contextvm/sdk'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { finalizeEvent, generateSecretKey, getPublicKey, nip19, Relay } from 'nostr-tools'
import { bytesToHex, hexToBytes } from 'nostr-tools/utils'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'
import { BINDING_SUGGESTION_META_KEY, EXTENSION_REGISTRY_D_TAG, EXTENSION_REGISTRY_LIST_KIND } from '@sdk/core/extensions'
import { mockDescribeImage } from '@sdk/extensions/product-image-describer'
import { mockListingDraft } from '@sdk/extensions/product-image-describer/mockListing'
import { PRODUCT_LISTING_DRAFT_CAPABILITY } from '@sdk/commerce/products'

/** Simulated model latency, so the UI's "AI is working" state is visible. */
const MOCK_AI_DELAY_MS = 1_500

const RELAY = process.env.APP_RELAY_URL || 'ws://localhost:10547'
const KEYS_PATH = './data/extensions-dev/keys.json'
const SCHEMA_V2 = process.argv.includes('--schema-v2')
const REGISTRY_ONLY = process.argv.includes('--registry-only')
const LOGO = 'https://raw.githubusercontent.com/PlebeianApp/market/master/public/images/logo.svg'
const LOGO_ALT = 'https://raw.githubusercontent.com/PlebeianApp/market/master/public/images/buy-sell.svg'
const WEBSITE = 'https://github.com/PlebeianApp/market'

type KeyName = 'curator' | 'imageDescriber' | 'premium' | 'sideload'
const KEY_NAMES: KeyName[] = ['curator', 'imageDescriber', 'premium', 'sideload']

function assertLocalRelay(url: string) {
	const host = new URL(url).hostname
	if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
		console.error(`Refusing to run against non-local relay ${url}. This script is for local development only.`)
		process.exit(1)
	}
}

function loadKeys(): Record<KeyName, string> {
	const stored: Partial<Record<KeyName, string>> = existsSync(KEYS_PATH) ? JSON.parse(readFileSync(KEYS_PATH, 'utf8')) : {}
	let changed = false
	for (const name of KEY_NAMES) {
		if (!stored[name] || !/^[0-9a-f]{64}$/.test(stored[name]!)) {
			stored[name] = bytesToHex(generateSecretKey())
			changed = true
		}
	}
	if (changed) {
		mkdirSync(dirname(KEYS_PATH), { recursive: true })
		writeFileSync(KEYS_PATH, JSON.stringify(stored, null, '\t'))
		chmodSync(KEYS_PATH, 0o600)
	}
	return stored as Record<KeyName, string>
}

const pubkeyOf = (secretHex: string) => getPublicKey(hexToBytes(secretHex))
const npubOf = (secretHex: string) => nip19.npubEncode(pubkeyOf(secretHex))

async function publishRegistry(curatorSecret: string, servers: string[]) {
	const event = finalizeEvent(
		{
			kind: EXTENSION_REGISTRY_LIST_KIND,
			created_at: Math.floor(Date.now() / 1000),
			tags: [['d', EXTENSION_REGISTRY_D_TAG], ['title', 'Local dev extension registry'], ...servers.map((pubkey) => ['p', pubkey])],
			content: '',
		},
		hexToBytes(curatorSecret),
	)
	const relay = await Relay.connect(RELAY)
	try {
		await relay.publish(event)
	} finally {
		relay.close()
	}
	return event.id
}

interface ServerSpec {
	key: KeyName
	name: string
	about: string
	picture?: string
	pricingTags?: string[][]
	register(server: McpServer): void
}

type ToolResult = { content: { type: 'text'; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean }

/**
 * Two zod copies are installed (the app's and the MCP SDK's nested one). Shapes are compatible at runtime but not
 * to the type checker, so registration goes through this one cast (contextvm/server.ts has the same mismatch).
 */
function tool<Args>(
	server: McpServer,
	name: string,
	config: {
		title: string
		description: string
		inputSchema: Record<string, unknown>
		outputSchema?: Record<string, unknown>
		/** Proposed marketplace binding, shown in the Extension store as a one-click "Accept". */
		_meta?: Record<string, unknown>
	},
	handler: (args: Args) => Promise<ToolResult>,
) {
	server.registerTool(name, config as never, handler as never)
}

const text = (value: string, structured: Record<string, unknown>) => ({
	content: [{ type: 'text' as const, text: value }],
	structuredContent: structured,
})

const SERVERS: ServerSpec[] = [
	{
		key: 'imageDescriber',
		name: 'Dummy Image Describer',
		about: 'Drafts product descriptions from an image link. Dev dummy: no image analysis.',
		picture: LOGO,
		register(server) {
			const inputSchema = {
				imageUrl: z.string().url().describe('Public http(s) link to the product image'),
				title: z.string().max(200).optional().describe('Product title'),
				notes: z.string().max(500).optional().describe('Seller notes to include'),
				// --schema-v2 changes the announced definition so existing bindings must be re-approved.
				...(SCHEMA_V2 ? { tone: z.enum(['plain', 'friendly']).describe('Writing tone') } : {}),
			}
			tool(
				server,
				'describe_product_image',
				{
					title: 'Describe product image',
					description: 'Returns a draft description for a product image link.',
					inputSchema,
					outputSchema: { description: z.string(), mock: z.boolean(), provider: z.string() },
					_meta: {
						[BINDING_SUGGESTION_META_KEY]: { actionName: 'describe-image', capability: 'product.image.describe', auth: 'user' },
					},
				},
				async (args: { imageUrl: string; title?: string; notes?: string }) => {
					const draft = mockDescribeImage({ imageUrl: args.imageUrl, title: args.title, notes: args.notes }, 600)
					return text(draft.description, { description: draft.description, mock: true, provider: 'dummy-contextvm' })
				},
			)
			tool(
				server,
				'draft_product_listing',
				{
					title: 'Draft product listing',
					description: 'Mock AI: returns a title, summary, description, tags, and category for a product photo. Never sets a price.',
					inputSchema: {
						imageUrl: z.string().url().describe('Public http(s) link to the product photo'),
						notes: z.string().max(500).optional().describe('Optional seller notes'),
					},
					outputSchema: {
						title: z.string(),
						summary: z.string(),
						description: z.string(),
						tags: z.array(z.string()),
						category: z.string(),
						model: z.string(),
					},
					_meta: {
						[BINDING_SUGGESTION_META_KEY]: { actionName: 'draft-listing', capability: PRODUCT_LISTING_DRAFT_CAPABILITY, auth: 'user' },
					},
				},
				async (args: { imageUrl: string; notes?: string }) => {
					await new Promise((resolve) => setTimeout(resolve, MOCK_AI_DELAY_MS))
					const draft = mockListingDraft(args)
					return text(`${draft.title}\n\n${draft.description}`, { ...draft })
				},
			)
			tool(
				server,
				'suggest_tags',
				{
					title: 'Suggest tags',
					description: 'Suggests listing tags from a product title.',
					inputSchema: { title: z.string().min(1).max(200) },
					outputSchema: { tags: z.array(z.string()) },
				},
				async ({ title }: { title: string }) => {
					const tags = [...new Set(title.toLowerCase().match(/[a-z]{3,}/g) ?? [])].slice(0, 5)
					return text(tags.join(', ') || 'no tags', { tags })
				},
			)
		},
	},
	{
		key: 'premium',
		name: 'Dummy Premium Tools',
		about: 'Mixed free and paid tools. Dev dummy: the price is only advertised, never charged.',
		picture: LOGO_ALT,
		pricingTags: [['cap', 'tool:premium_describe', '100', 'sats']],
		register(server) {
			tool(
				server,
				'premium_describe',
				{ title: 'Premium describe', description: 'Advertised as paid (100 sats).', inputSchema: { imageUrl: z.string().url() } },
				async () => text('premium draft', {}),
			)
			tool(
				server,
				'free_health',
				{ title: 'Health check', description: 'Free tool on a server that also has paid tools.', inputSchema: {} },
				async () => text('ok', { ok: true }),
			)
		},
	},
	{
		key: 'sideload',
		name: 'Dummy Sideload Echo',
		about: 'Not in any registry; add it by npub to test sideloading.',
		register(server) {
			tool(
				server,
				'echo',
				{
					title: 'Echo',
					description: 'Returns the message.',
					inputSchema: { message: z.string().max(500) },
					_meta: { [BINDING_SUGGESTION_META_KEY]: { actionName: 'echo', capability: 'dev.echo', auth: 'admin' } },
				},
				async ({ message }: { message: string }) => text(message, { message }),
			)
			tool(
				server,
				'always_fail',
				{ title: 'Always fail', description: 'Returns an error with a fake secret, to test that errors are not leaked.', inputSchema: {} },
				async () => ({ content: [{ type: 'text' as const, text: 'internal error: sk-DUMMY-SECRET-DO-NOT-LEAK' }], isError: true }),
			)
		},
	},
]

async function startServer(spec: ServerSpec, secretHex: string) {
	const server = new McpServer({ name: spec.name, version: SCHEMA_V2 ? '0.2.0' : '0.1.0' })
	spec.register(server)
	const transport = new NostrServerTransport({
		signer: new PrivateKeySigner(secretHex),
		relayHandler: new ApplesauceRelayPool([RELAY]),
		isAnnouncedServer: true,
		bootstrapRelayUrls: [],
		serverInfo: { name: spec.name, about: spec.about, website: WEBSITE, ...(spec.picture ? { picture: spec.picture } : {}) },
		logLevel: 'error',
	})
	if (spec.pricingTags) transport.setAnnouncementPricingTags(spec.pricingTags)
	await server.connect(transport)
	return transport
}

async function main() {
	assertLocalRelay(RELAY)
	const keys = loadKeys()
	const listed = [pubkeyOf(keys.imageDescriber), pubkeyOf(keys.premium)]
	const registryEventId = await publishRegistry(keys.curator, listed)

	console.log('=== Local extension-store sandbox ===')
	console.log(`Relay:            ${RELAY}`)
	console.log(`Curator npub:     ${npubOf(keys.curator)}`)
	console.log(`Registry event:   ${registryEventId} (kind ${EXTENSION_REGISTRY_LIST_KIND}, d=${EXTENSION_REGISTRY_D_TAG})`)
	for (const spec of SERVERS) {
		const where = spec.key === 'sideload' ? 'NOT listed (add it by npub = sideload)' : 'listed (Add to marketplace)'
		console.log(`${spec.name.padEnd(22)} ${npubOf(keys[spec.key])}  [${where}]`)
	}
	console.log('\nAdd to .env, then restart the app:')
	console.log(`EXTENSIONS_REGISTRY_CURATORS=${npubOf(keys.curator)}`)
	if (REGISTRY_ONLY) return

	const transports = await Promise.all(SERVERS.map((spec) => startServer(spec, keys[spec.key])))
	console.log(`\nServers running${SCHEMA_V2 ? ' with --schema-v2 (describe_product_image changed)' : ''}. Ctrl+C to stop.`)

	const shutdown = async () => {
		await Promise.allSettled(transports.map((transport) => transport.close()))
		process.exit(0)
	}
	process.once('SIGINT', () => void shutdown())
	process.once('SIGTERM', () => void shutdown())
}

main().catch((error) => {
	console.error('dev-extensions failed:', error instanceof Error ? error.message : error)
	process.exit(1)
})
