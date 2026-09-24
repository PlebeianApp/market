export const COCO_AUCTIONSDEV_SMOKE_SAFE = {
	baseUrl: 'http://localhost:34567',
	relayUrl: 'ws://localhost:10547',
	mintUrl: 'http://localhost:3338',
	environmentId: 'test',
	monetaryMode: 'fake',
} as const

/** Stable public NUT-06 identity used only by the isolated local fake mint. */
export const COCO_AUCTIONSDEV_FAKE_MINT_INFO = Object.freeze({
	name: 'Plebeian Test Mint',
	pubkey: '0382d578c4ce78d9a0d9d85dc738ba5a3d62a029b605e417311fc6b2578462f55c',
	version: 'Nutshell/0.21.0',
	description: 'Local test mint for e2e tests',
	contact: [],
	time: 0,
	max_array_length: 1000,
	nuts: {
		'4': { methods: [{ method: 'bolt11', unit: 'sat', method_name: 'bolt11', options: { description: true } }], disabled: false },
		'5': { methods: [{ method: 'bolt11', unit: 'sat', method_name: 'bolt11' }], disabled: false },
		'7': { supported: true },
		'8': { supported: true },
		'9': { supported: true },
		'10': { supported: true },
		'11': { supported: true },
		'12': { supported: true },
		'14': { supported: true },
		'17': { supported: [{ method: 'bolt11', unit: 'sat', commands: ['bolt11_melt_quote', 'proof_state', 'bolt11_mint_quote'] }] },
		'20': { supported: true },
		'29': { supported: true, max_batch_size: 1000, methods: ['bolt11'] },
	},
})

export const COCO_AUCTIONSDEV_FAKE_MINT_INFO_COMMITMENT = 'sha256:6393f1ce0ad4521c39e0898366b757a58d884208a76c83fc90d5719fec7d81ee' as const
