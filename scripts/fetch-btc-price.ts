import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { NostrClientTransport, PrivateKeySigner, ApplesauceRelayPool } from '@contextvm/sdk'
import { config } from 'dotenv'
import { getPublicKey } from 'nostr-tools/pure'

config({ path: ['.env.local', '.env'] })

const RELAY_URL = process.argv[2] || 'ws://100.90.22.201:10547'
const DEFAULT_CVM_SERVER_KEY = '2300f5fff5642341946758cad8214f2c54f3c40fba5ba51b616452b197fd3e71'
const DEFAULT_CVM_SERVER_PUBKEY = getPublicKey(new Uint8Array(Buffer.from(DEFAULT_CVM_SERVER_KEY, 'hex')))

function getCvmServerPubkey(): string {
	const configuredServerPrivateKey = process.env.CVM_SERVER_KEY
	if (configuredServerPrivateKey && /^[0-9a-fA-F]{64}$/.test(configuredServerPrivateKey)) {
		return getPublicKey(new Uint8Array(Buffer.from(configuredServerPrivateKey, 'hex')))
	}

	return process.env.CVM_SERVER_PUBKEY || process.env.CURRENCY_SERVER_PUBKEY || DEFAULT_CVM_SERVER_PUBKEY
}

const CVM_SERVER_PUBKEY = getCvmServerPubkey()

const ephemeralKey = crypto.getRandomValues(new Uint8Array(32))
const hexKey = Array.from(ephemeralKey)
	.map((b) => b.toString(16).padStart(2, '0'))
	.join('')

console.log(`Connecting to relay: ${RELAY_URL}`)
console.log(`Server pubkey: ${CVM_SERVER_PUBKEY}`)

const signer = new PrivateKeySigner(hexKey)
const relayPool = new ApplesauceRelayPool([RELAY_URL])

const transport = new NostrClientTransport({
	signer,
	relayHandler: relayPool,
	serverPubkey: CVM_SERVER_PUBKEY,
	isStateless: true,
})

const client = new Client({ name: 'btc-price-cli', version: '1.0.0' })
await client.connect(transport)

console.log('Connected. Calling get_btc_price...\n')

const result = await client.callTool({ name: 'get_btc_price', arguments: {} })
const structured = (result as any)?.structuredContent

if (structured?.rates) {
	console.log(`Sources succeeded: ${structured.sourcesSucceeded?.join(', ') || 'unknown'}`)
	console.log(`Sources failed:    ${structured.sourcesFailed?.join(', ') || 'none'}`)
	console.log(`Cached:            ${structured.cached ?? false}`)
	console.log(`Fetched at:        ${new Date(structured.fetchedAt).toISOString()}`)
	console.log()

	const rates = structured.rates as Record<string, number>
	for (const [currency, price] of Object.entries(rates)) {
		console.log(`  1 BTC = ${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`)
	}
} else if (structured?.error) {
	console.error('Error:', structured.error)
} else {
	console.error('Unexpected response:', JSON.stringify(result, null, 2))
}

await client.close()
process.exit(0)
