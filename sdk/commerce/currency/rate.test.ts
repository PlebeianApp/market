/**
 * rate.test.ts — **the read, over an injected endpoint and an injected transport**.
 *
 * Two things are being proved here, and they are the two the task names:
 *
 * 1. **The production endpoint is configuration.** `readCurrencyRate` builds its
 *    transport from *the endpoint it was handed* — so two reads with two endpoints
 *    produce two different transports, in order, and a read with **no** endpoint is a
 *    named refusal rather than a fallback.
 * 2. **An unavailable rate is a named state, never a zero.** A thrown transport, a
 *    transport-level error, a server refusal, a missing rate and a non-positive rate
 *    each land on their own `reason`, and the `unavailable` arm has **no `sats`
 *    field** at all — so a caller cannot read a price out of a failure even by
 *    accident.
 *
 * **The mutations that turn each case red:**
 *
 * - *"uses the injected endpoint"* → replace `params.endpoint` with a module constant
 *   (e.g. `{ serverPubkey: PlebeianServerClient.SERVER_PUBKEY, relayUrls: ['ws://localhost:10547'] }`):
 *   the second read's `seen[1]` becomes the constant and the case fails.
 * - *"no endpoint is a refusal"* → add a default endpoint
 *   (`params.endpoint ?? LOCAL`) — `built` becomes 1 and `state` becomes `rate`.
 * - *"a failing CVM is a refusal"* → return any number on the throw path (e.g.
 *   `{ state: 'rate', rate: 0 }`) — the case fails on `reason`.
 * - *"a non-positive rate is refused"* → drop the `rate <= 0` guard — a `0` rate
 *   becomes a `rate` state and the case fails.
 * - *"the tool call is the CVM's own"* → change `BTC_PRICE_SINGLE_TOOL` or drop the
 *   `currency` argument — the recorded call no longer matches.
 */
import { describe, expect, test } from 'bun:test'

import type { CvmEndpoint } from './endpoint'
import { BTC_PRICE_SINGLE_TOOL, readCurrencyRate } from './rate'
import type { CvmRateTransportFactory, CvmToolAnswer, CvmToolCall } from './transport'

const PRODUCTION: CvmEndpoint = { serverPubkey: 'a'.repeat(64), relayUrls: ['wss://relay.plebeian.market'] }

/** A transport that records the endpoint it was built from and answers whatever it is told. */
function transportAnswering(
	answer: CvmToolAnswer,
	onBuild?: (endpoint: CvmEndpoint) => void,
	onCall?: (call: CvmToolCall) => void,
	onClose?: () => void,
): CvmRateTransportFactory {
	return (endpoint) => {
		onBuild?.(endpoint)
		return {
			async callTool(call) {
				onCall?.(call)
				return answer
			},
			async close() {
				onClose?.()
			},
		}
	}
}

const usdRate = (rate: number, extra: Record<string, unknown> = {}): CvmToolAnswer => ({
	ok: true,
	isError: false,
	structured: { currency: 'USD', rate, fetchedAt: 1_700_000_000_000, cached: false, ...extra },
})

