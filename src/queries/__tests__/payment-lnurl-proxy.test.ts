import { describe, test, expect, mock, beforeEach, beforeAll } from 'bun:test'

// payment.tsx reads deleted-payment-detail IDs from localStorage at module-load
// time. Provide a shim so that evaluation is clean (the production code already
// tolerates a missing localStorage via try/catch; this keeps test output quiet).
;(globalThis as any).localStorage = (() => {
	const store = new Map<string, string>()
	return {
		getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
		setItem: (k: string, v: string) => {
			store.set(k, v)
		},
		removeItem: (k: string) => {
			store.delete(k)
		},
		clear: () => {
			store.clear()
		},
	}
})()

// Capture every LightningAddress constructor invocation so we can assert the
// options passed to @getalby/lightning-tools.
const lightningConstructorCalls: Array<{ address: string; options: unknown }> = []

mock.module('@getalby/lightning-tools', () => ({
	LightningAddress: class MockLightningAddress {
		lnurlpData: { allowsNostr: false } = { allowsNostr: false }
		nostrPubkey: string | null = null
		constructor(address: string, options?: unknown) {
			lightningConstructorCalls.push({ address, options })
		}
		async fetch() {
			/* mocked: lnurlpData populated above */
		}
		async requestInvoice() {
			return { paymentRequest: 'lnbc1mockinvoice', expiry: 3600 }
		}
	},
}))

// Minimal NDK stub: getNDK() returns a user whose profile already carries a lud16
// so generateInvoice takes the v4v fast-path without touching relays.
mock.module('@/lib/stores/ndk', () => ({
	ndkActions: {
		getNDK: () => ({
			getUser: () => ({
				profile: { displayName: 'Test Seller', lud16: 'seller@example.com' },
				fetchProfile: async () => {
					/* profile already populated */
				},
			}),
		}),
	},
}))

// Break the circular import with @/publish/payment; generateInvoice never calls these.
mock.module('@/publish/payment', () => ({
	payInvoiceWithNwc: async () => ({ preimage: 'mock' }),
	payInvoiceWithWebln: async () => ({ preimage: 'mock' }),
}))

// Dynamic import so the localStorage shim + mock.module calls above are in place
// before payment.tsx is evaluated.
let generateInvoice: (typeof import('../payment'))['generateInvoice']
beforeAll(async () => {
	;({ generateInvoice } = await import('../payment'))
})

describe('generateInvoice - LNURL proxy bypass (#703)', () => {
	beforeEach(() => {
		lightningConstructorCalls.length = 0
	})

	test('constructs LightningAddress with { proxy: false } to bypass api.getalby.com', async () => {
		const result = await generateInvoice({
			sellerPubkey: 'a'.repeat(64),
			amountSats: 1000,
			description: 'test invoice',
			invoiceId: 'inv-1',
			items: [],
			type: 'v4v',
		})

		// The invoice should generate successfully via the mocked LNURL provider.
		expect(result.status).toBe('pending')
		expect(result.bolt11).toBe('lnbc1mockinvoice')

		// LightningAddress must be constructed exactly once with proxy disabled.
		// Without { proxy: false } the Alby SDK routes LNURL requests through
		// api.getalby.com, which breaks e2e payment tests (issue #703).
		expect(lightningConstructorCalls).toHaveLength(1)
		expect(lightningConstructorCalls[0].address).toBe('seller@example.com')
		expect(lightningConstructorCalls[0].options).toEqual({ proxy: false })
	})
})
