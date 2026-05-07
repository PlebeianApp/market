import {
	NostrServerTransport,
	PrivateKeySigner,
	ApplesauceRelayPool,
	withCommonToolSchemas,
	GiftWrapMode,
} from '@contextvm/sdk'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { fetchAllSources, SUPPORTED_FIAT, type AggregatedRates, type FiatCode } from './tools/price-sources'
import { getBtcPriceInputSchema, getBtcPriceOutputSchema, getBtcPriceSingleInputSchema, getBtcPriceSingleOutputSchema } from './schemas'
import { RatesCache } from './tools/rates-cache'
import {
	AUCTION_TOOL_NAMES,
	getAuctionStateInputSchema,
	getAuctionStateOutputSchema,
	requestPathInputSchema,
	requestPathOutputSchema,
	requestSettlementInputSchema,
	requestSettlementOutputSchema,
	submitBidTokenInputSchema,
	submitBidTokenOutputSchema,
} from './auction-schemas'
import { buildContextVmAuctionContext } from './auction-context'
import { createRequestPathHandler } from './tools/auction-path-oracle/request-path'
import { createSubmitBidTokenHandler } from './tools/auction-path-oracle/submit-bid-token'
import { createRequestSettlementHandler } from './tools/auction-path-oracle/request-settlement'
import { createGetAuctionStateHandler } from './tools/auction-path-oracle/get-auction-state'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const SERVER_PRIVATE_KEY = process.env.CVM_SERVER_KEY || '2300f5fff5642341946758cad8214f2c54f3c40fba5ba51b616452b197fd3e71'

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

const CACHE_TTL_MS = 1 * 60 * 1000

let cache: RatesCache

