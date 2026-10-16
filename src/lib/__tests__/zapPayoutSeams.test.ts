import { describe, expect, test } from 'bun:test'
import { sha256 } from '@noble/hashes/sha2.js'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { planZapPayout, type ZapPayoutPlan } from '../v4v/payoutPlan'
import { runZapPayout } from '../v4v/zapPayoutRunner'
import { createZapPayoutSeams, lnurlFailureToResolution, type ZapPayoutPrimitives } from '../v4v/zapPayoutSeams'
import { parseZapDestination, zapDestinationLnurlpEndpoint } from '../v4v/zapDestination'

/**
 * The wiring is tested with fake primitives, which is the whole reason the primitives are injected: a
 * payout is nothing but network calls, and the repository forbids tests from making them. Nothing here
 * touches a fetch, a wallet, or a relay.
 */
const auctionAnchor = { kind: 'a' as const, value: '30408:' + 'a'.repeat(64) + ':auction-1' }
const serverKey = sha256(new TextEncoder().encode('seams-server-seed'))
const recipientKey = sha256(new TextEncoder().encode('seams-recipient-seed'))
const recipientPubkey = getPublicKey(recipientKey)
const serverPubkey = getPublicKey(serverKey)

const payDocument = (overrides: Record<string, unknown> = {}) => ({
	tag: 'payRequest',
	callback: 'https://pay.example.com/lnurlp/alice/callback',
	minSendable: 1000,
	maxSendable: 100_000_000,
	allowsNostr: true,
	nostrPubkey: serverPubkey,
	...overrides,
})

interface Recorded {
	urls: string[]
	payments: string[]
}

const primitives = (
	options: {
		json?: (url: string) => unknown
		payment?: { ok: true } | { ok: false; detail?: string }
		receipt?: unknown | null
		profileAddress?: string | null
		withProfileReader?: boolean
	} = {},
): { primitives: ZapPayoutPrimitives; recorded: Recorded } => {
	const recorded: Recorded = { urls: [], payments: [] }
	const api: ZapPayoutPrimitives = {
		async getJson(url) {
			recorded.urls.push(url)
			if (options.json) return options.json(url)
			// a real endpoint answers two different questions: the discovery document at the well-known
			// path, and an invoice at the callback it names
			return url.includes('/callback') ? { pr: 'lnbc1u1' + 'q'.repeat(20) } : payDocument()
		},
		async buildZapRequest() {
			return {
				event: { kind: 9734, pubkey: recipientPubkey, created_at: 0, tags: [], content: '' },
				description: JSON.stringify({ kind: 9734, tags: [['p', recipientPubkey]], content: '' }),
				recipientPubkey,
			}
		},
		async payInvoice({ bolt11 }) {
			recorded.payments.push(bolt11)
			return options.payment ?? { ok: true }
		},
		async findReceipt() {
			return (options.receipt ?? null) as never
		},
	}
	if (options.withProfileReader !== false) {
		// `undefined` means "use the default address"; an explicit `null` means "the profile declares none",
		// and `??` would collapse those two into the same case.
		api.readProfileLightningAddress = async () => (options.profileAddress === undefined ? 'alice@example.com' : options.profileAddress)
	}
	return { primitives: api, recorded }
}

const destination = (raw: string) => {
	const parsed = parseZapDestination(raw)
	if (!parsed.ok) throw new Error('fixture destination refused')
	return parsed.destination
}

/** Call the seam the way the runner does: endpoint first, destination alongside it. */
const resolve = (raw: string, api: ZapPayoutPrimitives) => {
	const parsed = destination(raw)
	return createZapPayoutSeams(api).resolveEndpoint(zapDestinationLnurlpEndpoint(parsed), parsed)
}

