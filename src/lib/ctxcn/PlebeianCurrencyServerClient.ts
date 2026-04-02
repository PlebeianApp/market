import { Client } from '@modelcontextprotocol/sdk/client'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { ApplesauceRelayPool, NostrClientTransport, PrivateKeySigner, type NostrTransportOptions } from '@contextvm/sdk'

// Checked-in generated-style ctxcn artifact for typed tool contracts.
// Active browser runtime intentionally uses the nostr-tools client path instead.

export type GetBtcPriceInput = {
	refresh?: boolean
}

export type GetBtcPriceOutput = {
	rates: Record<string, number>
	sourcesSucceeded: string[]
	sourcesFailed: string[]
	fetchedAt: number
	cached: boolean
	error?: string
}

export type GetBtcPriceSingleInput = {
	currency: string
	refresh?: boolean
}

export type GetBtcPriceSingleOutput = {
	currency: string
	rate: number
	fetchedAt: number
	cached: boolean
	error?: string
}

export class PlebeianCurrencyServerClient {
	static readonly SERVER_PUBKEY = '29bd6461f780c07b29c89b4df8017db90973d5608a3cd811a0522b15c1064f15'
	static readonly DEFAULT_RELAYS = ['wss://relay.contextvm.org', 'wss://relay2.contextvm.org']

	private client: Client
	private transport: Transport

	constructor(options: Partial<NostrTransportOptions> & { privateKey?: string; relays?: string[] } = {}) {
		this.client = new Client({ name: 'PlebeianCurrencyServerClient', version: '1.0.0' })

		const resolvedPrivateKey =
			options.privateKey ||
			process.env.CTXCN_PRIVATE_KEY ||
			process.env.CVM_SERVER_KEY ||
			Array.from(crypto.getRandomValues(new Uint8Array(32)))
				.map((b) => b.toString(16).padStart(2, '0'))
				.join('')

		const signer = options.signer || new PrivateKeySigner(resolvedPrivateKey)
		const relays = options.relays || PlebeianCurrencyServerClient.DEFAULT_RELAYS
		const relayHandler = options.relayHandler || new ApplesauceRelayPool(relays)
		const { privateKey: _, ...rest } = options

		this.transport = new NostrClientTransport({
			serverPubkey: options.serverPubkey || PlebeianCurrencyServerClient.SERVER_PUBKEY,
			signer,
			relayHandler,
			isStateless: true,
			...rest,
		})

		this.client.connect(this.transport).catch((error) => {
			console.error(`Failed to connect to currency server: ${error}`)
		})
	}

	async disconnect(): Promise<void> {
		await this.transport.close()
	}

	private async call<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
		const result = await this.client.callTool({
			name,
			arguments: { ...args },
		})
		return result.structuredContent as T
	}

	async getBtcPrice(args: GetBtcPriceInput = {}): Promise<GetBtcPriceOutput> {
		return this.call<GetBtcPriceOutput>('get_btc_price', args)
	}

	async getBtcPriceSingle(args: GetBtcPriceSingleInput): Promise<GetBtcPriceSingleOutput> {
		return this.call<GetBtcPriceSingleOutput>('get_btc_price_single', args)
	}
}
