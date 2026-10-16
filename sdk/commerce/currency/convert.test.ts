/**
 * convert.test.ts — **the conversion: integer minor units in, whole satoshis out, through the injected read**.
 *
 * Three properties are on trial, and each is a rule this module exists to hold:
 *
 * 1. **No binary-float arithmetic.** The rate arrives as a JSON decimal, is shifted
 *    to minor units once, and every step after that is `BigInt`. `1234` minor units of
 *    USD at `50 000` USD/BTC is exactly `24680` sats; `1` minor unit at `30 000` is
 *    `33` (half-up), and is an integer.
 * 2. **A currency declares its own precision.** `JPY` is counted with none, `USD`
 *    with two, `BTC` with eight; `XYZ` declares nothing and is refused by name —
 *    **before** any transport is built, so a currency nobody has said how to count
 *    never reaches a socket.
 * 3. **No failure is a number.** Every `unavailable` arm carries its reason and has
 *    no `sats` field; the rate read's own reason travels through unchanged.
 *
 * **The mutations that turn each case red:**
 *
 * - *"the CVM rate is what is used"* → delete the read and derive sats from a
 *   hard-coded `100000000 / 50000` — the JPY and half-up cases fail, and the
 *   undeclared-currency case stops refusing.
 * - *"an unreachable CVM is a refusal"* → collapse `unavailable` onto
 *   `{ state: 'converted', sats: 0 }` — the propagation case fails on `state`, and on
 *   `Object.keys` not containing `sats`.
 * - *"precision is declared, not assumed"* → default `currencyPrecision` to `2` — the
 *   `XYZ` case converts instead of refusing, and `built` becomes 1.
 * - *"BTC and SAT are definitions"* → route them through the read — `built` becomes
 *   non-zero and `source` stops being `definition`.
 * - *"whole satoshis"* → return `amountMinor * 1e8 / rateMinor` as a float — the
 *   `30 000` case yields `33.333…` and `Number.isInteger` fails.
 * - *"a decimal shift, not a binary multiply"* → `amount * 10 ** precision` in
 *   `toMinorUnits` — `0.0001` at 8 places stops being exactly `10000`.
 */
import { describe, expect, test } from 'bun:test'

import { BITCOIN_CURRENCY, CURRENCY_PRECISION, convertCurrencyToSats, currencyPrecision, fiatMinorToSats, normalizeCurrency, toMinorUnits } from './convert'
import type { CvmEndpoint } from './endpoint'
import type { CvmRateTransportFactory } from './transport'

const PRODUCTION: CvmEndpoint = { serverPubkey: 'a'.repeat(64), relayUrls: ['wss://relay.plebeian.market'] }

/** A transport factory that records whether it was built at all. */
function rateAt(rate: number, onBuild?: () => void): CvmRateTransportFactory {
	return () => {
		onBuild?.()
		return {
			async callTool() {
				return { ok: true, isError: false, structured: { currency: 'USD', rate, fetchedAt: 1_700_000_000_000, cached: true } }
			},
			async close() {},
		}
	}
}

