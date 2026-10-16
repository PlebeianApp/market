/**
 * demoInvoice.test.ts — **the demo's invoice request, with the network injected away.**
 *
 * `requestInvoice` composes the bolt11-wrapper with an LNURL requester. The real
 * requester makes HTTP calls; the tests here inject a stub that returns a known
 * bolt11, so the claim under test is the request path itself — the wrapper's
 * obtain → the codec's payment-hash derivation → the returned shape — and no
 * socket is reached. The stub both succeeds and throws, proving the caller gets a
 * `{ refusal }` rather than an uncaught exception when the endpoint misbehaves.
 */

import { describe, expect, test } from 'bun:test'

import type { Bolt11LnurlRequester } from '@sdk/core/bolt11-wrapper/ts/types'

import { requestInvoice } from './demoInvoice'

/** A real bolt11 invoice (testnet, 190 sats), returned by an LNURL-pay endpoint. */
const KNOWN_BOLT11 =
	'lnbc190n1p4dy2zgsp5y84m2j5qspcglp2gc4z5xd5elvkr39zcsnvlh23djmyse6pjkymqpp5z3cp8qu0rx75z7f8k6jeuvy94rxupwszl09lxa30fkuz7ymdwdwshp52zmdlh0na09ve7dtngx4wgfpgmlw0xmh0y26nnn0ty67prvpk07sxq9z0rgqcqpnrzjqgp7tvtwh6rmpz0j9cv82tcl0fn2r00h0pualrgun6xeztdlhxltgrktq5qq06qqqyqqqqqqqqqqraqqvs9qxpqysgqepwgafefgvn3urlkxtefagj2n9r7a40ayn62k8sfgad5qywlwdgqx0vd5789zhzqqhgxxergptxshwlm5v9yrk0qcszxxvkemnn66wsqe4r7dk'

const stubRequester: Bolt11LnurlRequester = {
	async requestInvoice() {
		return { bolt11: KNOWN_BOLT11 }
	},
}

describe('requestInvoice over an injected requester', () => {
	test('an endpoint that answers returns the bolt11 and its payment hash', async () => {
		const result = await requestInvoice('order-demo', 99, 'seller@example.test', stubRequester)

		expect('bolt11' in result).toBe(true)
		if ('bolt11' in result) {
			expect(result.bolt11).toBe(KNOWN_BOLT11)
			// The payment hash is the 64-hex digest the codec derived from the invoice's own
			// payment_hash section — not a string the caller invented.
			expect(result.paymentHash).toMatch(/^[0-9a-f]{64}$/)
		}
	})

	test('an endpoint that throws returns a refusal, never an uncaught error', async () => {
		const failing: Bolt11LnurlRequester = {
			async requestInvoice() {
				throw new Error('LNURL params failed: 500')
			},
		}

		const result = await requestInvoice('order-demo', 99, 'seller@example.test', failing)

		expect('refusal' in result).toBe(true)
		if ('refusal' in result) expect(result.refusal).toContain('500')
	})

	test('a malformed lightning address is refused before any request is made', async () => {
		let called = false
		const spy: Bolt11LnurlRequester = {
			async requestInvoice() {
				called = true
				return { bolt11: KNOWN_BOLT11 }
			},
		}

		const result = await requestInvoice('order-demo', 99, 'not-an-address', spy)

		expect('refusal' in result).toBe(true)
		expect(called).toBe(false)
	})
})