describe('reading a rate through ContextVM', () => {
	test('builds its transport from the endpoint the app injected, in order, and not from a constant', async () => {
		const seen: CvmEndpoint[] = []
		const transport = transportAnswering(usdRate(50_000), (endpoint) => seen.push(endpoint))

		const first = await readCurrencyRate({
			currency: 'USD',
			endpoint: { serverPubkey: 'a'.repeat(64), relayUrls: ['wss://production.one.example'] },
			transport,
		})
		const second = await readCurrencyRate({
			currency: 'USD',
			endpoint: { serverPubkey: 'b'.repeat(64), relayUrls: ['wss://production.two.example'] },
			transport,
		})

		expect(first.state).toBe('rate')
		expect(second.state).toBe('rate')
		expect(seen).toEqual([
			{ serverPubkey: 'a'.repeat(64), relayUrls: ['wss://production.one.example'] },
			{ serverPubkey: 'b'.repeat(64), relayUrls: ['wss://production.two.example'] },
		])
	})

	test('an endpoint the app did not pass is a named refusal and no transport is built', async () => {
		let built = 0
		const transport = transportAnswering(usdRate(50_000), () => {
			built += 1
		})

		const read = await readCurrencyRate({ currency: 'USD', endpoint: undefined, transport })

		expect(read.state).toBe('unavailable')
		if (read.state !== 'unavailable') return
		expect(read.reason).toBe('endpoint-refused')
		expect(read.detail).toContain('endpoint-missing')
		expect(built).toBe(0)
	})

	test('reaches the server refusal as its own state, carrying the server message', async () => {
		const read = await readCurrencyRate({
			currency: 'XYZ',
			endpoint: PRODUCTION,
			transport: transportAnswering({
				ok: true,
				isError: true,
				structured: { error: 'Unsupported currency: XYZ. Supported: USD, EUR' },
			}),
		})

		expect(read.state).toBe('unavailable')
		if (read.state !== 'unavailable') return
		expect(read.reason).toBe('rate-tool-error')
		expect(read.detail).toContain('Unsupported currency: XYZ')
		expect('sats' in read).toBe(false)
	})

	test('an unreachable CVM is its own state, with no number anywhere on the result', async () => {
		const throwing: CvmRateTransportFactory = () => ({
			async callTool() {
				throw new Error('relay refused the connection')
			},
			async close() {},
		})
		const read = await readCurrencyRate({ currency: 'USD', endpoint: PRODUCTION, transport: throwing })

		expect(read.state).toBe('unavailable')
		if (read.state !== 'unavailable') return
		expect(read.reason).toBe('cvm-unreachable')
		expect(read.detail).toContain('relay refused the connection')
		expect(Object.keys(read)).not.toContain('sats')
	})

	test('a transport-level error answer is the same named state', async () => {
		const read = await readCurrencyRate({
			currency: 'USD',
			endpoint: PRODUCTION,
			transport: transportAnswering({ ok: false, reason: 'transport-error', detail: 'socket closed' }),
		})
		expect(read.state).toBe('unavailable')
		if (read.state !== 'unavailable') return
		expect(read.reason).toBe('cvm-unreachable')
		expect(read.detail).toBe('socket closed')
	})

	test('an answer with no rate field is `rate-absent`, not a zero', async () => {
		const read = await readCurrencyRate({
			currency: 'USD',
			endpoint: PRODUCTION,
			transport: transportAnswering({ ok: true, isError: false, structured: { currency: 'USD', fetchedAt: 1, cached: false } }),
		})
		expect(read.state).toBe('unavailable')
		if (read.state !== 'unavailable') return
		expect(read.reason).toBe('rate-absent')
	})

	test('a non-positive or non-finite rate is refused as `rate-malformed`', async () => {
		for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '7']) {
			const read = await readCurrencyRate({
				currency: 'USD',
				endpoint: PRODUCTION,
				transport: transportAnswering({
					ok: true,
					isError: false,
					structured: { currency: 'USD', rate: bad, fetchedAt: 1, cached: false },
				}),
			})
			expect(read.state).toBe('unavailable')
			if (read.state !== 'unavailable') return
			expect(read.reason).toBe('rate-malformed')
		}
	})

	test('asks the CVM tool the server registers, for the currency asked, and closes once', async () => {
		const calls: CvmToolCall[] = []
		let closes = 0
		const read = await readCurrencyRate({
			currency: 'usd',
			endpoint: PRODUCTION,
			transport: transportAnswering(usdRate(50_000, { cached: true }), undefined, (call) => calls.push(call), () => {
				closes += 1
			}),
		})

		expect(calls).toEqual([{ name: BTC_PRICE_SINGLE_TOOL, arguments: { currency: 'USD' } }])
		expect(BTC_PRICE_SINGLE_TOOL).toBe('get_btc_price_single')
		expect(closes).toBe(1)
		expect(read.state).toBe('rate')
		if (read.state !== 'rate') return
		expect(read.rate).toBe(50_000)
		expect(read.currency).toBe('USD')
		expect(read.cached).toBe(true)
		expect(read.fetchedAt).toBe(1_700_000_000_000)
		expect(read.source).toBe('contextvm')
	})
})
