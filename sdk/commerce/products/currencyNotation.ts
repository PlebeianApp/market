/**
 * products/currencyNotation.ts — one place for the notation decision.
 *
 * **The rule (`D-CURRENCY`).** The SDK **emits** `SAT` (three letters, matching
 * the repository's kind-30402 parser at `src/lib/schemas/productListing.ts:15`,
 * which demands `[A-Z]{3}`).  The SDK **accepts** `SAT`, `SATS`, `sat` and `sats`
 * on read, so already-published listings keep resolving.
 *
 * **Why the acceptance list is this wide — production counts, not a guess.**
 * A probe across 9 relays (4,675 kind-30402 listings seen) returned:
 *   SAT    —  841
 *   SATS   —  276  (dominant on `relay.primal.net` at 127)
 *   sats   —   78
 *   sat    —   15
 *   absent —  144
 * `wss://relay.plebeian.market` (our own staging relay) returned SAT 402 of 500.
 *
 * **A missing currency element is a named refusal.**  144 real listings carry
 * no currency element on their price tag; a price with no currency is not a
 * price, and this function refuses it by name — it does not vanish silently.
 *
 * **Named need (reported, not fixed).**  The field `iso4217Currency` in
 * `src/lib/schemas/common.ts:5` is a misnomer — `SAT` is not an ISO-4217 code.
 * The constant enforces `/^[A-Z]{3}$/` which `SAT` satisfies, but the name
 * claims an ISO standard that satoshi does not belong to.  A rename to
 * `currencyCode` (or similar) would match what it actually enforces.
 */

/** The canonical three-letter string this repository uses for satoshi. */
export const BITCOIN_CURRENCY = 'SAT' as const

/** The reasons a currency cannot be resolved from raw input. */
export type CurrencyRefusalReason = 'missing-currency'

/** The outcome of normalising a raw currency identifier. */
export type CurrencyNormalizationResult =
    | { ok: true; value: string }
    | { ok: false; reason: CurrencyRefusalReason }

/**
 * Normalize a raw currency identifier from a kind-30402 price tag.
 *
 * Read path: accepts `SAT`, `SATS`, `sat`, `sats` (case-insensitive) and
 * normalises to `SAT`; passes any other code through as uppercase.
 * Missing or empty input is a named refusal with reason `'missing-currency'`.
 *
 * Emit path: callers that build a price tag call this function and use
 * the `.value` of an `ok` result.  Calling it on an empty or absent
 * currency is a programming error — the validation layer rejects those.
 */
export function normalizeCurrency(raw: string | undefined | null): CurrencyNormalizationResult {
    if (!raw || raw.trim().length === 0) return { ok: false, reason: 'missing-currency' }
    const upper = raw.trim().toUpperCase()
    if (upper === 'SAT' || upper === 'SATS') return { ok: true, value: 'SAT' }
    return { ok: true, value: upper }
}