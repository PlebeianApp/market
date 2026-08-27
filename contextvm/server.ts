import { NostrServerTransport, PrivateKeySigner, ApplesauceRelayPool } from '@contextvm/sdk'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { fetchAllSources, SUPPORTED_FIAT, type AggregatedRates, type FiatCode } from './tools/price-sources'
import { getBtcPriceInputSchema, getBtcPriceOutputSchema, getBtcPriceSingleInputSchema, getBtcPriceSingleOutputSchema, walletStateSyncInputSchema, walletStateSyncOutputSchema, walletStateRequestInputSchema, walletStateRequestOutputSchema } from './schemas'
import { RatesCache } from './tools/rates-cache'
import { WalletStateStore } from './tools/wallet-state-store'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const SERVER_PRIVATE_KEY = process.env.CVM_SERVER_KEY
if (!SERVER_PRIVATE_KEY) {
	console.error('CVM_SERVER_KEY environment variable is required. Set it and restart.')
	process.exit(1)
}

const NODE_ENV = process.env.NODE_ENV || 'development'

function getRelays(): string[] {
	const appRelay = process.env.APP_RELAY_URL
	const publicRelays = ['wss://relay.contextvm.org', 'wss://relay2.contextvm.org']

	if (NODE_ENV === 'production') {
		return [appRelay || 'wss://relay.plebeian.market', ...publicRelays]
	}

	return [appRelay || 'ws://localhost:10547']
}

function getCachePath(): string {
	return process.env.CURRENCY_CACHE_PATH || './contextvm/data/rates-cache.sqlite'
}

function getWalletStatePath(): string {
	return process.env.WALLET_STATE_PATH || './contextvm/data/wallet-state.sqlite'
}

const CACHE_TTL_MS = 1 * 60 * 1000

let cache: RatesCache
let walletStateStore: WalletStateStore

function getCache(): RatesCache {
	if (!cache) {
		const cachePath = getCachePath()
		mkdirSync(dirname(cachePath), { recursive: true })
		cache = new RatesCache(cachePath)
	}
	return cache
}

function getWalletStateStore(): WalletStateStore {
	if (!walletStateStore) {
		const storePath = getWalletStatePath()
		mkdirSync(dirname(storePath), { recursive: true })
		walletStateStore = new WalletStateStore(storePath)
	}
	return walletStateStore
}

async function getRates(forceRefresh = false): Promise<AggregatedRates> {
	if (!forceRefresh) {
		const cached = getCache().get('btc-rates')
		if (cached) {
			return { ...JSON.parse(cached), cached: true }
		}
	}

	const rates = await fetchAllSources()
	getCache().set('btc-rates', JSON.stringify(rates), CACHE_TTL_MS)

	return { ...rates, cached: false }
}

async function main() {
	const signer = new PrivateKeySigner(SERVER_PRIVATE_KEY)
	const relays = getRelays()
	const relayPool = new ApplesauceRelayPool(relays)
	const serverPubkey = await signer.getPublicKey()
	const isPublic = NODE_ENV === 'production'

	console.log(`=== Plebeian Currency ContextVM Server ===`)
	console.log(`Public key: ${serverPubkey}`)
	console.log(`Environment: ${NODE_ENV}`)
	console.log(`Public server: ${isPublic}`)
	console.log(`Relays: ${relays.join(', ')}`)
	console.log(`Cache TTL: ${CACHE_TTL_MS / 1000}s`)
	console.log(`Cache path: ${getCachePath()}`)
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

	mcpServer.registerTool(
		'wallet_state_sync',
		{
			title: 'Sync Wallet State',
			description:
				'Store an encrypted wallet state snapshot (unspent proofs + derivation counter + heap pointer) for a pubkey. Returns a confirmation with the new version number. The payload is NIP-44 encrypted and stored encrypted at rest; the server never decrypts it.',
			inputSchema: walletStateSyncInputSchema,
			outputSchema: walletStateSyncOutputSchema,
		},
		async ({ pubkey, encryptedState, sequence, version }) => {
			try {
				const store = getWalletStateStore()
				const newVersion = store.sync(pubkey, encryptedState, sequence, version)

				if (newVersion === null) {
					return {
						content: [],
						structuredContent: {
							error: `Stale write rejected: expected version ${version} but current version differs. Re-request latest state and retry.`,
						},
						isError: true,
					}
				}

				return {
					content: [],
					structuredContent: {
						pubkey,
						version: newVersion,
						storedAt: Date.now(),
						accepted: true,
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
		'wallet_state_request',
		{
			title: 'Request Wallet State',
			description:
				'Return the latest stored wallet state snapshot for a given pubkey. Returns the NIP-44 encrypted payload, version, sequence counter, and stored timestamp, or found:false if none is stored.',
			inputSchema: walletStateRequestInputSchema,
			outputSchema: walletStateRequestOutputSchema,
		},
		async ({ pubkey }) => {
			try {
				const store = getWalletStateStore()
				const record = store.get(pubkey)

				if (!record) {
					return {
						content: [],
						structuredContent: {
							pubkey,
							found: false,
							encryptedState: null,
							version: null,
							sequence: null,
							storedAt: null,
						},
					}
				}

				return {
					content: [],
					structuredContent: {
						pubkey,
						found: true,
						encryptedState: record.encryptedState,
						version: record.version,
						sequence: record.sequence,
						storedAt: record.storedAt,
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
		isPublicServer: isPublic,
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