function getCache(): RatesCache {
	if (!cache) {
		const cachePath = getCachePath()
		mkdirSync(dirname(cachePath), { recursive: true })
		cache = new RatesCache(cachePath)
	}
	return cache
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

	// AUCTIONS.md §7.5 / §11 — auction path-oracle context. Uses the same
	// CVM signer + relays as the currency tools, but runs through NDK so the
	// auction domain modules (which were built against NDK's NIP-44 +
	// fetchEvents helpers) work without a second transport stack.
	const auctionContext = await buildContextVmAuctionContext({
		relays,
		privateKeyHex: SERVER_PRIVATE_KEY,
	})

	const mcpServer = new McpServer({
		name: 'plebeian-server',
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

	// --- Auction path-oracle tools (CEP-15 common-schema family) ----------
	mcpServer.registerTool(
		AUCTION_TOOL_NAMES.requestPath,
		{
			title: 'Request derivation path for an auction bid',
			description:
				'AUCTIONS.md §7.5.1 — Bidder requests a fresh HD derivation path before locking Cashu proofs. The issuer allocates a path, derives the matching child pubkey, and persists the grant in its kind-30410 registry.',
			inputSchema: requestPathInputSchema,
			outputSchema: requestPathOutputSchema,
		},
		createRequestPathHandler(auctionContext),
	)

	mcpServer.registerTool(
		AUCTION_TOOL_NAMES.submitBidToken,
		{
			title: 'Submit locked Cashu bid token',
			description:
				'AUCTIONS.md §7 — After publishing the kind-1023 commitment, the bidder submits the locked Cashu token plus lock parameters. The issuer runs the §7 MUST checks (mint allowlist, locktime invariant, grant binding) and advances the registry entry from `issued` to `locked`.',
			inputSchema: submitBidTokenInputSchema,
			outputSchema: submitBidTokenOutputSchema,
		},
		createSubmitBidTokenHandler(auctionContext),
	)

	mcpServer.registerTool(
		AUCTION_TOOL_NAMES.requestSettlement,
		{
			title: 'Request auction settlement plan',
			description:
				'AUCTIONS.md §7.5.3 — Seller asks the issuer to compute the winning chain and release the corresponding derivation paths + locked Cashu tokens. Reserve-not-met returns an empty `releases` array.',
			inputSchema: requestSettlementInputSchema,
			outputSchema: requestSettlementOutputSchema,
		},
		createRequestSettlementHandler(auctionContext),
	)

	mcpServer.registerTool(
		AUCTION_TOOL_NAMES.getAuctionState,
		{
			title: 'Get current auction state',
			description:
				'Read-only view of an auction\'s current floor, top bid, bid count, and registry health (paths issued vs locked). Public — no caller identity required.',
			inputSchema: getAuctionStateInputSchema,
			outputSchema: getAuctionStateOutputSchema,
		},
		createGetAuctionStateHandler(auctionContext),
	)

	const serverTransport = new NostrServerTransport({
		signer,
		relayHandler: relayPool,
		// Always announce. The SDK's `getDiscoverabilityPublishRelayUrls`
		// already detects when every operational relay is local
		// (`isLocalRelayUrl(...)`) and skips the public-bootstrap relay
		// list in that case — so dev announcements stay on
		// `ws://localhost:10547` and never leak into public CEP-15
		// discovery feeds. Announcing in dev is what lets the auction-
		// creation form's oracle picker discover the local server via
		// `kind 11317 + #k io.contextvm/common-schema`.
		isAnnouncedServer: true,
		// Force kind-1059 (persistent gift wraps) for both inbound and
		// outbound. Why:
		//   1. The SDK's default (`OPTIONAL`) auto-promotes any client that
		//      advertises `support_encryption_ephemeral` — and the SDK's own
		//      client transport always advertises it. Once a session is
		//      promoted, the server replies with kind-21059 *forever* for
		//      that pubkey, even when subsequent calls come from the
		//      hand-rolled browser client (`PlebeianAuctionClient`) which
		//      only subscribes to kind-1059. The browser would silently
		//      drop the response and time out at 20s.
		//   2. Local relays (e.g. `nak`) handle ephemeral kinds erratically;
		//      we've observed publish retries 40+ times before timing out.
		// Persistent mode sidesteps both: every response is kind-1059, every
		// subscription is on kind-1059, and there's no per-pubkey state to
		// poison cross-client compatibility.
		giftWrapMode: GiftWrapMode.PERSISTENT,
		// Inject the wrapping kind-25910 / 1059 signer pubkey into the
		// inbound message's `_meta` so auction tools can authenticate the
		// caller without trusting fields in the input. Closes
		// AUCTIONS.md §7.5.1's identity-proof requirement.
		injectClientPubkey: true,
		serverInfo: {
			name: 'Plebeian Server',
			website: 'https://plebeian.market',
			about: 'BTC exchange rates + English-auction path oracle (CEP-15 common-schema family `english_auction_path_oracle_v1`).',
		},
		excludedCapabilities: [
			{ method: 'tools/list' },
			{ method: 'tools/call', name: 'get_btc_price' },
			{ method: 'tools/call', name: 'get_btc_price_single' },
			// Auction tools are public — anyone can call them. Identity is
			// established at the message-signer level, not at transport
			// pubkey allowlist level.
			{ method: 'tools/call', name: AUCTION_TOOL_NAMES.requestPath },
			{ method: 'tools/call', name: AUCTION_TOOL_NAMES.submitBidToken },
			{ method: 'tools/call', name: AUCTION_TOOL_NAMES.requestSettlement },
			{ method: 'tools/call', name: AUCTION_TOOL_NAMES.getAuctionState },
		],
	})

	// CEP-15: stamp the auction tools' `_meta.io.contextvm/common-schema`
	// with their canonical schema hash so clients can discover this server
	// via `{ kinds: [11317], "#i": ["<hash>"] }`. The decorator handles
	// both the per-tool `_meta` injection and the `i`/`k` tags on the
	// kind-11320 tools-list announcement.
	withCommonToolSchemas(serverTransport, {
		tools: [
			{ name: AUCTION_TOOL_NAMES.requestPath },
			{ name: AUCTION_TOOL_NAMES.submitBidToken },
			{ name: AUCTION_TOOL_NAMES.requestSettlement },
			{ name: AUCTION_TOOL_NAMES.getAuctionState },
		],
	})

	await mcpServer.connect(serverTransport)
	console.log('Server is running and listening for requests on Nostr...')
	console.log(`Auction path-oracle pubkey (use as auction \`path_issuer\` tag): ${auctionContext.issuerPubkey}`)
	console.log('Press Ctrl+C to exit.')
}

main().catch((error) => {
	console.error('Failed to start currency server:', error)
	process.exit(1)
})
