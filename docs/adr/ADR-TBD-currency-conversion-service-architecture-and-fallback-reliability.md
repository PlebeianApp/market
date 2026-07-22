# ADR-TBD: Currency-Conversion Service Architecture and Fallback Reliability

## Status

Issue

## Date

2026-07-22

## Related

- PR under review: `turizspace:fix/shipping-options` — centralizes sats/fiat
  conversion into `MempoolService` and surfaces the behaviors described below.
- Pre-existing, **kept separate from this ADR and the PR review**: the local
  Playwright e2e `can create a new product` spec fails on *both* `master` and
  the PR because the local e2e environment has no BTC exchange rates
  (`LOCAL_RELAY_ONLY=true`, no reachable ContextVM currency server). That
  environmental failure must not be attributed to this PR; it is the backdrop
  that made the structural problems visible.
- Server-side aggregation: `contextvm/tools/price-sources.ts`
  (`fetchAllSources` — Yadio/CoinDesk/Binance/CoinGecko, median).
- Client identity ordering: `src/lib/cvm-identity.ts` (`resolveCvmServerPubkey`).
- CVM Nostr client: `src/lib/ctxcn-client.ts` (`PlebianCurrencyClient`).
- Client fetch + fallback: `src/queries/external.tsx` (`fetchBtcExchangeRates`).
- Pure math: `src/lib/utils/mempool.ts` (`MempoolService.convert*`).
- Consumers: `src/components/PriceDisplay.tsx`,
  `src/components/sheet-contents/products/tabs.tsx`, `src/lib/stores/cart.ts`,
  `src/components/checkout/OnChainPaymentProcessor.tsx`,
  `src/lib/stores/product.ts`.

## Context

The app converts prices between sats, BTC, and fiat using **three overlapping
layers plus a separate server-side aggregator**, with no single source of
truth. A "simple API fallback" for a missing ContextVM (CVM) rate server *does*
exist (`fetchBtcExchangeRates` tries ContextVM, then Yadio), but it is fragile:
it degrades to a single HTTP source, the pure-math layer returns `NaN` when
rates are unavailable, the CVM identity resolver throws and can take down the
whole `/api/config` endpoint, and the client/server rate-fetching strategies
are structurally inconsistent. The net effect is that the conversion path
reliably works only when ContextVM is healthy, and silently degrades or breaks
otherwise — which is why a missing-rate state manifests as "failing to
convert the amount" rather than a clean fallback.

The four layers, briefly:

1. **`MempoolService`** (`src/lib/utils/mempool.ts`) — pure synchronous math.
   `convertCurrencyToSats` / `convertSatsToCurrency` / `convertBetweenCurrencies`
   plus `satoshisToBtc` / `btcToSatoshis`. The only unit-tested conversion
   primitive. Returns **`NaN`** on missing `exchangeRates` or missing rate.
2. **`queries/external.tsx`** — async, networked. `fetchBtcExchangeRates()`
   = ContextVM first, **Yadio** fallback. `convertCurrencyToSats(currency, amount)`
   is a *second* conversion path that fetches a fresh rate and delegates to
   `MempoolService`. React Query hooks wrap both.
3. **`cvm-identity.ts` + `ctxcn-client.ts`** — the ContextVM Nostr/MCP client.
   `resolveCvmServerPubkey()` resolves the server pubkey from env and **throws**
   if none is configured.
4. **`contextvm/tools/price-sources.ts`** — the CVM *server* (separate process).
   Aggregates **four** sources (Yadio, CoinDesk, Binance, CoinGecko) in
   parallel and takes the **median** per currency. Robust — but the browser
   never reuses this aggregation; on CVM failure the client falls back to
   **single-source Yadio only**.

### Detailed context (for agents)

Layer-by-layer findings:

- **Fallback asymmetry.** The CVM server's `fetchAllSources` produces a
  4-source median. The client fallback (`fetchBtcExchangeRates`) is a single
  Yadio call with no further fallbacks to CoinDesk/Binance/CoinGecko. "CVM
  down" silently means "one source of truth," undocumented.
