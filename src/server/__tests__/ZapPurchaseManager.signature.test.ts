import { expect, test, describe, beforeEach, afterEach } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { NostrEvent } from '@nostr-dev-kit/ndk'
import { EventSigner } from '../EventSigner'
import {
	ZapPurchaseManager,
	ZapInvoiceError,
	type ZapPurchaseConfig,
	type ZapPurchaseInvoiceRequestBody,
	type LnurlResolver,
} from '../ZapPurchaseManager'

/**
 * H2 — Zap request signature verification (payment fraud).
 *
 * Regression coverage for PR #1074: generateInvoice() must call verifyEvent()
 * on the client-supplied zap request before trusting its pubkey/tags. Without
 * it, a malicious client could forge a zapRequest with any pubkey and arbitrary
 * tags and obtain an invoice. With it, a forged/tampered request is rejected
 * with HTTP 400.
 *
 * IMPORTANT nostr-tools gotcha: `finalizeEvent()` stamps a (non-JSON)
 * `Symbol("verified")` cache on the event, and `verifyEvent()` short-circuits
 * to that cached value. Object spread carries the symbol along, so mutating a
 * finalized event in-process will STILL verify. A real attacker's event,
 * however, arrives as a JSON HTTP body — `JSON.parse` strips Symbol-keyed
 * properties, so verification re-runs and forgeries are caught. Every forged
 * fixture below is therefore passed through `toWire()` (JSON round-trip) to
 * mirror how the request actually arrives at the server.
 */

// Minimal concrete subclass just to exercise the abstract base class.
type Entry = { pubkey: string; validUntil: number }
class TestZapManager extends ZapPurchaseManager<Entry> {
	protected extractRegistryKey(zapRequest: NostrEvent): string | null {
		return zapRequest.tags.find((t) => t[0] === 'n')?.[1] ?? null
	}
	protected validateRegistration(_key: string, _pubkey: string): string | null {
		return null // accept all in this test fixture
	}
	protected extractEntriesFromEvent(): Array<{ key: string; entry: Entry }> {
		return []
	}
	protected buildRegistryTags(): string[][] {
		return []
	}
	protected createEntry(key: string, pubkey: string, validUntil: number): Entry {
		return { pubkey, validUntil }
	}
}

const ZAP_LABEL = 'market-test'
const REGISTRY_KEY = 'reg-key-123'

function hexPriv(sk: Uint8Array): string {
	return Buffer.from(sk).toString('hex')
}

/** Strip the verifiedSymbol cache so verifyEvent re-runs (mirrors a wire request). */
function toWire<T>(e: T): T {
	return JSON.parse(JSON.stringify(e))
}

