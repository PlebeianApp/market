import { describe, expect, test } from 'bun:test'
import { sha256 } from '@noble/hashes/sha2.js'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { planZapPayout, type ZapPayoutPlan } from '../v4v/payoutPlan'
import { runZapPayout, type LnurlPayDocument, type LnurlResolution, type ZapPayoutSeams } from '../v4v/zapPayoutRunner'

/**
 * Every side effect is a fake: no network, no relay, no wallet — the seam exists so that the judgement
 * (this file) can be tested without them. The receipt in the happy path is really signed, because a
 * receipt that cannot verify would make the happy path pass for the wrong reason.
 */
const auctionAnchor = { kind: 'a' as const, value: '30408:' + 'a'.repeat(64) + ':auction-1' }
const recipientKey = sha256(new TextEncoder().encode('runner-recipient-seed'))
const serverKey = sha256(new TextEncoder().encode('runner-server-seed'))
const recipientPubkey = getPublicKey(recipientKey)
const serverPubkey = getPublicKey(serverKey)

const document = (overrides: Partial<LnurlPayDocument> = {}): LnurlPayDocument => ({
	callback: 'https://pay.example.com/lnurlp/alice/callback',
	minSendableMsat: 1000,
	maxSendableMsat: 1_000_000_000,
	allowsNostr: true,
	nostrPubkey: serverPubkey,
	...overrides,
})

const plan = (input: {
	rows: { id: string; destination: string; bps: number }[]
	settledSats: number
	minimumZapSats?: number
}): ZapPayoutPlan => {
	const result = planZapPayout({ rows: input.rows, settledSats: input.settledSats, minimumZapSats: input.minimumZapSats ?? 1 })
	if ('ok' in result && !result.ok) throw new Error(`plan refused: ${result.error}`)
	return result as ZapPayoutPlan
}

interface Calls {
	resolve: number
	buildZapRequest: number
	requestInvoice: number
	payInvoice: number
	fetchReceipt: number
}

const seams = (
	options: {
		resolution?: LnurlResolution | ((endpoint: string | null) => LnurlResolution)
		invoice?: { ok: true; bolt11: string } | { ok: false; code: 'payment_failed' | 'not_zap_capable'; detail?: string }
		payment?: { ok: true } | { ok: false; detail?: string }
		receipt?: unknown | null
	} = {},
): { seams: ZapPayoutSeams; calls: Calls } => {
	const calls: Calls = { resolve: 0, buildZapRequest: 0, requestInvoice: 0, payInvoice: 0, fetchReceipt: 0 }
	const api: ZapPayoutSeams = {
		async resolveEndpoint(endpoint) {
			calls.resolve += 1
			if (typeof options.resolution === 'function') return options.resolution(endpoint)
			return options.resolution ?? { ok: true, document: document() }
		},
		async buildZapRequest() {
			calls.buildZapRequest += 1
			return {
				event: { kind: 9734, pubkey: 'buyer', created_at: 0, tags: [], content: '' },
				description: '{"kind":9734,"tags":[["p","' + recipientPubkey + '"]]}',
				recipientPubkey,
			}
		},
		async requestInvoice() {
			calls.requestInvoice += 1
			return options.invoice ?? { ok: true, bolt11: 'lnbc1u1' + 'q'.repeat(20) }
		},
		async payInvoice() {
			calls.payInvoice += 1
			return options.payment ?? { ok: true }
		},
		async fetchReceipt() {
			calls.fetchReceipt += 1
			return (options.receipt ?? null) as never
		},
	}
	return { seams: api, calls }
}

const receipt = (amountPart = '1u', overrides: { recipient?: string } = {}) =>
	finalizeEvent(
		{
			kind: 9735,
			created_at: 1_700_000_000,
			tags: [
				['p', overrides.recipient ?? recipientPubkey],
				['a', auctionAnchor.value],
				['bolt11', `lnbc${amountPart}1${'q'.repeat(20)}`],
				['description', JSON.stringify({ kind: 9734, tags: [['p', recipientPubkey]], content: '' })],
			],
			content: '',
		},
		serverKey,
	)