- **`NaN` poisoning.** While `useBtcExchangeRates()` is loading or has
  errored, `exchangeRates` is `undefined`; `MempoolService.convertCurrencyToSats(
  {fromCurrency:'USD', exchangeRates:undefined})` returns `NaN`. In
  `tabs.tsx` the ShippingTab computes `productSats = convertCurrencyToSats(...)`
  and `combinedSats = Math.round(productSats + shippingSats)` → `NaN`. The UI
  guards *display* (`formatSats` → `'—'`), but the derived `productSats` is
  `NaN`, which fails form validation. The pre-centralization inline
  `convertCurrencyToSats` (master) returned `0` here, so this is a behavioral
  regression: three different "no rates" behaviors now coexist — `NaN`
  (`MempoolService`), `0` (old inline), and `0`-with-warn (`cart.ts`'s
  `currencyToSats`).
- **CVM identity is a hard dependency of `/api/config`.** With no
  `CVM_SERVER_KEY`/pubkey env, `resolveCvmServerPubkey()` throws; `index.tsx`'s
  `getCvmServerPublicKey()` lets it propagate, so `/api/config` fails and the
  app cannot load at all. "CVM not configured" is conflated with "app config
  unavailable" instead of degrading to the Yadio path.
- **Mismatched timeouts + artificial delay.** `PlebianCurrencyClient.callTool`
  waits 1500ms before sending and has an internal `TIMEOUT_MS = 20000`;
  `external.tsx` races the same call with `CONTEXTVM_CALL_TIMEOUT = 5000`. The
  5s race almost always wins and the 1.5s pre-send delay eats the budget, so a
  healthy-but-slow CVM server is treated as "down" and the client falls back.
- **Public relay leak under `LOCAL_RELAY_ONLY`.** `getCurrencyServerRelays()`
  returns `['ws://localhost:10547', 'wss://relay.contextvm.org']` in dev
  regardless of `LOCAL_RELAY_ONLY`, and the CVM currency server is not on
  localhost:10547 (that's `nak`). The public `relay.contextvm.org` is still
  contacted, contradicting "local only."
- **Two parallel conversion paths with no facade.** Path A:
  `useCurrencyConversion(c, amt)` → async `convertCurrencyToSats` → fresh fetch
  + `MempoolService`. Path B: `useBtcExchangeRates()` + direct
  `MempoolService.convertCurrencyToSats(...)` (used in `tabs.tsx`, `cart.ts`)
  using cached rates. These can return different numbers (fresh vs
  stale-cached). `convertCurrencyToSats` even rebuilds a one-currency
  `exchangeRates` object `{[currency]: rate}` to pass to `MempoolService`
  instead of reusing the already-fetched full map.
- **Magic constant duplicated.** The sats-per-BTC factor appears ~12× across
  5 files: `mempool.ts` (`100_000_000`), `cart.ts` (its own
  `numSatsInBtc = 100000000` — a *second* definition), `tabs.tsx` (×2),
  `PriceDisplay.tsx` (×2), `product.ts` (×2). `PriceDisplay.getFiatValue` does
  `satsValue / 100000000` inline instead of `MempoolService.satoshisToBtc`.
  `MempoolService` encapsulates the constant but nothing enforces its use.
- **Type-safety gap.** `useBtcExchangeRates()` returns
  `Record<SupportedCurrency, number>`; `MempoolService` accepts
  `Record<string, number> | undefined` and indexes by arbitrary string;
  `PriceDisplay` casts via `as keyof typeof exchangeRates`. Unsupported
  currencies silently yield `undefined` → `NaN`.
- **Documentation gaps.** `cvm-identity.ts` and `price-sources.ts` are
  well-documented; `MempoolService`'s new methods have no doc comments despite
  non-obvious `NaN` semantics; `external.tsx`'s priority is undocumented; the
  client/server fallback asymmetry is unstated anywhere.

## Problem statement

The currency-conversion subsystem has no single source of truth and degrades
unpredictably when ContextVM is unavailable. Concretely:

1. A missing-rate state produces `NaN` from `MempoolService`, which silently
   poisons derived prices and fails validation (behavioral regression vs the
   old `0` fallback).
2. The client fallback is single-source Yadio, far weaker than the CVM
   server's 4-source median, and is one HTTP failure away from total
   conversion loss.
3. An unconfigured CVM identity throws and takes down `/api/config`, instead
   of degrading gracefully.
4. CVM timeout/delay constants are mismatched, over-eagerly forcing fallback.
5. `LOCAL_RELAY_ONLY` does not actually exclude the public CVM relay.
6. Conversion is reachable through two inconsistent paths with no facade, and
   the sats-per-BTC constant is duplicated across the codebase.

Any solution must at minimum make the missing-rate state deterministic and
non-fatal, make CVM an optional/degradable provider, and stop the CVM-identity
failure from affecting app boot. Beyond that, the structural options below
differ in how much they unify the conversion surface.

## Solution space

This ADR is in **Issue** state: it lays out the problem and surveys solution
paths without selecting one. The paths are points on a spectrum; they are not
mutually exclusive and could be combined.

### Solution A — Minimal hardening (preserve the current architecture)

Keep the three client layers and the two-layer client fallback as-is. Fix the
concrete defects without restructuring.

**Expected structure:**
- `MempoolService.convertCurrencyToSats` / `convertSatsToCurrency` /
  `convertBetweenCurrencies` keep their signatures but return a deterministic
  **`0`** (matching `cart.ts` and the old inline behavior) instead of `NaN`
  when `exchangeRates` is missing or the rate is absent. Document the
  "no rates ⇒ 0" contract.
- `cvm-identity.ts`: `resolveCvmServerPubkey()` returns `string | null`
  instead of throwing; `index.tsx`/config treats `null` as "CVM path disabled,
  use fallback."
- `queries/external.tsx`: `getCurrencyClient()` is skipped (returns `null`)
  when no server pubkey; `fetchBtcExchangeRates` proceeds straight to Yadio.
  Align `CONTEXTVM_CALL_TIMEOUT` with the client's `TIMEOUT_MS` (or vice
  versa) and remove/document the 1500ms pre-send delay.
