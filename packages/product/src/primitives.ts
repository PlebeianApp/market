/**
 * Field primitives for the product contract.
 *
 * Extracted from `src/lib/schemas/common.ts` so this package carries no dependency on the
 * application. The regexes are identical to the originals: they are the pinned external contract
 * (NIP-99 for the price/currency shape, Gamma for the frequency vocabulary), and changing them
 * changes what a valid listing is.
 */
import { z } from 'zod'

/** `kind:pubkey:d` — the addressable coordinate form (NIP-01). */
export const addressableFormat = z.string().regex(/^\d+:[0-9a-f]{64}:[a-zA-Z0-9_-]+$/, 'Must be in format kind:pubkey:d-identifier')

export const hexString = z.string().regex(/^[0-9a-f]{64}$/, 'Must be a 64-character hex string')

/**
 * The price currency.
 *
 * NIP-99 specifies: *"the currency unit in 3-character ISO 4217 format **or ISO 4217-like currency
 * code** (e.g. `"btc"`, `"eth"`)"*. The original primitive here was `/^[A-Z]{3}$/` — exactly three
 * uppercase letters — which rejects both of NIP-99's own examples (`btc`, `eth` are lowercase) and,
 * in live traffic, rejects `SATS`, the most natural currency code on a Bitcoin marketplace.
 *
 * Measured 2026-09-22 against 60 live kind-30402 events from three public relays: of the listings
 * rejected by the old schema, 30 were rejected for this rule alone, on tags like
 * `["price","40000","SATS"]` and `["price","5","USDC"]`. That is a majority of real listings failing
 * on a rule the base spec explicitly loosens. So we implement the spec's wording rather than its
 * example: 3–4 letters, case preserved.
 *
 * Recorded decision D7 (2026-09-22). The case is preserved and never normalised here — what `sats`
 * versus `SATS` means for display is a presentation decision, not a validity one.
 */
export const iso4217Currency = z.string().regex(/^[A-Za-z]{3,4}$/, 'Must be a 3- or 4-letter ISO 4217 or ISO 4217-like currency code')

export const iso3166Country = z.string().regex(/^[A-Z]{2}$/, 'Must be an ISO 3166-1 alpha-2 country code')

export const iso3166Region = z.string().regex(/^[A-Z]{2}-[A-Z0-9]{1,3}$/, 'Must be an ISO 3166-2 region code')

/**
 * Gamma's recurrence vocabulary: ISO 8601 duration units (H/D/W/M/Y).
 *
 * Recorded divergence (browsing spec §2.3): NIP-99 says the price frequency SHOULD be a noun
 * ("month", "year"); Gamma says ISO 8601 units. Both use the same tag slot, so the two are
 * mutually unintelligible. We follow Gamma because that is what our own writers emit — and per the
 * spec this must be handled as *unparsed* rather than "no frequency" when the value is unrecognised.
 */
export const iso8601Duration = z.enum(['H', 'D', 'W', 'M', 'Y'])

export const geohash = z.string().regex(/^[0-9a-z]{1,12}$/, 'Must be a valid geohash')

/** A decimal amount as published: NIP-99 says numeric-as-string. */
export const decimalNumber = z.string().regex(/^\d+(\.\d+)?$/, 'Must be a valid decimal number')

export const integerString = z.string().regex(/^\d+$/, 'Must be an integer')

/** `LxWxH`, each dimension decimal (Gamma `dim`). */
export const dimensions = z.string().regex(/^\d+(\.\d+)?x\d+(\.\d+)?x\d+(\.\d+)?$/, 'Must be in format LxWxH')