const run = (input: { plan: ZapPayoutPlan; seams: ZapPayoutSeams; dryRun?: boolean; receiptRequired?: boolean }) =>
	runZapPayout({
		plan: input.plan,
		seams: input.seams,
		relays: ['wss://relay.example.com'],
		now: 1_700_000_000,
		auctionAnchor,
		...(input.dryRun !== undefined ? { dryRun: input.dryRun } : {}),
		...(input.receiptRequired !== undefined ? { receiptRequired: input.receiptRequired } : {}),
	})

describe('a row that can be paid', () => {
	test('paid, with the receipt id recorded', async () => {
		const signed = receipt()
		const { seams: api, calls } = seams({ receipt: signed })
		const result = await run({
			plan: plan({ rows: [{ id: '1', destination: 'alice@example.com', bps: 10000 }], settledSats: 100 }),
			seams: api,
		})

		expect(result.rows).toHaveLength(1)
		expect(result.rows[0]).toMatchObject({ id: '1', sats: 100, status: 'paid', receiptId: signed.id })
		expect(result.rows[0].sentence).toBe("This share was paid and the recipient's server published a receipt.")
		expect(result.paidSats).toBe(100)
		expect(result.unspentSats).toBe(0)
		expect(result.needsAttention).toEqual([])
		expect(calls).toMatchObject({ resolve: 1, buildZapRequest: 1, requestInvoice: 1, payInvoice: 1, fetchReceipt: 1 })
	})

	test('a payment with no receipt yet is paid_unconfirmed, never "paid"', async () => {
		const { seams: api } = seams({ receipt: null })
		const result = await run({
			plan: plan({ rows: [{ id: '1', destination: 'alice@example.com', bps: 10000 }], settledSats: 100 }),
			seams: api,
		})
		expect(result.rows[0]).toMatchObject({ status: 'paid_unconfirmed' })
		expect(result.rows[0].receiptId).toBeUndefined()
		expect(result.paidSats).toBe(100)
	})

	test('a receipt that does not check out is not evidence: paid_unconfirmed with the reason', async () => {
		// the receipt is for 200 sats while the row committed 100
		const { seams: api } = seams({ receipt: receipt('2u') })
		const result = await run({
			plan: plan({ rows: [{ id: '1', destination: 'alice@example.com', bps: 10000 }], settledSats: 100 }),
			seams: api,
		})
		expect(result.rows[0].status).toBe('paid_unconfirmed')
		expect(result.rows[0].detail).toContain('receipt_amount_mismatch')
	})

	test('a receipt for another recipient is not evidence — when the row names a recipient to compare against', async () => {
		// an npub row carries an identity, so the `p` tag is checkable; an address-only row cannot check it
		// and discloses the weaker match instead (see the next test)
		const npub = nip19.npubEncode(getPublicKey(sha256(new TextEncoder().encode('runner-own-identity'))))
		const { seams: api } = seams({ receipt: receipt('1u', { recipient: getPublicKey(sha256(new TextEncoder().encode('somebody-else'))) }) })
		const result = await run({
			plan: plan({ rows: [{ id: '1', destination: npub, bps: 10000 }], settledSats: 100 }),
			seams: api,
		})
		expect(result.rows[0].status).toBe('paid_unconfirmed')
		expect(result.rows[0].detail).toContain('receipt_')
	})

	test('an address-only row says the receipt was matched without a recipient identity', async () => {
		const { seams: api } = seams({ receipt: receipt('1u') })
		const result = await run({
			plan: plan({ rows: [{ id: '1', destination: 'alice@example.com', bps: 10000 }], settledSats: 100 }),
			seams: api,
		})
		expect(result.rows[0].status).toBe('paid')
		// the disclosure is the point: a lightning address names an endpoint, not a person
		expect(result.rows[0].detail).toContain('no recipient identity')
	})
})

