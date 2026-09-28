import { describe, expect, test } from 'bun:test'
import { sha256 } from '@noble/hashes/sha2.js'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { createAppPayoutSeams, createZapPayoutAppSeams } from '../v4v/zapPayoutAppSeams'
import { runZapPayout } from '../v4v/zapPayoutRunner'
import { planZapPayout, type ZapPayoutPlan } from '../v4v/payoutPlan'

/**
 * Everything the binding reaches for is injected, so these tests touch no wallet, no HTTP and no relay.
 * The one import that is not injected — the wallet store — is only *named* by the module until a payment
 * actually goes through that path.
 */
const recipientPubkey = getPublicKey(sha256(new TextEncoder().encode('app-seams-recipient')))
const auctionAnchor = { kind: 'a' as const, value: '30408:' + 'a'.repeat(64) + ':auction-1' }

const payDocument = {
	tag: 'payRequest',
	callback: 'https://pay.example.com/lnurlp/alice/callback',
	minSendable: 1000,
	maxSendable: 100_000_000,
	allowsNostr: true,
	nostrPubkey: 'a'.repeat(64),
}

const signer = {
	async sign(event: unknown) {
		return { ...(event as Record<string, unknown>), pubkey: recipientPubkey, sig: 'sig', id: 'id' }
	},
}

const binding = (overrides: Partial<Parameters<typeof createZapPayoutAppSeams>[0]> = {}) =>
	createZapPayoutAppSeams({
		signer,
		nwcUri: 'nostr+walletconnect://test',
		findReceiptEvents: async () => null,
		fetchImpl: (async () => ({ ok: true, json: async () => payDocument })) as unknown as typeof fetch,
		now: () => 1_700_000_000_000,
		...overrides,
	})

describe('getJson — the endpoint answering, or not', () => {
	test('returns the parsed body', async () => {
		expect(await binding().getJson('https://pay.example.com/x')).toMatchObject({ tag: 'payRequest' })
	})

	test('a non-2xx status becomes a message naming the status, because 404 and 500 are different problems', async () => {
		const failing = binding({ fetchImpl: (async () => ({ ok: false, status: 502, json: async () => ({}) })) as unknown as typeof fetch })
		await expect(failing.getJson('https://pay.example.com/x')).rejects.toThrow('502')
	})
})

describe('buildZapRequest — the app has no 9734 builder, so this is where one is assembled', () => {
	test('it signs a draft whose amount is in millisats and whose relays travel', async () => {
		const seams = binding()
		const request = await seams.buildZapRequest({ amountSats: 250, relays: ['wss://relay.example.com'], auctionAnchor, recipientPubkey })
		const parsed = JSON.parse(request.description) as { kind: number; tags: string[][] }
		expect(parsed.kind).toBe(9734)
		expect(parsed.tags.find((tag) => tag[0] === 'amount')?.[1]).toBe('250000')
		expect(parsed.tags.find((tag) => tag[0] === 'relays')?.[1]).toBe('wss://relay.example.com')
		expect(request.recipientPubkey).toBe(recipientPubkey)
	})

	test('the description is the signed event itself, so the server hashes what was actually signed', async () => {
		const request = await binding().buildZapRequest({ amountSats: 1, relays: ['wss://relay.example.com'], auctionAnchor })
		expect(JSON.parse(request.description)).toMatchObject({ kind: 9734, pubkey: recipientPubkey, sig: 'sig' })
	})

	test('an unbuildable request (no relays) fails loudly rather than paying an unverifiable zap', async () => {
		await expect(binding().buildZapRequest({ amountSats: 1, relays: [], auctionAnchor })).rejects.toThrow('relays_missing')
	})

	test('the same inputs produce the same created_at, taken from the injected clock', async () => {
		const request = await binding().buildZapRequest({ amountSats: 1, relays: ['wss://relay.example.com'], auctionAnchor })
		expect((JSON.parse(request.description) as { created_at: number }).created_at).toBe(1_700_000_000)
	})
})

describe('payInvoice — the wallet throws, the seam speaks in results', () => {
	test('a successful payment passes the preimage through', async () => {
		const seams = binding({ payInvoiceImpl: async () => ({ preimage: 'abc' }) })
		expect(await seams.payInvoice({ bolt11: 'lnbc1u1qx' })).toEqual({ ok: true, preimage: 'abc' })
	})

	test('a payment without a preimage is still a success, reported as one', async () => {
		const seams = binding({ payInvoiceImpl: async () => ({}) })
		expect(await seams.payInvoice({ bolt11: 'lnbc1u1qx' })).toEqual({ ok: true })
	})

	test("a throw becomes a failed payment carrying the wallet's own reason", async () => {
		const seams = binding({
			payInvoiceImpl: async () => {
				throw new Error('insufficient balance')
			},
		})
		expect(await seams.payInvoice({ bolt11: 'lnbc1u1qx' })).toEqual({ ok: false, detail: 'insufficient balance' })
	})
})