describe('resolveEndpoint — what the endpoint answering (or not) becomes', () => {
	test('a payable document resolves', async () => {
		const { primitives: api } = primitives()
		const result = await resolve('alice@example.com', api)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.document.callback).toBe('https://pay.example.com/lnurlp/alice/callback')
	})

	test("the endpoint it fetches is the destination module's own answer — one decision, not two", async () => {
		const { primitives: api, recorded } = primitives()
		await resolve('Alice@Example.com', api)
		expect(recorded.urls[0]).toBe('https://example.com/.well-known/lnurlp/alice')
	})

	test('a transport failure is address_unreachable', async () => {
		const { primitives: api } = primitives({
			json: () => {
				throw new Error('ECONNREFUSED')
			},
		})
		expect(await resolve('alice@example.com', api)).toMatchObject({ ok: false, code: 'address_unreachable' })
	})

	test('an HTML error page instead of JSON is address_unreachable, not a capability verdict', async () => {
		const { primitives: api } = primitives({ json: () => '<html>502 Bad Gateway</html>' })
		expect(await resolve('alice@example.com', api)).toMatchObject({ ok: false, code: 'address_unreachable' })
	})

	test('a document that is not a zap endpoint is not_zap_capable', async () => {
		const { primitives: api } = primitives({ json: () => payDocument({ tag: 'withdrawRequest' }) })
		expect(await resolve('alice@example.com', api)).toMatchObject({ ok: false, code: 'not_zap_capable' })
	})

	test('an insecure callback is not_zap_capable — the address exists, it just cannot receive a zap', async () => {
		const { primitives: api } = primitives({ json: () => payDocument({ callback: 'http://pay.example.com/cb' }) })
		expect(await resolve('alice@example.com', api)).toMatchObject({ ok: false, code: 'not_zap_capable' })
	})

	test("the refusal detail carries the parser's own code and reason", async () => {
		const { primitives: api } = primitives({ json: () => payDocument({ allowsNostr: true, nostrPubkey: undefined }) })
		const result = await resolve('alice@example.com', api)
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.detail).toContain('lnurl_inconsistent_nostr')
	})
})

describe('an npub destination resolves through its profile', () => {
	const npub = nip19.npubEncode(getPublicKey(sha256(new TextEncoder().encode('profile-owner'))))

	test('the profile address is used, and the well-known endpoint is fetched', async () => {
		const { primitives: api, recorded } = primitives({ profileAddress: 'bob@example.com' })
		const result = await resolve(npub, api)
		expect(result.ok).toBe(true)
		expect(recorded.urls[0]).toBe('https://example.com/.well-known/lnurlp/bob')
	})

	test('with no profile reader the npub is unreachable, with that as the stated reason', async () => {
		const { primitives: api } = primitives({ withProfileReader: false })
		const result = await resolve(npub, api)
		expect(result).toMatchObject({ ok: false, code: 'address_unreachable' })
		if (result.ok) return
		expect(result.detail).toContain('no profile reader')
	})

	test('a profile that declares no address is unreachable', async () => {
		const { primitives: api } = primitives({ profileAddress: null })
		expect(await resolve(npub, api)).toMatchObject({ ok: false, code: 'address_unreachable' })
	})

	test('a profile whose address is itself unusable is not_zap_capable', async () => {
		const { primitives: api } = primitives({ profileAddress: 'not an address' })
		expect(await resolve(npub, api)).toMatchObject({ ok: false, code: 'not_zap_capable' })
	})

	test('a profile reader that throws is unreachable, not a crash', async () => {
		const { primitives: api } = primitives()
		api.readProfileLightningAddress = async () => {
			throw new Error('relay down')
		}
		expect(await resolve(npub, api)).toMatchObject({ ok: false, code: 'address_unreachable' })
	})
})

