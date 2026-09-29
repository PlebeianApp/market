/**
 * Shared PII sentinels for the private-order and NIP-59 privacy suites.
 *
 * Six suites assert the same two-sided property: the exact plaintext marker must
 * be rejected, while an unrelated 64-character hex identifier that merely
 * contains the same digits must be allowed. They previously each declared their
 * own copy and drifted into two spellings (`private-postcode::` in five files,
 * `buyer-postcode::` in `src/publish/orders.test.ts`), which made the suites look
 * as though they asserted different values.
 *
 * The marker stays plaintext on purpose: the privacy checks scan serialized
 * whole events, and a `::`-delimited marker is distinguishable from hex. Not
 * named `*.test.ts` so the unit glob does not collect it.
 */

/** Exact plaintext postcode marker that every privacy suite must reject. */
export const POSTCODE_PII_SENTINEL = 'private-postcode::90210::plaintext-only'

/**
 * A 64-character hex identifier that contains the sentinel's digits but is not
 * the marker — the privacy checks must allow it. Parallel to the hex shapes the
 * app uses for event ids and pubkeys.
 */
export const HEX_IDENTIFIER_WITH_POSTCODE = `${'a'.repeat(29)}90210${'b'.repeat(30)}`