- `constants.ts`: `getCurrencyServerRelays()` omits
  `wss://relay.contextvm.org` when `LOCAL_RELAY_ONLY` is set.
- No new modules; no consumer changes beyond removing now-unneeded
  `Number.isFinite` guards.

**Shape:** smallest blast radius, fastest to land, but leaves the two-path /
duplicated-constant / single-source-fallback structure intact.

### Solution B — Client-side multi-source fallback mirroring the server

Lift the server's aggregation logic into a shared module so the browser
fallback is as robust as the CVM server, not single-source Yadio.

**Expected structure:**
- New shared module `src/lib/currency/rate-sources.ts` (extracted from / shared
  with `contextvm/tools/price-sources.ts`): `fetchYadioRates`,
  `fetchCoinDeskRates`, `fetchBinanceRates`, `fetchCoinGeckoRates`,
  `fetchAllSources` (median). Importable by both the CVM server and the
  browser bundle.
- `src/queries/external.tsx`: `fetchBtcExchangeRates()` becomes
  **ContextVM → `fetchAllSources()`** (median of HTTP sources) → throw if all
  fail. The single-Yadio call is replaced by the shared aggregation.
- `MempoolService` keeps the pure math; the `NaN`→`0` fix from Solution A is
  applied here too.
- `cvm-identity.ts` degrades to `string | null` as in A.
- Consumers unchanged structurally; they still choose between `MempoolService`
  (cached) and the async `convertCurrencyToSats` (fresh).

**Shape:** robust fallback parity, moderate change (one new shared module,
`external.tsx` rewritten fallback), but the two-path / duplicated-constant
issues remain.

### Solution C — Single canonical conversion facade + optional CVM

Introduce one `CurrencyService` that owns rate fetching, all sats↔BTC↔fiat
math, and the "no rates" contract; make ContextVM an optional provider so the
app boots and converts without it.

**Expected structure:**
- `src/lib/currency/` package:
  - `math.ts` — the single `SATOSHIS_PER_BTC` constant and the pure
    `satsToBtc` / `btcToSats` / `fiatToSats` / `satsToFiat` math (formerly
    `MempoolService.convert*`). No `NaN`: returns `0` (or a `Result`/`null`)
    on missing rates, documented.
  - `rate-provider.ts` — providers with a common interface
    (`fetchRates(): Promise<Record<SupportedCurrency, number>>`):
    `CvmRateProvider` (Nostr/MCP, optional) and `HttpAggregatorProvider`
    (the shared `fetchAllSources` median). A small `RateProviderChain` runs
    them in priority order (CVM first, then aggregator) and returns the first
    success.
  - `currencyService.ts` — the facade: `getRates()`, `toSats(amount, currency)`,
    `fromSats(sats, currency)`, `convert(amount, from, to)`. Backed by a
    React Query cache. This is the **only** conversion entry point.
