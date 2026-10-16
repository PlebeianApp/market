/**
 * currency/assumptions.ts — **the assumptions this module makes, named, with what would falsify each**.
 *
 * The maintainer's instruction: *"ensure anyways to document any assumptions you are
 * making and surface them in the app."* Two obligations, and this file is the first
 * half of both.
 *
 * 1. **Documented.** Every assumption the module makes about the world is a record
 *    here — including the one that looks least like an assumption, that a
 *    CVM-sourced rate is the rate this market should charge by.
 * 2. **Surfaceable.** The register is a plain exported value with a stable shape, so
 *    a host app can render it as-is. It deliberately carries **no framework import**
 *    (`sdk/boundary.test.ts:9` forbids one) and no presentation: it is the data an
 *    on-screen "Assumptions" register reads.
 *
 * **An assumption without a falsifier is not in this file.** `falsifiedBy` names the
 * observation that would make the statement false — so the register is a test plan
 * for the module's honesty rather than a disclaimer. `assumptions.test.ts` refuses an
 * entry with an empty one, and refuses two entries sharing an id.
 *
 * **The app's on-screen register is not in this increment.** `apps/` and `ui/` are
 * outside this task's boundary, so the register is exported and the surface that
 * renders it is reported as a named need rather than written here.
 */

/** One assumption: what the module takes for granted, and what would prove it wrong. */
export interface CurrencyAssumption {
	/** Stable identity, unique within this module. Referenced from the code that leans on it. */
	readonly id: string
	/** The assumption, in one sentence, as a claim about the world. */
	readonly statement: string
	/** The observation that would make the statement false. Not "it might be wrong" — the measurement. */
	readonly falsifiedBy: string
}

/**
 * Every assumption `sdk/commerce/currency` makes.
 *
 * The ids are cited from the source files that lean on them (`./rate`, `./convert`,
 * `./endpoint`), so an assumption can be traced from the code to what it owes.
 */
export const CURRENCY_ASSUMPTIONS: readonly CurrencyAssumption[] = Object.freeze([
	{
		id: 'cvm-rate-is-truth',
		statement: 'The BTC rate a conversion charges by is the one the injected ContextVM oracle returns; no second source is consulted and no rate is invented.',
		falsifiedBy: 'A conversion whose satoshi count disagrees with the rate the CVM returned for that call — or a rate reaching the arithmetic that did not come from a transport built on the injected endpoint.',
	},
	{
		id: 'cvm-endpoint-identifies-the-server',
		statement: 'The endpoint the app injects (server pubkey + relay URLs) identifies the intended production oracle, and the module reaches no oracle it was not given.',
		falsifiedBy: 'A read whose transport was built from anything other than the injected endpoint — a default, a localhost fallback, or a public relay list carried in the module. Mutating the injected endpoint must change the transport the module builds (rate.test.ts).',
	},
	{
		id: 'cvm-tool-shape',
		statement: 'The oracle answers `get_btc_price_single` with `{ currency, rate, fetchedAt, cached }` and signals failure with `isError` and `structuredContent.error`.',
		falsifiedBy: 'A production CVM response that carries the rate under another field name, or signals a refusal without either `isError` or a structured `error`, which the module would report as `rate-absent` or `rate-malformed`.',
	},
	{
		id: 'stale-rate-is-not-judged',
		statement: 'A rate is used as-is once read; the module does not judge its freshness and does not ask the oracle to bypass its cache.',
		falsifiedBy: 'An operator expectation that a stale rate is refused rather than displayed. The module returns `cached` and `fetchedAt` for the caller to judge and never requests a refresh.',
	},
	{
		id: 'currency-precision-is-declared-not-assumed',
		statement: "A currency's precision comes from this module's declared table; a currency with no declared precision is refused and is never assumed to have two decimal places.",
		falsifiedBy: 'A conversion that succeeds for a currency absent from `CURRENCY_PRECISION` — which is how an assumed default would show up.',
	},
	{
		id: 'one-btc-per-100m-sats',
		statement: 'One BTC is 100 000 000 satoshis, so a BTC amount in 8-decimal minor units is already a satoshi count and needs no oracle.',
		falsifiedBy: 'A BTC-tagged amount whose satoshi count differs from `amount × 10^8` — i.e. a conversion of BTC that consulted a rate.',
	},
	{
		id: 'docs-prepare-the-amount-for-a-human-to-render',
		statement: 'The caller presents the converted satoshi count; the module formats nothing and chooses no display currency.',
		falsifiedBy: 'A caller relying on this module for a rendered price string. While the module answers only in sats, nothing here can be assumed to have been formatted, rounded for display, or localised.',
	},
])
