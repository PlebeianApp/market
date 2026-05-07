import { Client } from '@modelcontextprotocol/sdk/client'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { NostrClientTransport, type NostrTransportOptions, PrivateKeySigner, ApplesauceRelayPool } from '@contextvm/sdk'

export interface GetBtcPriceInput {
	/**
	 * Force refresh of rates, bypassing the server cache
	 */
	refresh?: boolean
}

export interface GetBtcPriceOutput {
	/**
	 * BTC exchange rates per fiat currency
	 */
	rates: {
		[k: string]: number
	}
	/**
	 * Price sources that returned successfully
	 */
	sourcesSucceeded: string[]
	/**
	 * Price sources that failed
	 */
	sourcesFailed: string[]
	/**
	 * Unix timestamp (ms) when rates were fetched
	 */
	fetchedAt: number
	/**
	 * Whether the returned rates were served from cache
	 */
	cached: boolean
}

export interface GetBtcPriceSingleInput {
	/**
	 * ISO 4217 currency code, e.g. USD, EUR, JPY
	 */
	currency: string
	/**
	 * Force refresh of rates, bypassing the server cache
	 */
	refresh?: boolean
}

export interface GetBtcPriceSingleOutput {
	/**
	 * The requested currency code
	 */
	currency: string
	/**
	 * BTC exchange rate for the requested currency
	 */
	rate: number
	/**
	 * Unix timestamp (ms) when rates were fetched
	 */
	fetchedAt: number
	/**
	 * Whether the returned rate was served from cache
	 */
	cached: boolean
}

export interface RequestPathInput {
	/**
	 * Root event id of the kind-30408 auction listing.
	 */
	auctionEventId: string
	/**
	 * Auction coordinate `30408:<seller-pubkey>:<d-tag>`.
	 */
	auctionCoordinates: string
	/**
	 * Compressed secp256k1 pubkey (33 bytes hex, 02/03 prefix) used in the NUT-11 refund condition.
	 */
	bidderRefundPubkey: string
	/**
	 * Bidder-claimed bid amount in sats. Used by the anti-snipe floor and the grant→lock binding.
	 */
	intendedAmount: number
}

export interface RequestPathOutput {
	/**
	 * Server-issued opaque id; echo back in submit_bid_token.
	 */
	grantId: string
	/**
	 * HD path the issuer assigned. Bidder MUST verify per AUCTIONS.md §5.6.
	 */
	derivationPath: string
	/**
	 * Compressed secp256k1 pubkey used as the P2PK lock key.
	 */
	childPubkey: string
	/**
	 * Echo of the auction `p2pk_xpub` for bidder-side verification.
	 */
	xpub: string
	/**
	 * Issuer Nostr pubkey (server identity).
	 */
	pathIssuerPubkey: string
	/**
	 * Unix seconds.
	 */
	issuedAt: number
	/**
	 * Unix seconds. Grant is invalid for submit_bid_token after this point.
	 */
	expiresAt: number
	/**
	 * Floor enforced when this grant was issued. Equals `intendedAmount` for now; server uses this in chain-validity checks.
	 */
	acceptedFloor: number
}

export interface SubmitBidTokenInput {
	auctionEventId: string
	auctionCoordinates: string
	/**
	 * Id of the kind-1023 commitment event the bidder just published.
	 */
	bidEventId: string
	/**
	 * Echo of the request_path grantId.
	 */
	grantId: string
	/**
	 * P2PK lock pubkey actually used in the proofs. MUST equal grant.childPubkey.
	 */
	lockPubkey: string
	refundPubkey: string
	/**
	 * Cashu mint URL of the locked proofs. MUST be in the auction allowlist.
	 */
	mintUrl: string
	/**
	 * This bid leg amount in sats.
	 */
	amount: number
	/**
	 * Bidder cumulative bid total in sats (sum of leg amounts).
	 */
	totalBidAmount: number
	/**
	 * Hex SHA-256 of the encoded token; matches the kind-1023 `commitment` tag.
	 */
	commitment: string
	bidNonce: string
	/**
	 * Cashu P2PK locktime; MUST equal `max_end_at + settlement_grace`.
	 */
	locktime: number
	/**
	 * Encoded Cashu token containing the locked proofs.
	 */
	token: string
}

export interface SubmitBidTokenOutput {
	bidEventId: string
	registryStatus: 'locked' | 'rejected'
	/**
	 * Present iff registryStatus === "rejected". Stable, machine-readable code.
	 */
	rejectReason?: string
}

export interface RequestSettlementInput {
	auctionEventId: string
	auctionCoordinates?: string
}