- `ctxcn-client.ts` / `cvm-identity.ts` retained but CVM identity becomes
  optional (`string | null`); `CvmRateProvider` no-ops when absent.
- `src/queries/external.tsx` thins to `useBtcExchangeRates()` +
  `useCurrencyConversion()` delegating to `currencyService`. The standalone
  async `convertCurrencyToSats` and the per-call `fetchCurrencyExchangeRate`
  are removed in favor of the cached facade.
- Consumers (`PriceDisplay`, `tabs.tsx`, `cart.ts`, `checkout`, `product.ts`)
  import only `currencyService` and its hooks; all inline `100000000` /
  `numSatsInBtc` literals are deleted in favor of `currencyService` /
  `math.ts`. `MempoolService`'s conversion methods are deprecated/removed
  (its on-chain fee helpers, if any, stay).
- `/api/config` never fails on missing CVM identity; it reports
  `cvmServerPubkey: null` and the app proceeds on HTTP-aggregated rates.

**Shape:** largest change, but it removes the duplicated constant, the two
conversion paths, and the `NaN`/single-source problems at the root; gives one
typed, documented entry point; and makes CVM truly optional. Higher
short-term surface area and a consumer migration.

### Combinations

- A is a strict subset of B and C (the `NaN`→`0` and `cvm-identity`→`null`
  fixes apply to all). A could ship first as a stopgap.
- B + C's facade (without the provider-chain refactor) gives robust fallbacks
  behind one entry point.
- C's provider-chain can adopt B's shared `rate-sources.ts` as its
  `HttpAggregatorProvider`.

## Invariants (any solution must satisfy)

- A missing-rate state never yields `NaN` to consumers or validation; the
  "no rates" result is deterministic and documented.
- `/api/config` never fails solely because CVM identity is unconfigured.
- `LOCAL_RELAY_ONLY` excludes the public CVM relay from the client relay set.
- CVM call timeouts are consistent across the client and the fetch wrapper;
  the pre-send delay is removed or justified.
- The sats-per-BTC factor has exactly one definition.
- Conversion has one documented entry point; no consumer inlines the factor
  or calls raw `exchangeRates[currency]` indexing for currency conversion.

## Consequences

### Positive (common to all)

- "CVM down / rates missing" stops breaking conversion and app boot; the
  fallback is deterministic and observable.
- Price validation is no longer poisoned by `NaN`; the create-product flow
  behaves consistently regardless of rate availability.
- CVM becomes an optional, degradable provider rather than a hard dependency.

### Costs / tradeoffs by path

- **A:** lowest risk and fastest, but leaves structural duplication and the
  weaker single-source fallback; future solutions will revisit the same code.
- **B:** robust fallback parity at moderate cost; introduces a shared module
  that the CVM server and browser must keep in sync; does not address the
  two-path / constant-duplication issues.
- **C:** resolves the root structural problems and gives one typed entry
  point, but is the largest change — new package, consumer migration,
  deprecation of `MempoolService.convert*`, and a transitional period where
  both old and new surfaces coexist.

### Risks

- Any change to the "no rates" contract (`NaN` → `0`) can shift behavior that
  downstream code has come to depend on; needs the existing
  `currency.test.ts` and `external.test.ts` extended to pin the new contract,
  and an audit of every `convertCurrencyToSats` consumer for `NaN`-assumption
  code.
- Making CVM optional changes the security/trust model (rates come from
  public HTTP sources instead of a Nostr-verifiable CVM server); should be
  documented so operators understand the degradation.
- Reusing `price-sources.ts` in the browser bundle adds fetch surface and
  bundle weight; confirm CORS/CSP allow the extra rate endpoints.

## Notes

This ADR is intentionally architecture-first and in **Issue** state: it
documents the problem and the solution space without committing to a path.
The immediate PR (`turizspace:fix/shipping-options`) should not be blocked on
this decision; at minimum the `NaN`-vs-`0` behavioral regression (Solution A's
first bullet) should be addressed there or as a follow-up, since it is the
concrete regression the PR introduced on top of the pre-existing
missing-rates environment.

The separate, pre-existing local e2e failure (`can create a new product` on
both master and the PR, due to no reachable rates in the local env) is out of
scope here; it is tracked alongside but must not be conflated with the PR
review or with the structural decisions above.