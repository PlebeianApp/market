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

type DeployStage = 'production' | 'staging' | 'development'

/**
 * Resolve the deployment stage. `APP_STAGE` is canonical (matches
 * `src/server/runtime.ts:determineStage`); we fall back to `NODE_ENV` so
 * the default `bun run contextvm/server.ts` invocation (no APP_STAGE
 * set) still works locally.
 *
 * Stage controls TWO things in this file:
 *   - which relays the server connects to as its operational pool
 *     (`getOperationalRelays`); and
 *   - whether announcements are allowed to leave that pool
 *     (`getBootstrapRelayUrls`).
 */
function determineStage(): DeployStage {
	const explicit = process.env.APP_STAGE
	if (explicit === 'production' || explicit === 'staging' || explicit === 'development') {
		return explicit
	}
	const env = process.env.NODE_ENV
	if (env === 'production') return 'production'
	if (env === 'staging') return 'staging'
	return 'development'
}

const STAGE: DeployStage = determineStage()

/**
 * Operational relays — every kind-1059 gift-wrap response, every
 * kind-30410 path-registry write, every CEP-15 announcement (subject
 * to the bootstrap-relay gate below) gets published here.
 *
 *   production → app relay + the two public CEP-15 facilitator relays
 *                (`relay.contextvm.org`, `relay2.contextvm.org`) so
 *                global clients can reach the server without an
 *                allow-list.
 *   staging    → ONLY the staging app relay
 *                (`wss://relay.staging.plebeian.market`). NO public
 *                CEP-15 relays — staging events must not appear on
 *                production discovery feeds.
 *   development→ ONLY `APP_RELAY_URL` (default `ws://localhost:10547`).
 */
function getOperationalRelays(): string[] {
	const appRelay = process.env.APP_RELAY_URL?.trim()
	const publicCvmRelays = ['wss://relay.contextvm.org', 'wss://relay2.contextvm.org']

	if (STAGE === 'production') {
		return [appRelay || 'wss://relay.plebeian.market', ...publicCvmRelays]
	}
	if (STAGE === 'staging') {
		// The staging deploys (auctionsdev + staging) share
		// `wss://relay.staging.plebeian.market`. If `APP_RELAY_URL` isn't
		// configured there's no sane fallback — bail loudly so we don't
		// silently start announcing to a randomly chosen relay.
		if (!appRelay) {
			throw new Error('APP_RELAY_URL must be set for APP_STAGE=staging')
		}
		return [appRelay]
	}
	// development
	return [appRelay || 'ws://localhost:10547']
}

/**
 * Discoverability bootstrap relays — relays the SDK additionally
 * publishes announcements to (kind 11316/11317/10002 etc.), beyond
 * the operational pool. Returning `[]` (NOT `undefined`) is the
 * SDK's documented opt-out: it sets `hasExplicitBootstrapRelayUrls`
 * which disables the default `DEFAULT_BOOTSTRAP_RELAY_URLS` fallback.
 *
 *   production → `undefined` (let the SDK use its public bootstrap
 *                list — `damus.io`, `primal.net`, `nos.lol`,
 *                `snort.social`, `nostr.mom`, `nostr.oxtr.dev`).
 *   staging    → `[]` — confine announcements to the staging relay.
 *   development→ `[]` — confine announcements to localhost. The SDK
 *                already auto-skips when every operational relay is
 *                local, but being explicit guards against accidental
 *                config drift (e.g. someone runs dev pointed at a
 *                public relay).
 */
function getBootstrapRelayUrls(): readonly string[] | undefined {
	if (STAGE === 'production') return undefined
	return []
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
	const relays = getOperationalRelays()
	const bootstrapRelayUrls = getBootstrapRelayUrls()
	const relayPool = new ApplesauceRelayPool(relays)
	const serverPubkey = await signer.getPublicKey()

	console.log(`=== Plebeian Currency ContextVM Server ===`)
	console.log(`Public key: ${serverPubkey}`)
	console.log(`Stage: ${STAGE} (NODE_ENV=${process.env.NODE_ENV ?? 'unset'}, APP_STAGE=${process.env.APP_STAGE ?? 'unset'})`)
	console.log(`Operational relays: ${relays.join(', ')}`)
	console.log(
		`Announcement bootstrap relays: ${
			bootstrapRelayUrls === undefined
				? 'SDK default (public CEP-15 + Nostr discovery relays)'
				: bootstrapRelayUrls.length === 0
					? '[] — announcements confined to operational relays'
					: bootstrapRelayUrls.join(', ')
		}`,
	)
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
		// Always announce — the dev oracle picker relies on this to
		// discover the local server via `kind 11317 + #k io.contextvm/common-schema`,
		// and prod/staging clients want it for the same reason. The
		// `bootstrapRelayUrls` setting below is what actually controls
		// whether announcements leak past the operational relay pool.
		isAnnouncedServer: true,
		// Stage-gated. `getBootstrapRelayUrls()` returns:
		//   - production  → `undefined` → SDK uses its default public
		//     bootstrap list (damus.io / primal.net / nos.lol / etc.)
		//     so the prod CVM oracle is globally discoverable.
		//   - staging     → `[]` → SDK skips bootstrap relays entirely.
		//     Auctionsdev and staging share `relay.staging.plebeian.market`;
		//     announcements stay there.
		//   - development → `[]` → localhost only.
		// `[]` (vs `undefined`) sets `hasExplicitBootstrapRelayUrls=true`
		// in the SDK, which disables the default fallback.
		bootstrapRelayUrls,
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
