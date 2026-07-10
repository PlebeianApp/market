/**
 * Shared Zod primitives for auction protocol schemas. Kept separate
 * from `src/lib/schemas/common.ts` so we don't bloat that file with
 * auction-specific patterns, and so the per-event schemas in this
 * directory can refer to typed primitives without repeating the
 * regexes.
 */

import { z } from 'zod'

/** Compressed secp256k1 pubkey in hex (33 bytes, leading 02/03). */
export const compressedPubkeyHex = z
	.string()
	.regex(/^0[23][0-9a-fA-F]{64}$/, 'Must be a compressed secp256k1 pubkey (66 hex chars starting with 02 or 03)')

/** Nostr identity / x-only pubkey in hex (32 bytes, 64 hex chars). */
export const nostrPubkeyHex = z.string().regex(/^[0-9a-fA-F]{64}$/, 'Must be a 64-character hex Nostr pubkey')

/** Nostr event id in hex (32 bytes). */
export const nostrEventIdHex = z.string().regex(/^[0-9a-fA-F]{64}$/, 'Must be a 64-character hex Nostr event id')

/** Addressable coordinate `kind:pubkey:d` — same shape as common but anchored. */
export const addressableCoordinate = z
	.string()
	.regex(/^\d+:[0-9a-fA-F]{64}:[A-Za-z0-9_-]+$/, 'Must be `kind:pubkey:d` (e.g. 30408:<seller>:<auction-d>)')

/** Non-negative unix-seconds integer. */
export const unixSeconds = z.number().int().nonnegative()

/** Non-negative integer (sats, counts, etc.). */
export const nonNegativeInt = z.number().int().nonnegative()

/** Positive integer (amounts that can't legitimately be zero). */
export const positiveInt = z.number().int().positive()

/** BIP-32 derivation path, e.g. `m/123/456/789/1011/1213`. */
export const bip32Path = z
	.string()
	.regex(/^m(\/\d+'?)+$/, 'Invalid derivation path format. Must be a BIP-32 derivation path (e.g. m/12/34/...)')