export interface RequestSettlementOutput {
	status: 'settled' | 'reserve_not_met' | 'cancelled'
	closeAt: number
	reserve: number
	finalAmount: number
	/**
	 * Empty string when no winner.
	 */
	winningBidEventId: string
	/**
	 * Empty string when no winner.
	 */
	winnerPubkey: string
	releaseId?: string
	/**
	 * One entry per leg of the winning bid chain. Empty for non-settled outcomes.
	 */
	releases: {
		bidEventId: string
		derivationPath: string
		childPubkey: string
		bidderPubkey: string
		mintUrl: string
		amount: number
		totalBidAmount: number
		commitment: string
		locktime: number
		refundPubkey: string
		/**
		 * Encoded Cashu token; seller redeems with the derived child privkey.
		 */
		token: string
	}[]
}

export interface GetAuctionStateInput {
	auctionEventId: string
}

export interface GetAuctionStateOutput {
	phase: 'scheduled' | 'active' | 'closing' | 'ended'
	startAt: number
	endAt: number
	effectiveEndAt: number
	maxEndAt: number
	/**
	 * Minimum acceptable bid amount at server-now per the auction `bid_increment` and (future) anti-snipe curve.
	 */
	currentFloor: number
	topBidAmount: number
	bidCount: number
	pathsIssued: number
	pathsLocked: number
}

export type PlebeianServer = {
	GetBtcPrice: (refresh?: boolean) => Promise<GetBtcPriceOutput>
	GetBtcPriceSingle: (currency: string, refresh?: boolean) => Promise<GetBtcPriceSingleOutput>
	RequestPath: (
		auctionEventId: string,
		auctionCoordinates: string,
		bidderRefundPubkey: string,
		intendedAmount: number,
	) => Promise<RequestPathOutput>
	SubmitBidToken: (
		auctionEventId: string,
		auctionCoordinates: string,
		bidEventId: string,
		grantId: string,
		lockPubkey: string,
		refundPubkey: string,
		mintUrl: string,
		amount: number,
		totalBidAmount: number,
		commitment: string,
		bidNonce: string,
		locktime: number,
		token: string,
	) => Promise<SubmitBidTokenOutput>
	RequestSettlement: (auctionEventId: string, auctionCoordinates?: string) => Promise<RequestSettlementOutput>
	GetAuctionState: (auctionEventId: string) => Promise<GetAuctionStateOutput>
}

export class PlebeianServerClient implements PlebeianServer {
	static readonly SERVER_PUBKEY = '29bd6461f780c07b29c89b4df8017db90973d5608a3cd811a0522b15c1064f15'
	static readonly DEFAULT_RELAYS = ['ws://localhost:10547']
	private client: Client
	private transport: Transport

	constructor(options: Partial<NostrTransportOptions> & { privateKey?: string; relays?: string[] } = {}) {
		this.client = new Client({
			name: 'PlebeianServerClient',
			version: '1.0.0',
		})

		// Private key precedence: constructor options > config file
		const resolvedPrivateKey = options.privateKey || ''

		// Use options.signer if provided, otherwise create from resolved private key
		const signer = options.signer || new PrivateKeySigner(resolvedPrivateKey)
		// Use options.relays if provided, otherwise use class DEFAULT_RELAYS
		const relays = options.relays || PlebeianServerClient.DEFAULT_RELAYS
		// Use options.relayHandler if provided, otherwise create from relays
		const relayHandler = options.relayHandler || new ApplesauceRelayPool(relays)
		const serverPubkey = options.serverPubkey
		const { privateKey: _, ...rest } = options

		this.transport = new NostrClientTransport({
			serverPubkey: serverPubkey || PlebeianServerClient.SERVER_PUBKEY,
			signer,
			relayHandler,
			isStateless: true,
			...rest,
		})

		// Auto-connect in constructor
		this.client.connect(this.transport).catch((error) => {
			console.error(`Failed to connect to server: ${error}`)
		})
	}

	async disconnect(): Promise<void> {
		await this.transport.close()
	}