describe('the binding and the runner compose into a payout', () => {
	const plan = (): ZapPayoutPlan => {
		const result = planZapPayout({ rows: [{ id: '1', destination: 'alice@example.com', bps: 10000 }], settledSats: 100, minimumZapSats: 1 })
		if ('ok' in result && !result.ok) throw new Error('fixture plan refused')
		return result as ZapPayoutPlan
	}

	test('a run over the app seams, with the wallet and the endpoint injected, pays and records the outcome', async () => {
		const paid: string[] = []
		const seams = createAppPayoutSeams({
			signer,
			nwcUri: 'nostr+walletconnect://test',
			findReceiptEvents: async () => null,
			payInvoiceImpl: async ({ bolt11 }) => {
				paid.push(bolt11)
				return { preimage: 'deadbeef' }
			},
			fetchImpl: (async (url: string) =>
				({
					ok: true,
					json: async () => (String(url).includes('/callback') ? { pr: 'lnbc1u1' + 'q'.repeat(20) } : payDocument),
				}) as never) as unknown as typeof fetch,
			now: () => 1_700_000_000_000,
		})

		const result = await runZapPayout({ plan: plan(), seams, relays: ['wss://relay.example.com'], now: 1_700_000_000, auctionAnchor })

		expect(paid).toHaveLength(1)
		// paid, but with no receipt found it is paid_unconfirmed — the binding must not upgrade that
		expect(result.rows[0].status).toBe('paid_unconfirmed')
		expect(result.paidSats).toBe(100)
	})

	test('a wallet that throws leaves the sats disclosed as unspent, not silently lost', async () => {
		const seams = createAppPayoutSeams({
			signer,
			nwcUri: 'nostr+walletconnect://test',
			findReceiptEvents: async () => null,
			payInvoiceImpl: async () => {
				throw new Error('wallet offline')
			},
			fetchImpl: (async (url: string) =>
				({
					ok: true,
					json: async () => (String(url).includes('/callback') ? { pr: 'lnbc1u1' + 'q'.repeat(20) } : payDocument),
				}) as never) as unknown as typeof fetch,
		})

		const result = await runZapPayout({ plan: plan(), seams, relays: ['wss://relay.example.com'], now: 1_700_000_000, auctionAnchor })
		expect(result.rows[0]).toMatchObject({ status: 'payment_failed', detail: 'wallet offline' })
		expect(result.unspentSats).toBe(100)
		expect(result.needsAttention).toEqual(['1'])
	})
})

describe('a receipt found by the app is verified by the same rule as everywhere else', () => {
	test('a genuinely signed receipt turns the row into paid', async () => {
		const serverKey = sha256(new TextEncoder().encode('app-seams-server'))
		const serverPubkey = getPublicKey(serverKey)
		const receipt = finalizeEvent(
			{
				kind: 9735,
				created_at: 1_700_000_000,
				tags: [
					['p', recipientPubkey],
					['a', auctionAnchor.value],
					['bolt11', 'lnbc1u1' + 'q'.repeat(20)],
					['description', JSON.stringify({ kind: 9734, tags: [['p', recipientPubkey]], content: '' })],
				],
				content: '',
			},
			serverKey,
		)
		const seams = createAppPayoutSeams({
			signer,
			nwcUri: 'nostr+walletconnect://test',
			findReceiptEvents: async () => receipt as never,
			payInvoiceImpl: async () => ({}),
			fetchImpl: (async (url: string) =>
				({
					ok: true,
					json: async () =>
						String(url).includes('/callback') ? { pr: 'lnbc1u1' + 'q'.repeat(20) } : { ...payDocument, nostrPubkey: serverPubkey },
				}) as never) as unknown as typeof fetch,
		})
		const planResult = planZapPayout({
			rows: [{ id: '1', destination: 'alice@example.com', bps: 10000 }],
			settledSats: 100,
			minimumZapSats: 1,
		})
		if ('ok' in planResult && !planResult.ok) throw new Error('fixture refused')

		const result = await runZapPayout({
			plan: planResult as ZapPayoutPlan,
			seams,
			relays: ['wss://relay.example.com'],
			now: 1_700_000_000,
			auctionAnchor,
		})
		expect(result.rows[0].status).toBe('paid')
		expect(result.rows[0].receiptId).toBe(receipt.id)
		// and it discloses that the match was made without a recipient identity, because a lightning address
		// names an endpoint and not a person
		expect(result.rows[0].detail).toContain('no recipient identity')
	})
})