describe('H2 — ZapPurchaseManager.generateInvoice signature verification', () => {
	let originalFetch: typeof fetch
	let appPubkey: string
	let manager: TestZapManager
	let requesterSk: Uint8Array
	const resolver: LnurlResolver = (id) => `https://lnurl.invalid/${id}/pay`

	beforeEach(() => {
		originalFetch = globalThis.fetch

		const appSk = generateSecretKey()
		appPubkey = getPublicKey(appSk)
		const signer = new EventSigner(hexPriv(appSk))

		const config: ZapPurchaseConfig = {
			zapLabel: ZAP_LABEL,
			registryEventKind: 30000,
			registryDTag: ZAP_LABEL,
			pricing: {},
		}
		manager = new TestZapManager(config, signer)

		requesterSk = generateSecretKey()
	})

	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	/** Build a correctly-signed zap request, then strip the symbol cache (wire form). */
	function signedZapRequestWire(amountSats: number) {
		const signed = finalizeEvent(
			{
				kind: 9734,
				created_at: Math.floor(Date.now() / 1000),
				tags: [
					['L', ZAP_LABEL],
					['p', appPubkey],
					['amount', String(amountSats * 1000)],
					['n', REGISTRY_KEY],
				],
				content: '',
			},
			requesterSk,
		)
		return toWire(signed)
	}

	function requestBody(zapRequest: object, amountSats: number): ZapPurchaseInvoiceRequestBody {
		return { amountSats, registryKey: REGISTRY_KEY, zapRequest: zapRequest as any }
	}

	test('rejects a FORGED zap request (tampered tag, stale signature) with 400', async () => {
		const valid = signedZapRequestWire(1000)
		// Forge: mutate the amount tag. The id no longer matches the (stale)
		// signature's covered hash, so verifyEvent() must fail closed.
		const forged = {
			...valid,
			tags: valid.tags.map((t) => (t[0] === 'amount' ? ['amount', '999999000'] : t)),
		}

		let caught: unknown
		try {
			await manager.generateInvoice(requestBody(forged, 1000), appPubkey, 'seller@ln', resolver)
		} catch (e) {
			caught = e
		}
		expect(caught).toBeInstanceOf(ZapInvoiceError)
		expect((caught as ZapInvoiceError).status).toBe(400)
		expect((caught as ZapInvoiceError).message).toContain('signature verification failed')
	})

	test('rejects a zap request with a wrong author pubkey (sig no longer valid) with 400', async () => {
		const valid = signedZapRequestWire(1000)
		const forged = { ...valid, pubkey: getPublicKey(generateSecretKey()) }

		await expect(manager.generateInvoice(requestBody(forged, 1000), appPubkey, 'seller@ln', resolver)).rejects.toThrow(
			/signature verification failed/,
		)
	})

	test('accepts a correctly-signed zap request and flows through to an invoice', async () => {
		// Mock the two fetches generateInvoice makes: LNURL-pay metadata, then invoice.
		let fetchCalls = 0
		globalThis.fetch = ((input: any) => {
			fetchCalls++
			const url = typeof input === 'string' ? input : input.toString()
			// The invoice callback carries ?amount=…&nostr=…; the metadata call does not.
			if (url.includes('amount=')) {
				return Promise.resolve(
					new Response(JSON.stringify({ pr: 'lnbc1u1testinvoice' }), {
						status: 200,
						headers: { 'content-type': 'application/json' },
					}),
				)
			}
			// LNURL-pay metadata
			return Promise.resolve(
				new Response(
					JSON.stringify({
						callback: 'https://lnurl.invalid/callback',
						allowsNostr: true,
						nostrPubkey: getPublicKey(generateSecretKey()),
						minSendable: 1000,
						maxSendable: 1_000_000_000,
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } },
				),
			)
		}) as typeof fetch

		const amountSats = 1000
		const result = await manager.generateInvoice(
			requestBody(signedZapRequestWire(amountSats), amountSats),
			appPubkey,
			'seller@ln',
			resolver,
		)
		expect(result.pr).toBe('lnbc1u1testinvoice')
		expect(fetchCalls).toBeGreaterThanOrEqual(2) // both fetches happened
	})

	test('a valid signature but missing required tags is rejected for a NON-signature reason', async () => {
		// Proves the signature check passes (no "signature verification failed")
		// but downstream tag validation still applies. Build a properly-signed
		// request that lacks the [L, zapLabel] tag.
		const signedNoLabel = toWire(
			finalizeEvent(
				{
					kind: 9734,
					created_at: Math.floor(Date.now() / 1000),
					tags: [
						['p', appPubkey],
						['amount', '1000000'],
						['n', REGISTRY_KEY],
					],
					content: '',
				},
				requesterSk,
			),
		)

		let caught: unknown
		try {
			await manager.generateInvoice(requestBody(signedNoLabel, 1000), appPubkey, 'seller@ln', resolver)
		} catch (e) {
			caught = e
		}
		expect(caught).toBeInstanceOf(ZapInvoiceError)
		// important: NOT the signature error — signature was valid, tag check failed
		expect((caught as ZapInvoiceError).message).not.toContain('signature verification failed')
		expect((caught as ZapInvoiceError).message).toContain('missing')
		expect((caught as ZapInvoiceError).message).toContain(ZAP_LABEL)
	})
})
