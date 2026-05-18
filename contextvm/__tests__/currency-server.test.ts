import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { SUPPORTED_FIAT, type AggregatedRates } from '../tools/price-sources'
import { getBtcPriceInputSchema, getBtcPriceOutputSchema, getBtcPriceSingleInputSchema, getBtcPriceSingleOutputSchema } from '../schemas'

const MOCK_RATES: Record<string, number> = {}
for (const code of SUPPORTED_FIAT) {
	MOCK_RATES[code] = Math.floor(Math.random() * 1000000) + 10000
}

function createMockAggregatedRates(overrides?: Partial<AggregatedRates>): AggregatedRates {
	return {
		rates: MOCK_RATES as any,
		sources: ['yadio', 'coindesk', 'binance', 'coingecko'],
		fetchedAt: Date.now(),
		sourcesSucceeded: ['yadio', 'coindesk', 'binance', 'coingecko'],
		sourcesFailed: [],
		...overrides,
	}
}

describe('currency-server integration', () => {
	let fetchSpy: ReturnType<typeof spyOn>

	beforeEach(() => {
		fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(() => {
			return new Response('blocked', { status: 403 })
		})
	})

	afterEach(() => {
		fetchSpy?.mockRestore()
	})

	async function createServerAndClient() {
		const mcpServer = new McpServer({
			name: 'test-currency-server',
			version: '1.0.0',
		})

		const CACHE_TTL_MS = 100
		let cachedRates: AggregatedRates | null = null
		let cacheTimer: ReturnType<typeof setTimeout> | null = null

		async function getRates(forceRefresh = false): Promise<AggregatedRates> {
			if (!forceRefresh && cachedRates && Date.now() - cachedRates.fetchedAt < CACHE_TTL_MS) {
				return { ...cachedRates, cached: true }
			}
			const rates = createMockAggregatedRates()
			cachedRates = rates
			if (cacheTimer) clearTimeout(cacheTimer)
			cacheTimer = setTimeout(() => {
				cachedRates = null
				cacheTimer = null
			}, CACHE_TTL_MS)
			return { ...rates, cached: false }
		}

		mcpServer.registerTool(
			'get_btc_price',
			{
				title: 'Get BTC Price',
				description: 'Get BTC exchange rates for all supported fiat currencies.',
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
					const upperCurrency = currency.toUpperCase()
					if (!(SUPPORTED_FIAT as readonly string[]).includes(upperCurrency)) {
						return {
							content: [],
							structuredContent: {
								error: `Unsupported currency: ${currency}. Supported: ${SUPPORTED_FIAT.join(', ')}`,
							},
							isError: true,
						}
					}
					const result = await getRates(refresh)
					const rate = result.rates[upperCurrency as keyof typeof result.rates]
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

		const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
		await mcpServer.connect(serverTransport)

		const client = new Client({ name: 'test-client', version: '1.0.0' })
		await client.connect(clientTransport)

		return {
			client,
			close: async () => {
				await client.close()
			},
		}
	}

	test('get_btc_price - fresh fetch returns rates', async () => {
		const { client, close } = await createServerAndClient()

		try {
			const result = await client.callTool({ name: 'get_btc_price', arguments: {} })
			const structured = (result as any)?.structuredContent

			expect(structured).toBeDefined()
			expect(structured.error).toBeUndefined()
			expect(typeof structured.rates).toBe('object')
			expect(structured.rates.USD).toBeGreaterThan(0)
			expect(structured.cached).toBe(false)
			expect(structured.sourcesSucceeded.length).toBeGreaterThan(0)
			expect(Array.isArray(structured.sourcesFailed)).toBe(true)
			expect(structured.fetchedAt).toBeGreaterThan(0)
		} finally {
			await close()
		}
	})

	test('get_btc_price - force refresh bypasses cache', async () => {
		const { client, close } = await createServerAndClient()

		try {
			const result1 = await client.callTool({ name: 'get_btc_price', arguments: {} })
			expect((result1 as any).structuredContent.cached).toBe(false)

			const result2 = await client.callTool({ name: 'get_btc_price', arguments: {} })
			expect((result2 as any).structuredContent.cached).toBe(true)

			const result3 = await client.callTool({ name: 'get_btc_price', arguments: { refresh: true } })
			expect((result3 as any).structuredContent.cached).toBe(false)
		} finally {
			await close()
		}
	})

	test('get_btc_price - source failure returns error', async () => {
		const { client, close } = await createServerAndClientWithFailure()

		try {
			const result = await client.callTool({ name: 'get_btc_price', arguments: {} })
			const structured = (result as any)?.structuredContent
			expect(structured.error).toBeDefined()
			expect((result as any).isError).toBe(true)
		} finally {
			await close()
		}
	})

	test('get_btc_price_single - returns rate for valid currency', async () => {
		const { client, close } = await createServerAndClient()

		try {
			const result = await client.callTool({ name: 'get_btc_price_single', arguments: { currency: 'USD' } })
			const structured = (result as any)?.structuredContent

			expect(structured.error).toBeUndefined()
			expect(structured.currency).toBe('USD')
			expect(typeof structured.rate).toBe('number')
			expect(structured.rate).toBeGreaterThan(0)
			expect(structured.fetchedAt).toBeGreaterThan(0)
		} finally {
			await close()
		}
	})

	test('get_btc_price_single - returns error for unsupported currency', async () => {
		const { client, close } = await createServerAndClient()

		try {
			const result = await client.callTool({ name: 'get_btc_price_single', arguments: { currency: 'XYZ' } })
			const structured = (result as any)?.structuredContent

			expect(structured.error).toContain('Unsupported currency: XYZ')
			expect((result as any).isError).toBe(true)
		} finally {
			await close()
		}
	})

	test('get_btc_price_single - returns error when currency has no rate', async () => {
		const { client, close } = await createServerAndClientWithNoRate()

		try {
			const result = await client.callTool({ name: 'get_btc_price_single', arguments: { currency: 'EUR' } })
			const structured = (result as any)?.structuredContent

			expect(structured.error).toContain('No rate available for EUR')
			expect((result as any).isError).toBe(true)
		} finally {
			await close()
		}
	})

	test('get_btc_price - lists tools correctly', async () => {
		const { client, close } = await createServerAndClient()

		try {
			const tools = await client.listTools()
			const toolNames = tools.tools.map((t: any) => t.name)

			expect(toolNames).toContain('get_btc_price')
			expect(toolNames).toContain('get_btc_price_single')
		} finally {
			await close()
		}
	})
})

async function createServerAndClientWithFailure() {
	const mcpServer = new McpServer({
		name: 'test-currency-server-fail',
		version: '1.0.0',
	})

	mcpServer.registerTool(
		'get_btc_price',
		{
			title: 'Get BTC Price',
			description: 'Always fails',
			inputSchema: getBtcPriceInputSchema,
			outputSchema: getBtcPriceOutputSchema,
		},
		async () => ({
			content: [],
			structuredContent: { error: 'All 4 price sources failed: network error' },
			isError: true,
		}),
	)

	const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
	await mcpServer.connect(serverTransport)

	const client = new Client({ name: 'test-client', version: '1.0.0' })
	await client.connect(clientTransport)

	return {
		client,
		close: async () => {
			await client.close()
		},
	}
}

async function createServerAndClientWithNoRate() {
	const mcpServer = new McpServer({
		name: 'test-currency-server-norate',
		version: '1.0.0',
	})

	const partialRates: Record<string, number> = { USD: 100000 }
	const cachedRates: AggregatedRates = {
		rates: partialRates as any,
		sources: ['yadio'],
		fetchedAt: Date.now(),
		sourcesSucceeded: ['yadio'],
		sourcesFailed: [],
	}

	mcpServer.registerTool(
		'get_btc_price_single',
		{
			title: 'Get BTC Price for Single Currency',
			description: 'Partial rates',
			inputSchema: getBtcPriceSingleInputSchema,
			outputSchema: getBtcPriceSingleOutputSchema,
		},
		async ({ currency }) => {
			const upperCurrency = currency.toUpperCase()
			if (!(SUPPORTED_FIAT as readonly string[]).includes(upperCurrency)) {
				return {
					content: [],
					structuredContent: { error: `Unsupported currency: ${currency}` },
					isError: true,
				}
			}
			const rate = cachedRates.rates[upperCurrency as keyof typeof cachedRates.rates]
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
					fetchedAt: cachedRates.fetchedAt,
					cached: false,
				},
			}
		},
	)

	const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
	await mcpServer.connect(serverTransport)

	const client = new Client({ name: 'test-client', version: '1.0.0' })
	await client.connect(clientTransport)

	return {
		client,
		close: async () => {
			await client.close()
		},
	}
}
