/**
 * Zod schema + parser for kind-1023 bid events under
 * `cashu_p2pk_bidder_path_v1`. See AUCTIONS.md §4.2.
 *
 * The bid event is the most security-critical Nostr event in the
 * protocol — every required tag carries data validators audit. The
 * schema below enforces:
 *
 *   - presence + format of the references (auction, seller, mints)
 *   - the bidder's published lock-secret + proof_y (the
 *     audit-without-the-token machinery)
 *   - rejection of any `derivation_path` tag (would mean early
 *     settlement; treated as malformed)
 *   - rejection of legacy `path_issuer` / `path_grant_id` tags from
 *     the previous oracle scheme
 *
 * Cross-event invariants (locktime equals `max_end_at +
 * settlement_grace`, lock_secret pubkey matches `child_pubkey`,
 * proof_y derives from the secret, etc.) are NOT enforced here —
 * they live in the validation pipeline (§7.1) which has the auction
 * event available for cross-reference.
 */

import { z } from 'zod'
import { AUCTION_BID_KIND, AUCTION_KEY_SCHEME } from '../../auction/constants'
import type { ParsedBidEvent } from '../../auction/events'
import type { NostrEventLike } from '../../nostr/eventLike'
import { addressableCoordinate, compressedPubkeyHex, nostrEventIdHex, nostrPubkeyHex, positiveInt, unixSeconds } from './common'
import { readMultiTag, readSingleTag } from './tagAccess'

// ----------------------------------------------------------------------------
// DLEQ proof (NUT-12) — one `dleq_proof` tag per locked proof (ADR-0011)
// ----------------------------------------------------------------------------

/** Hex scalar (DLEQ challenge/response/blinding factor, keyset id). Even-length (byte-aligned). */
const hexScalar = z.string().regex(/^(?:[0-9a-fA-F]{2})+$/, 'must be an even-length (byte-aligned) hex string')

/**
 * One serialized NUT-12 DLEQ proof, mirroring {@link DleqProof} from
 * `src/lib/cashu/dleq.ts`: the proof's keyset id, amount, mint signature
 * `C` (compressed secp256k1 hex), the DLEQ challenge/response `e`/`s`, and
 * the holder's blinding factor `r`.
 */
export const dleqProofSchema = z.object({
	id: hexScalar,
	amount: positiveInt,
	C: compressedPubkeyHex,
	e: hexScalar,
	s: hexScalar,
	r: hexScalar,
})

// ----------------------------------------------------------------------------
// Intermediate Zod schema
// ----------------------------------------------------------------------------

export const BidEventSchema = z
	.object({
		id: nostrEventIdHex,
		bidderPubkey: nostrPubkeyHex,
		createdAt: unixSeconds,
		auctionRootEventId: nostrEventIdHex,
		auctionCoordinate: addressableCoordinate,
		sellerPubkey: nostrPubkeyHex,
		amount: positiveInt,
		// Placeholder at parse time: initialized from the `amount` tag
		// (cumulative) and ALWAYS overwritten by `computeLegLockedAmounts`
		// with the signed chain delta before any validation reads it.
		legLockedAmount: positiveInt,
		currency: z.literal('SAT', { message: 'currency must be SAT' }),
		mint: z.string().url({ message: 'mint must be a URL' }),
		locktime: positiveInt,
		refundPubkey: compressedPubkeyHex,
		childPubkey: compressedPubkeyHex,
		// One entry per locked proof making up the bid. Cashu wallets
		// typically produce multi-proof locks because they preserve their
		// power-of-2 denomination structure across the swap (a 100-sat
		// bid against 64+32+4 in the wallet yields 3 locked proofs).
		lockSecrets: z.array(z.string().min(1)).min(1, 'at least one lock_secret tag required'),
		proofYs: z.array(compressedPubkeyHex).min(1, 'at least one proof_y tag required'),
		// Optional DLEQ-proof tags. Empty for grandfathered pre-rollout bids;
		// required (one per proof) for post-rollout bids — presence is enforced
		// in the validation pipeline (ADR-0011 Decision 6/7), not here.
		dleqProofs: z.array(dleqProofSchema).default([] as Array<z.infer<typeof dleqProofSchema>>),
		createdForEndAt: unixSeconds,
		bidNonce: z.string().min(1, 'bid_nonce required'),
		keyScheme: z.literal(AUCTION_KEY_SCHEME, { message: `key_scheme must equal "${AUCTION_KEY_SCHEME}"` }),
		status: z.literal('locked', { message: 'status must be "locked" at publish time' }),
		prevBidId: nostrEventIdHex.optional(),
		note: z.string().optional(),
	})
	.refine((value) => value.lockSecrets.length === value.proofYs.length, {
		message: 'lock_secret and proof_y tags must be 1-to-1 paired (parallel arrays)',
		path: ['proofYs'],
	})
	.refine((value) => value.dleqProofs.length === 0 || value.dleqProofs.length === value.lockSecrets.length, {
		message: 'dleq_proof tags must be 1-to-1 paired with lock_secret/proof_y (parallel arrays)',
		path: ['dleqProofs'],
	})

