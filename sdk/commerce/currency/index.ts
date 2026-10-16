/**
 * currency/index.ts — `sdk/commerce/currency`: **reading a fiat/BTC amount to sats through ContextVM**.
 *
 * The module's entry. It answers the gap the demo instance names on its own cart
 * page: there was no **read-side** conversion, so the app borrowed the SDK's
 * *authoring* resolver and said so (`apps/demo-shop/instance/cartTotals.ts:22-26`,
 * `sdk/commerce/products/productPriceResolution.ts:64-83`). This is that read side,
 * and it reads its rate through the repository's ContextVM oracle rather than
 * restating `× 100000000` or inventing a rate.
 *
 * **What it owns.**
 *
 * 1. the **endpoint contract** — what a CVM endpoint is and every named reason one
 *    cannot be used (`./endpoint`);
 * 2. the **transport port** — the single seam a rate crosses (`./transport`), whose
 *    production implementation wires `@contextvm/sdk` (`./nostrTransport`);
 * 3. the **read** — one tool call, and an answer that is either a rate or a named
 *    reason there is none (`./rate`);
 * 4. the **conversion** — integer minor units in, whole satoshis out (`./convert`).
 *
 * **The three rules this module is built to keep.**
 *
 * - **The production CVM endpoint is injected configuration.** `CvmEndpoint` is a
 *   parameter of every entry; the module carries no default pubkey, no default relay
 *   and no localhost fallback (`./endpoint` refuses `endpoint-missing` instead).
 * - **An unavailable rate is its own state, never a silent zero.** Every failure is
 *   a distinct `reason` on an `unavailable` arm that has no `sats` field; a
 *   non-positive rate is refused as `rate-malformed` rather than divided by.
 * - **Offline-testable through an injected transport.** The suite passes hand-written
 *   transports; nothing under `sdk/commerce/currency` opens a socket in a test
 *   (ADR-0005).
 *
 * **The money rule** (M1, `sdk/commerce/cart/money.ts`): a currency declares its
 * precision, amounts are integer minor units, and the answer is a whole number of
 * satoshis. This module repeats that table because M1 is a sibling branch; the
 * duplication is reported as a named need in `./convert`.
 *
 * **The assumptions this module makes**, each with what would falsify it, are in
 * `./assumptions` and exported as `CURRENCY_ASSUMPTIONS` for the app's on-screen
 * register: a CVM-sourced rate is the rate we charge by (`cvm-rate-is-truth`); the
 * injected endpoint identifies the intended oracle and nothing else is reached
 * (`cvm-endpoint-identifies-the-server`); the oracle's answer shape
 * (`cvm-tool-shape`); a stale rate is used as-is (`stale-rate-is-not-judged`);
 * precision is declared, never assumed (`currency-precision-is-declared-not-assumed`);
 * one BTC is 100 000 000 sats by definition (`one-btc-per-100m-sats`); and the caller
 * does the formatting (`docs-prepare-the-amount-for-a-human-to-render`).
 */

export { CvmEndpointRefusalError, validateCvmEndpoint } from './endpoint'
export type { CvmEndpoint, CvmEndpointRefusal, CvmEndpointRefusalReason, CvmEndpointResult } from './endpoint'

export type { CvmRateTransport, CvmRateTransportFactory, CvmToolAnswer, CvmToolCall } from './transport'

export { BTC_PRICE_SINGLE_TOOL, isRecord, readCurrencyRate } from './rate'
export type {
	CurrencyRateFailure,
	CurrencyRateFailureReason,
	CurrencyRateRead,
	CurrencyRateSuccess,
	ReadCurrencyRateParams,
} from './rate'

export {
	BITCOIN_CURRENCY,
	CURRENCY_PRECISION,
	SATOSHIS_PER_BITCOIN,
	convertCurrencyToSats,
	currencyPrecision,
	fiatMinorToSats,
	normalizeCurrency,
	toMinorUnits,
} from './convert'
export type {
	ConvertCurrencyToSatsParams,
	CurrencyConversion,
	CurrencyConversionFailure,
	CurrencyConversionFailureReason,
	CurrencyConversionSuccess,
} from './convert'

export { createNostrCvmTransportFactory } from './nostrTransport'
export type { NostrCvmTransportOptions } from './nostrTransport'

export { CURRENCY_ASSUMPTIONS } from './assumptions'
export type { CurrencyAssumption } from './assumptions'

// `./validationDeclaration` is deliberately NOT re-exported here, matching every other
// `sdk/commerce` module: the declaration is consumed by the composition root directly
// (`sdk/core/composition/ts/gate.test.ts:21` imports a sibling's file, not its barrel), and
// re-exporting it would drag the composition rung into every import of this module.