describe('requestInvoice — the request it builds and the answer it reads', () => {
	test('the amount is in millisats and the zap request travels with it', async () => {
		const { primitives: api, recorded } = primitives({ json: () => ({ pr: 'lnbc1u1qx' }) })
		const seams = createZapPayoutSeams(api)
		const result = await seams.requestInvoice({
			callback: 'https://pay.example.com/cb',
			amountSats: 250,
			zapRequest: { event: { kind: 9734 }, description: '{"kind":9734}' },
		})
		expect(result).toEqual({ ok: true, bolt11: 'lnbc1u1qx' })
		const url = new URL(recorded.urls[0])
		expect(url.searchParams.get('amount')).toBe('250000')
		expect(url.searchParams.get('nostr')).toBe('{"kind":9734}')
	})

	test("a refusal carries the endpoint's own reason", async () => {
		const { primitives: api } = primitives({ json: () => ({ status: 'ERROR', reason: 'amount out of range' }) })
		const seams = createZapPayoutSeams(api)
		const result = await seams.requestInvoice({
			callback: 'https://pay.example.com/cb',
			amountSats: 1,
			zapRequest: { event: { kind: 9734 }, description: '{}' },
		})
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.detail).toContain('amount out of range')
	})

	test('a transport failure is payment_failed', async () => {
		const { primitives: api } = primitives({
			json: () => {
				throw new Error('timeout')
			},
		})
		const seams = createZapPayoutSeams(api)
		expect(
			await seams.requestInvoice({
				callback: 'https://pay.example.com/cb',
				amountSats: 1,
				zapRequest: { event: { kind: 9734 }, description: '{}' },
			}),
		).toMatchObject({
			ok: false,
			code: 'payment_failed',
		})
	})
})

describe('the failure-to-vocabulary table is the only judgement this module makes', () => {
	test('unusable-but-answering endpoints are capability facts', () => {
		for (const code of [
			'lnurl_wrong_tag',
			'lnurl_inconsistent_nostr',
			'lnurl_invalid_limits',
			'lnurl_missing_callback',
			'lnurl_insecure_callback',
		]) {
			expect(lnurlFailureToResolution(code)).toBe('not_zap_capable')
		}
	})

	test('an unusable answer is a reachability fact', () => {
		expect(lnurlFailureToResolution('lnurl_not_object')).toBe('address_unreachable')
		expect(lnurlFailureToResolution('something_new')).toBe('address_unreachable')
	})
})

describe('plug and play: the modules compose into a run without knowing about each other', () => {
	const plan = (): ZapPayoutPlan => {
		const result = planZapPayout({ rows: [{ id: '1', destination: 'alice@example.com', bps: 10000 }], settledSats: 100, minimumZapSats: 1 })
		if ('ok' in result && !result.ok) throw new Error('fixture plan refused')
		return result as ZapPayoutPlan
	}

	const signedReceipt = () =>
		finalizeEvent(
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

	test('a run built from the real seams and fake primitives pays and verifies', async () => {
		// no `json` override: the fake answers the discovery document and the invoice, as a real endpoint does
		const { primitives: api, recorded } = primitives({ receipt: signedReceipt() })
		const seams = createZapPayoutSeams(api)
		const result = await runZapPayout({
			plan: plan(),
			seams,
			relays: ['wss://relay.example.com'],
			now: 1_700_000_000,
			auctionAnchor,
		})
		expect(result.rows[0].status).toBe('paid')
		expect(result.paidSats).toBe(100)
		expect(recorded.payments).toHaveLength(1)
		// the endpoint was fetched, then the invoice was requested from the callback the document named
		expect(recorded.urls).toHaveLength(2)
		expect(recorded.urls[1]).toContain('/lnurlp/alice/callback')
	})

	test('a run against an unreachable endpoint spends nothing and says so', async () => {
		const { primitives: api, recorded } = primitives({
			json: () => {
				throw new Error('no route to host')
			},
		})
		const result = await runZapPayout({ plan: plan(), seams: createZapPayoutSeams(api), relays: [], now: 1_700_000_000, auctionAnchor })
		expect(result.rows[0].status).toBe('address_unreachable')
		expect(result.paidSats).toBe(0)
		expect(recorded.payments).toHaveLength(0)
	})
})