	// NOTE: HAND-EDIT after `bunx ctxcn add` — re-running ctxcn will
	// overwrite this back to the no-error-handling default. The error
	// detection below MUST be re-applied. Tracker:
	// https://github.com/ContextVM/ctxcn (file an issue if you want this
	// upstream).
	private async call<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
		const result = await this.client.callTool({
			name,
			arguments: { ...args },
		})
		if (result.isError) {
			const message =
				typeof (result.structuredContent as { error?: unknown })?.error === 'string'
					? (result.structuredContent as { error: string }).error
					: `${name} returned isError but no structuredContent.error`
			throw new Error(message)
		}
		return result.structuredContent as T
	}

	/**
	 * Get BTC exchange rates for all supported fiat currencies. Aggregates from Yadio, CoinDesk, Binance, and CoinGecko with median calculation.
	 * @param {boolean} refresh [optional] Force refresh of rates, bypassing the server cache
	 * @returns {Promise<GetBtcPriceOutput>} The result of the get_btc_price operation
	 */
	async GetBtcPrice(refresh?: boolean): Promise<GetBtcPriceOutput> {
		return this.call('get_btc_price', { refresh })
	}

	/**
	 * Get the BTC exchange rate for a specific fiat currency.
	 * @param {string} currency ISO 4217 currency code, e.g. USD, EUR, JPY
	 * @param {boolean} refresh [optional] Force refresh of rates, bypassing the server cache
	 * @returns {Promise<GetBtcPriceSingleOutput>} The result of the get_btc_price_single operation
	 */
	async GetBtcPriceSingle(currency: string, refresh?: boolean): Promise<GetBtcPriceSingleOutput> {
		return this.call('get_btc_price_single', { currency, refresh })
	}

	/**
	 * AUCTIONS.md §7.5.1 — Bidder requests a fresh HD derivation path before locking Cashu proofs. The issuer allocates a path, derives the matching child pubkey, and persists the grant in its kind-30410 registry.
	 * @param {string} auctionEventId Root event id of the kind-30408 auction listing.
	 * @param {string} auctionCoordinates Auction coordinate `30408:<seller-pubkey>:<d-tag>`.
	 * @param {string} bidderRefundPubkey Compressed secp256k1 pubkey (33 bytes hex, 02/03 prefix) used in the NUT-11 refund condition.
	 * @param {number} intendedAmount Bidder-claimed bid amount in sats. Used by the anti-snipe floor and the grant→lock binding.
	 * @returns {Promise<RequestPathOutput>} The result of the request_path operation
	 */
	async RequestPath(
		auctionEventId: string,
		auctionCoordinates: string,
		bidderRefundPubkey: string,
		intendedAmount: number,
	): Promise<RequestPathOutput> {
		return this.call('request_path', { auctionEventId, auctionCoordinates, bidderRefundPubkey, intendedAmount })
	}

	/**
	 * AUCTIONS.md §7 — After publishing the kind-1023 commitment, the bidder submits the locked Cashu token plus lock parameters. The issuer runs the §7 MUST checks (mint allowlist, locktime invariant, grant binding) and advances the registry entry from `issued` to `locked`.
	 * @param {string} auctionEventId The auction event id parameter
	 * @param {string} auctionCoordinates The auction coordinates parameter
	 * @param {string} bidEventId Id of the kind-1023 commitment event the bidder just published.
	 * @param {string} grantId Echo of the request_path grantId.
	 * @param {string} lockPubkey P2PK lock pubkey actually used in the proofs. MUST equal grant.childPubkey.
	 * @param {string} refundPubkey The refund pubkey parameter
	 * @param {string} mintUrl Cashu mint URL of the locked proofs. MUST be in the auction allowlist.
	 * @param {number} amount This bid leg amount in sats.
	 * @param {number} totalBidAmount Bidder cumulative bid total in sats (sum of leg amounts).
	 * @param {string} commitment Hex SHA-256 of the encoded token; matches the kind-1023 `commitment` tag.
	 * @param {string} bidNonce The bid nonce parameter
	 * @param {number} locktime Cashu P2PK locktime; MUST equal `max_end_at + settlement_grace`.
	 * @param {string} token Encoded Cashu token containing the locked proofs.
	 * @returns {Promise<SubmitBidTokenOutput>} The result of the submit_bid_token operation
	 */
	async SubmitBidToken(
		auctionEventId: string,
		auctionCoordinates: string,
		bidEventId: string,
		grantId: string,
		lockPubkey: string,
		refundPubkey: string,
		mintUrl: string,
		amount: number,
		totalBidAmount: number,
		commitment: string,
		bidNonce: string,
		locktime: number,
		token: string,
	): Promise<SubmitBidTokenOutput> {
		return this.call('submit_bid_token', {
			auctionEventId,
			auctionCoordinates,
			bidEventId,
			grantId,
			lockPubkey,
			refundPubkey,
			mintUrl,
			amount,
			totalBidAmount,
			commitment,
			bidNonce,
			locktime,
			token,
		})
	}

	/**
	 * AUCTIONS.md §7.5.3 — Seller asks the issuer to compute the winning chain and release the corresponding derivation paths + locked Cashu tokens. Reserve-not-met returns an empty `releases` array.
	 * @param {string} auctionEventId The auction event id parameter
	 * @param {string} auctionCoordinates [optional] The auction coordinates parameter
	 * @returns {Promise<RequestSettlementOutput>} The result of the request_settlement operation
	 */
	async RequestSettlement(auctionEventId: string, auctionCoordinates?: string): Promise<RequestSettlementOutput> {
		return this.call('request_settlement', { auctionEventId, auctionCoordinates })
	}

	/**
	 * Read-only view of an auction's current floor, top bid, bid count, and registry health (paths issued vs locked). Public — no caller identity required.
	 * @param {string} auctionEventId The auction event id parameter
	 * @returns {Promise<GetAuctionStateOutput>} The result of the get_auction_state operation
	 */
	async GetAuctionState(auctionEventId: string): Promise<GetAuctionStateOutput> {
		return this.call('get_auction_state', { auctionEventId })
	}
}
