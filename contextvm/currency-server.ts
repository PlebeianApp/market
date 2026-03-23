import { NostrServerTransport, PrivateKeySigner, ApplesauceRelayPool } from '@contextvm/sdk'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { fetchAllSources, SUPPORTED_FIAT, type AggregatedRates, type FiatCode } from './tools/price-sources'
import { getBtcPriceInputSchema, getBtcPriceOutputSchema, getBtcPriceSingleInputSchema, getBtcPriceSingleOutputSchema } from './schemas'

const SERVER_PRIVATE_KEY = process.env.CURRENCY_SERVER_KEY || '2300f5fff5642341946758cad8214f2c54f3c40fba5ba51b616452b197fd3e71'

const NODE_ENV = process.env.NODE_ENV || 'development'

function getRelays(): string[] {
	const appRelay = process.env.APP_RELAY_URL

	switch (NODE_ENV) {
		case 'production':
			return [
				appRelay || 'wss://relay.plebeian.market',
				'wss://relay.contextvm.org',
				'wss://relay2.contextvm.org',
				'wss://cvm.otherstuff.ai',
			]
		case 'staging':
			return [
				appRelay || 'wss://relay.staging.plebeian.market',
				'wss://relay.contextvm.org',
				'wss://relay2.contextvm.org',
				'wss://cvm.otherstuff.ai',
			]
		default:
			return [appRelay || 'ws://localhost:10547', 'wss://relay.contextvm.org', 'wss://relay2.contextvm.org', 'wss://cvm.otherstuff.ai']
	}
}

const CACHE_TTL_MS = 2 * 60 * 1000

let cachedRates: AggregatedRates | null = null
let cacheTimer: ReturnType<typeof setTimeout> | null = null

async function getRates(forceRefresh = false): Promise<AggregatedRates> {
	if (!forceRefresh && cachedRates && Date.now() - cachedRates.fetchedAt < CACHE_TTL_MS) {
		return { ...cachedRates, cached: true }
	}

	const rates = await fetchAllSources()
	cachedRates = rates

	if (cacheTimer) clearTimeout(cacheTimer)
	cacheTimer = setTimeout(() => {
		cachedRates = null
		cacheTimer = null
	}, CACHE_TTL_MS)

	return { ...rates, cached: false }
}

async function main() {
	const signer = new PrivateKeySigner(SERVER_PRIVATE_KEY)
	const relays = getRelays()
	const relayPool = new ApplesauceRelayPool(relays)
	const serverPubkey = await signer.getPublicKey()

	console.log(`=== Plebeian Currency ContextVM Server ===`)
	console.log(`Public key: ${serverPubkey}`)
	console.log(`Environment: ${NODE_ENV}`)
	console.log(`Relays: ${relays.join(', ')}`)
	console.log(`Cache TTL: ${CACHE_TTL_MS / 1000}s`)
	console.log(`Supported currencies: ${SUPPORTED_FIAT.length}`)
	console.log()

	const mcpServer = new McpServer({
		name: 'plebeian-currency-server',
		version: '1.0.0',
	})

	mcpServer.registerTool(
		'get_btc_price',
		{
			title: 'Get BTC Price',
			description:
				'Get BTC exchange rates for all supported fiat currencies. Aggregates from Yadio, CoinDesk, Binance, and CoinGecko with median calculation.',
			inputSchema: getBtcPriceInputSchema,
			outputSchema: getBtcPriceOutputSchema,
		},
		async ({ refresh }) => {
			try {
				const result = await getRates(refresh)
				return {
					content: [],
					structuredContent: {
						rates: result.rates,
						sourcesSucceeded: result.sourcesSucceeded,
						sourcesFailed: result.sourcesFailed,
						fetchedAt: result.fetchedAt,
						cached: result.cached,
					},
				}
			} catch (error: any) {
				return {
					content: [],
					structuredContent: { error: error.message },
					isError: true,
				}
			}
		},
	)

	mcpServer.registerTool(
		'get_btc_price_single',
		{
			title: 'Get BTC Price for Single Currency',
			description: 'Get the BTC exchange rate for a specific fiat currency.',
			inputSchema: getBtcPriceSingleInputSchema,
			outputSchema: getBtcPriceSingleOutputSchema,
		},
		async ({ currency, refresh }) => {
			try {
				const upperCurrency = currency.toUpperCase() as FiatCode
				if (!SUPPORTED_FIAT.includes(upperCurrency)) {
					return {
						content: [],
						structuredContent: {
							error: `Unsupported currency: ${currency}. Supported: ${SUPPORTED_FIAT.join(', ')}`,
						},
						isError: true,
					}
				}

				const result = await getRates(refresh)
				const rate = result.rates[upperCurrency]

				if (!rate) {
					return {
						content: [],
						structuredContent: { error: `No rate available for ${upperCurrency}` },
						isError: true,
					}
				}

				return {
					content: [],
					structuredContent: {
						currency: upperCurrency,
						rate,
						fetchedAt: result.fetchedAt,
						cached: result.cached,
					},
				}
			} catch (error: any) {
				return {
					content: [],
					structuredContent: { error: error.message },
					isError: true,
				}
			}
		},
	)

	const serverTransport = new NostrServerTransport({
		signer,
		relayHandler: relayPool,
		isPublicServer: true,
		serverInfo: {
			name: 'Plebeian Currency Server',
			website: 'https://plebeian.market',
			about: 'BTC exchange rate server aggregating Yadio, CoinDesk, Binance, and CoinGecko prices via median calculation.',
		},
		excludedCapabilities: [
			{ method: 'tools/list' },
			{ method: 'tools/call', name: 'get_btc_price' },
			{ method: 'tools/call', name: 'get_btc_price_single' },
		],
	})

	await mcpServer.connect(serverTransport)
	console.log('Server is running and listening for requests on Nostr...')
	console.log('Press Ctrl+C to exit.')
}

main().catch((error) => {
	console.error('Failed to start currency server:', error)
	process.exit(1)
})