describe('a row that cannot be paid says which way it failed', () => {
	test('an endpoint that does not answer is address_unreachable, and the sats stay unspent', async () => {
		const { seams: api, calls } = seams({ resolution: { ok: false, code: 'address_unreachable', detail: 'dns' } })
		const result = await run({
			plan: plan({ rows: [{ id: '1', destination: 'alice@example.com', bps: 10000 }], settledSats: 100 }),
			seams: api,
		})
		expect(result.rows[0].status).toBe('address_unreachable')
		expect(result.paidSats).toBe(0)
		expect(result.unspentSats).toBe(100)
		expect(result.needsAttention).toEqual(['1'])
		expect(calls.payInvoice).toBe(0)
	})

	test('a resolution that throws is unreachable, not a crash', async () => {
		const { seams: api } = seams({
			resolution: () => {
				throw new Error('network down')
			},
		})
		const result = await run({
			plan: plan({ rows: [{ id: '1', destination: 'alice@example.com', bps: 10000 }], settledSats: 100 }),
			seams: api,
		})
		expect(result.rows[0].status).toBe('address_unreachable')
	})

	test('a plain Lightning address is not paid when a receipt is required', async () => {
		const { seams: api, calls } = seams({ resolution: { ok: true, document: document({ allowsNostr: false, nostrPubkey: undefined }) } })
		const result = await run({
			plan: plan({ rows: [{ id: '1', destination: 'alice@example.com', bps: 10000 }], settledSats: 100 }),
			seams: api,
		})
		expect(result.rows[0].status).toBe('not_zap_capable')
		expect(calls.payInvoice).toBe(0)
	})

	test('a plain Lightning address IS paid when receipts are not required — and says no receipt exists', async () => {
		const { seams: api, calls } = seams({ resolution: { ok: true, document: document({ allowsNostr: false, nostrPubkey: undefined }) } })
		const result = await run({
			plan: plan({ rows: [{ id: '1', destination: 'alice@example.com', bps: 10000 }], settledSats: 100 }),
			seams: api,
			receiptRequired: false,
		})
		expect(result.rows[0].status).toBe('no_receipt_expected')
		expect(result.paidSats).toBe(100)
		expect(calls.payInvoice).toBe(1)
		expect(calls.fetchReceipt).toBe(0)
	})

	test('a share below the endpoint minimum is below_minimum, and nothing is paid', async () => {
		const { seams: api, calls } = seams({ resolution: { ok: true, document: document({ minSendableMsat: 5_000 }) } })
		const result = await run({
			plan: plan({ rows: [{ id: '1', destination: 'alice@example.com', bps: 10000 }], settledSats: 1 }),
			seams: api,
		})
		expect(result.rows[0].status).toBe('below_minimum')
		expect(result.rows[0].detail).toContain('5000')
		expect(calls.requestInvoice).toBe(0)
	})

	test('a share above the endpoint maximum is its own status, not "below minimum"', async () => {
		const { seams: api } = seams({ resolution: { ok: true, document: document({ maxSendableMsat: 5_000 }) } })
		const result = await run({
			plan: plan({ rows: [{ id: '1', destination: 'alice@example.com', bps: 10000 }], settledSats: 100 }),
			seams: api,
		})
		expect(result.rows[0].status).toBe('above_endpoint_maximum')
	})

	test('a failed payment is payment_failed, and the sats are unspent', async () => {
		const { seams: api } = seams({ payment: { ok: false, detail: 'no route' } })
		const result = await run({
			plan: plan({ rows: [{ id: '1', destination: 'alice@example.com', bps: 10000 }], settledSats: 100 }),
			seams: api,
		})
		expect(result.rows[0]).toMatchObject({ status: 'payment_failed', detail: 'no route' })
		expect(result.unspentSats).toBe(100)
	})

	test('an invoice request that fails is payment_failed', async () => {
		const { seams: api } = seams({ invoice: { ok: false, code: 'payment_failed', detail: 'endpoint said no' } })
		const result = await run({
			plan: plan({ rows: [{ id: '1', destination: 'alice@example.com', bps: 10000 }], settledSats: 100 }),
			seams: api,
		})
		expect(result.rows[0].status).toBe('payment_failed')
	})

	test('a malformed destination that somehow reaches the run is reported, not guessed at', async () => {
		const { seams: api } = seams()
		const result = await run({
			plan: plan({ rows: [{ id: '1', destination: 'not a destination', bps: 10000 }], settledSats: 100 }),
			seams: api,
		})
		expect(result.rows[0].status).toBe('address_unreachable')
		expect(result.rows[0].detail).toContain('destination_')
	})
})