describe('converting an amount to sats through ContextVM', () => {
	test('scales a fiat minor-unit amount through the CVM rate, exactly', async () => {
		// 12.34 USD (1234 minor units) at 1 BTC = 50 000 USD → 24680 sats.
		const conversion = await convertCurrencyToSats({
			amountMinor: 1234,
			currency: 'USD',
			endpoint: PRODUCTION,
			transport: rateAt(50_000),
		})

		expect(conversion.state).toBe('converted')
		if (conversion.state !== 'converted') return
		expect(conversion.sats).toBe(24680)
		expect(Number.isInteger(conversion.sats)).toBe(true)
		expect(conversion.source).toBe('rate')
		expect(conversion.rate).toBe(50_000)
		expect(conversion.cached).toBe(true)
		expect(conversion.fetchedAt).toBe(1_700_000_000_000)
	})

	test('a currency with no decimal places converts on its own declared precision', async () => {
		// 1500 JPY at 1 BTC = 15 000 000 JPY → 10 000 sats.
		const conversion = await convertCurrencyToSats({
			amountMinor: 1500,
			currency: 'JPY',
			endpoint: PRODUCTION,
			transport: () => ({
				async callTool() {
					return { ok: true, isError: false, structured: { currency: 'JPY', rate: 15_000_000, fetchedAt: 1, cached: false } }
				},
				async close() {},
			}),
		})

		expect(conversion.state).toBe('converted')
		if (conversion.state !== 'converted') return
		expect(conversion.sats).toBe(10_000)
		expect(currencyPrecision('JPY')).toBe(0)
	})

	test('a non-exact division answers a whole number of satoshis, rounded half-up', () => {
		// 1 minor unit of USD at 1 BTC = 30 000 USD → 33.333… sats → 33.
		expect(fiatMinorToSats(1, 2, 30_000)).toBe(33)
		expect(fiatMinorToSats(2, 2, 30_000)).toBe(67) // 66.666… → 67
		expect(Number.isInteger(fiatMinorToSats(7, 2, 12_345))).toBe(true)
		expect(fiatMinorToSats(100, 2, 0)).toBeNull()
		expect(fiatMinorToSats(100, 2, -1)).toBeNull()
		expect(fiatMinorToSats(Number.NaN, 2, 50_000)).toBeNull()
	})

	test('a decimal shift, not a binary multiply: 0.0001 at 8 places is exactly 10000', () => {
		expect(toMinorUnits(0.0001, 8)).toBe(10_000)
		expect(toMinorUnits(12.34, 2)).toBe(1234)
		expect(toMinorUnits(1500, 0)).toBe(1500)
		expect(toMinorUnits(Number.NaN, 2)).toBe(0)
	})

	test('SAT and BTC are definitions: they convert with no endpoint and never build a transport', async () => {
		let built = 0
		const transport = rateAt(50_000, () => {
			built += 1
		})

		const sats = await convertCurrencyToSats({ amountMinor: 5000, currency: 'SATS', endpoint: undefined, transport })
		const bitcoin = await convertCurrencyToSats({ amountMinor: 12_340, currency: 'BTC', endpoint: undefined, transport })

		expect(sats).toMatchObject({ state: 'converted', currency: 'SAT', sats: 5000, source: 'definition', rate: null })
		expect(bitcoin).toMatchObject({ state: 'converted', currency: 'BTC', sats: 12_340, source: 'definition', rate: null })
		expect(built).toBe(0)
	})

	test('accepts the satoshi spellings production carries, and emits the SDK one', () => {
		for (const raw of ['SAT', 'SATS', 'sat', 'sats', ' Sat ']) expect(normalizeCurrency(raw)).toBe(BITCOIN_CURRENCY)
		expect(normalizeCurrency('usd')).toBe('USD')
		expect(normalizeCurrency(undefined)).toBe('')
		expect(CURRENCY_PRECISION.SAT).toBe(0)
		expect(CURRENCY_PRECISION.BTC).toBe(8)
	})

	test('a currency with no declared precision is refused by name, before any transport is built', async () => {
		let built = 0
		const conversion = await convertCurrencyToSats({
			amountMinor: 100,
			currency: 'XYZ',
			endpoint: PRODUCTION,
			transport: rateAt(50_000, () => {
				built += 1
			}),
		})

		expect(conversion.state).toBe('unavailable')
		if (conversion.state !== 'unavailable') return
		expect(conversion.reason).toBe('undeclared-currency-precision')
		expect(conversion.detail).toContain('XYZ')
		expect(built).toBe(0)
		expect(Object.keys(conversion)).not.toContain('sats')
	})

	test("an unavailable rate carries the read's own reason through, and still no number", async () => {
		const conversion = await convertCurrencyToSats({
			amountMinor: 1234,
			currency: 'USD',
			endpoint: PRODUCTION,
			transport: () => ({
				async callTool() {
					throw new Error('the oracle is down')
				},
				async close() {},
			}),
		})

		expect(conversion.state).toBe('unavailable')
		if (conversion.state !== 'unavailable') return
		expect(conversion.reason).toBe('cvm-unreachable')
		expect(conversion.detail).toContain('the oracle is down')
		expect('sats' in conversion).toBe(false)
	})

	test('an amount that is not an integer count of minor units is refused, not rounded', async () => {
		let built = 0
		const conversion = await convertCurrencyToSats({
			amountMinor: 12.5,
			currency: 'USD',
			endpoint: PRODUCTION,
			transport: rateAt(50_000, () => {
				built += 1
			}),
		})

		expect(conversion.state).toBe('unavailable')
		if (conversion.state !== 'unavailable') return
		expect(conversion.reason).toBe('amount-not-convertible')
		expect(built).toBe(0)
	})
})