export type BidEventInput = z.infer<typeof BidEventSchema>

// ----------------------------------------------------------------------------
// Raw event → ParsedBidEvent
// ----------------------------------------------------------------------------

export type ParseBidEventResult = { ok: true; value: ParsedBidEvent } | { ok: false; error: z.ZodError | { message: string; code: string } }

export const parseBidEvent = (event: NostrEventLike): ParseBidEventResult => {
	if (event.kind !== AUCTION_BID_KIND) {
		return { ok: false, error: { code: 'wrong_kind', message: `expected kind ${AUCTION_BID_KIND}, got ${event.kind}` } }
	}

	// Forbidden tags from the v1 oracle scheme — refuse anything carrying
	// the path or oracle-binding fields outright. §4.2 / §9.8.
	for (const forbidden of ['derivation_path', 'path_issuer', 'path_grant_id', 'commitment'] as const) {
		if (readSingleTag(event, forbidden) !== undefined) {
			return {
				ok: false,
				error: {
					code: 'forbidden_tag',
					message: `bid event must not carry the legacy/early-reveal tag "${forbidden}"`,
				},
			}
		}
	}

	// Parse dleq_proof tags: one JSON-encoded proof per tag (ADR-0011
	// Decision 1). Malformed JSON fails closed at parse rather than silently
	// dropping the collateral (Decision 4); a well-formed-but-wrong-shape
	// proof is rejected by `dleqProofSchema` below.
	let dleqProofs: unknown[]
	try {
		dleqProofs = readMultiTag(event, 'dleq_proof').map((raw) => JSON.parse(raw) as unknown)
	} catch {
		return { ok: false, error: { code: 'malformed_dleq_proof', message: 'dleq_proof tag must be valid JSON' } }
	}

	const intermediate = {
		id: event.id,
		bidderPubkey: event.pubkey,
		createdAt: event.created_at ?? 0,
		auctionRootEventId: readSingleTag(event, 'e') ?? '',
		auctionCoordinate: readSingleTag(event, 'a') ?? '',
		sellerPubkey: readSingleTag(event, 'p') ?? '',
		amount: parseIntegerOrZero(readSingleTag(event, 'amount')),
		legLockedAmount: parseIntegerOrZero(readSingleTag(event, 'amount')),
		currency: readSingleTag(event, 'currency') ?? '',
		mint: readSingleTag(event, 'mint') ?? '',
		locktime: parseIntegerOrZero(readSingleTag(event, 'locktime')),
		refundPubkey: readSingleTag(event, 'refund_pubkey') ?? '',
		childPubkey: readSingleTag(event, 'child_pubkey') ?? '',
		lockSecrets: readMultiTag(event, 'lock_secret'),
		proofYs: readMultiTag(event, 'proof_y'),
		dleqProofs,
		createdForEndAt: parseIntegerOrZero(readSingleTag(event, 'created_for_end_at')),
		bidNonce: readSingleTag(event, 'bid_nonce') ?? '',
		keyScheme: readSingleTag(event, 'key_scheme') ?? '',
		status: readSingleTag(event, 'status') ?? '',
		prevBidId: readSingleTag(event, 'prev_bid'),
		note: readSingleTag(event, 'note'),
	}

	const parsed = BidEventSchema.safeParse(intermediate)
	if (!parsed.success) return { ok: false, error: parsed.error }

	return {
		ok: true,
		value: {
			rawEvent: event,
			...parsed.data,
		} as ParsedBidEvent,
	}
}

// Same grammar as `parseAuctionNonNegativeInt`: a non-canonical value like
// "100abc" must not be truncated to 100, since `amount` drives bid ranking.
const parseIntegerOrZero = (raw: string | undefined): number => {
	const text = raw?.trim() ?? ''
	if (!/^\d+$/.test(text)) return 0

	const parsed = Number(text)
	return Number.isSafeInteger(parsed) ? parsed : 0
}