describe('rows that were never going to be paid', () => {
	test('a below-minimum row is rolled_up and its sats are disclosed as unspent', async () => {
		const { seams: api, calls } = seams()
		const result = await run({
			plan: plan({ rows: [{ id: '1', destination: 'alice@example.com', bps: 5000 }], settledSats: 2, minimumZapSats: 10 }),
			seams: api,
		})
		expect(result.rows[0].status).toBe('rolled_up')
		expect(result.unspentSats).toBe(1)
		expect(calls.resolve).toBe(0)
	})

	test('an announced zero row is disclosed with its reason and never paid', async () => {
		const { seams: api, calls } = seams()
		const result = await run({
			plan: plan({
				rows: [
					{ id: '1', destination: 'alice@example.com', bps: 0 },
					{ id: '2', destination: 'bob@example.com', bps: 10000 },
				],
				settledSats: 100,
			}),
			seams: api,
		})
		expect(result.rows.find((row) => row.id === '1')).toMatchObject({ status: 'below_minimum', sats: 0, detail: 'zero_share' })
		expect(result.rows.find((row) => row.id === '2')).toMatchObject({ status: 'paid_unconfirmed' })
		expect(calls.payInvoice).toBe(1)
	})

	test('a dry run resolves and checks but spends nothing', async () => {
		const { seams: api, calls } = seams()
		const result = await run({
			plan: plan({ rows: [{ id: '1', destination: 'alice@example.com', bps: 10000 }], settledSats: 100 }),
			seams: api,
			dryRun: true,
		})
		expect(result.rows[0].status).toBe('planned')
		expect(result.paidSats).toBe(0)
		expect(result.unspentSats).toBe(100)
		expect(calls).toMatchObject({ resolve: 1, buildZapRequest: 0, requestInvoice: 0, payInvoice: 0 })
	})

	test('a dry run still reports the rows that would fail', async () => {
		const { seams: api } = seams({ resolution: { ok: false, code: 'address_unreachable' } })
		const result = await run({
			plan: plan({ rows: [{ id: '1', destination: 'alice@example.com', bps: 10000 }], settledSats: 100 }),
			seams: api,
			dryRun: true,
		})
		expect(result.rows[0].status).toBe('address_unreachable')
	})
})

describe('the run as a whole', () => {
	test('one row failing does not stop the others', async () => {
		const { seams: api, calls } = seams({
			resolution: (endpoint) =>
				endpoint?.includes('broken') ? { ok: false, code: 'address_unreachable' } : { ok: true, document: document() },
			receipt: receipt(),
		})
		const result = await run({
			plan: plan({
				rows: [
					{ id: '1', destination: 'broken@example.com', bps: 5000 },
					{ id: '2', destination: 'alice@example.com', bps: 5000 },
				],
				settledSats: 200,
			}),
			seams: api,
		})
		expect(result.rows.map((row) => row.status)).toEqual(['address_unreachable', 'paid'])
		expect(result.paidSats).toBe(100)
		expect(result.unspentSats).toBe(100)
		expect(calls.payInvoice).toBe(1)
	})

	test('paid and unspent reconcile against every row of the plan — no sats vanish', async () => {
		const { seams: api } = seams({ receipt: receipt() })
		const thePlan = plan({
			rows: [
				{ id: '1', destination: 'alice@example.com', bps: 2500 },
				{ id: '2', destination: 'bob@example.com', bps: 2500 },
				{ id: '3', destination: 'carol@example.com', bps: 2500 },
			],
			settledSats: 1000,
		})
		const result = await run({ plan: thePlan, seams: api })
		const rowTotal = thePlan.rows.reduce((total, row) => total + row.sats, 0)
		expect(result.paidSats + result.unspentSats).toBe(rowTotal)
		expect(result.paidSats + result.unspentSats + thePlan.sellerSats).toBe(1000)
	})

	test('every ledger row carries the §8 sentence for its status', async () => {
		const { seams: api } = seams({ resolution: { ok: false, code: 'address_unreachable' } })
		const result = await run({
			plan: plan({ rows: [{ id: '1', destination: 'alice@example.com', bps: 10000 }], settledSats: 100 }),
			seams: api,
		})
		expect(result.rows[0].sentence).toBe("The recipient's Lightning address did not answer.")
	})
})
