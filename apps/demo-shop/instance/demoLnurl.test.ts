/**
 * demoLnurl.test.ts — **the demo's bolt11 codec, over a real invoice string.**
 *
 * The codec (`lnurlCodec`) is the seam between the bolt11-wrapper and the
 * `light-bolt11-decoder` library. The fixture below is a real invoice returned by
 * an LNURL-pay endpoint, so these assertions are about real BOLT11 decoding —
 * payment hash extraction, expiry window, and preimage validation — with no socket
 * involved.
 */

import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import { lnurlCodec } from './demoLnurl'

/** A real bolt11 invoice (testnet, 190 sats), returned by an LNURL-pay endpoint. */
const KNOWN_BOLT11 =
	'lnbc190n1p4dy2zgsp5y84m2j5qspcglp2gc4z5xd5elvkr39zcsnvlh23djmyse6pjkymqpp5z3cp8qu0rx75z7f8k6jeuvy94rxupwszl09lxa30fkuz7ymdwdwshp52zmdlh0na09ve7dtngx4wgfpgmlw0xmh0y26nnn0ty67prvpk07sxq9z0rgqcqpnrzjqgp7tvtwh6rmpz0j9cv82tcl0fn2r00h0pualrgun6xeztdlhxltgrktq5qq06qqqyqqqqqqqqqqraqqvs9qxpqysgqepwgafefgvn3urlkxtefagj2n9r7a40ayn62k8sfgad5qywlwdgqx0vd5789zhzqqhgxxergptxshwlm5v9yrk0qcszxxvkemnn66wsqe4r7dk'

describe('the demo bolt11 codec', () => {
	test('paymentHash is the 64-hex digest the invoice carries', () => {
		const hash = lnurlCodec.paymentHash(KNOWN_BOLT11)
		expect(hash).toMatch(/^[0-9a-f]{64}$/)
	})

	test('expiresAt is in the future for a freshly issued invoice', () => {
		const expiresAt = lnurlCodec.expiresAt(KNOWN_BOLT11)
		expect(expiresAt).toBeGreaterThan(Date.now())
		// A bolt11 expiry is typically an hour or a few days; the 45-day bound is a sanity
		// range for invoices from endpoints that set long expiries, not a claim about a
		// specific endpoint's policy.
		expect(expiresAt).toBeLessThan(Date.now() + 45 * 24 * 3600 * 1000)
	})

	test('validatePreimage fails closed: only the invoice’s own preimage would pass, and any other input is refused', () => {
		const hash = lnurlCodec.paymentHash(KNOWN_BOLT11)

		// The payment hash is SHA-256 of the preimage, and the preimage is not derivable
		// from the invoice string alone — so the honest assertion is the negative one:
		// inputs that are not the real preimage must never validate. A "true preimage"
		// pair cannot be manufactured for an invoice whose preimage we do not hold, and
		// a codec that accepted a guessed preimage would be broken.
		const guessedPreimage = createHash('sha256').update(hash).digest('hex')
		expect(lnurlCodec.validatePreimage(KNOWN_BOLT11, guessedPreimage)).toBe(false)
		expect(lnurlCodec.validatePreimage(KNOWN_BOLT11, '00'.repeat(32))).toBe(false)
	})
})