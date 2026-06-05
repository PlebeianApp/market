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

import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { z } from 'zod'
import { AUCTION_BID_KIND, AUCTION_KEY_SCHEME } from '../../auction/constants'
import type { ParsedBidEvent } from '../../auction/events'
import { addressableCoordinate, compressedPubkeyHex, nostrEventIdHex, nostrPubkeyHex, positiveInt, unixSeconds } from './common'
import { readSingleTag } from './tagAccess'

// ----------------------------------------------------------------------------
// Intermediate Zod schema
// ----------------------------------------------------------------------------

export const BidEventSchema = z.object({
	id: nostrEventIdHex,
	bidderPubkey: nostrPubkeyHex,
	createdAt: unixSeconds,
	auctionRootEventId: nostrEventIdHex,
	auctionCoordinate: addressableCoordinate,
	sellerPubkey: nostrPubkeyHex,
	amount: positiveInt,
	currency: z.literal('SAT', { message: 'currency must be SAT' }),
	mint: z.string().url({ message: 'mint must be a URL' }),
	locktime: positiveInt,
	refundPubkey: compressedPubkeyHex,
	childPubkey: compressedPubkeyHex,
	lockSecret: z.string().min(1, 'lock_secret required'),
	proofY: compressedPubkeyHex,
	createdForEndAt: unixSeconds,
	bidNonce: z.string().min(1, 'bid_nonce required'),
	keyScheme: z.literal(AUCTION_KEY_SCHEME, { message: `key_scheme must equal "${AUCTION_KEY_SCHEME}"` }),
	status: z.literal('locked', { message: 'status must be "locked" at publish time' }),
	prevBidId: nostrEventIdHex.optional(),
	note: z.string().optional(),
})

export type BidEventInput = z.infer<typeof BidEventSchema>

// ----------------------------------------------------------------------------
// NDKEvent → ParsedBidEvent
// ----------------------------------------------------------------------------

export type ParseBidEventResult = { ok: true; value: ParsedBidEvent } | { ok: false; error: z.ZodError | { message: string; code: string } }

export const parseBidEvent = (event: NDKEvent): ParseBidEventResult => {
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

	const intermediate = {
		id: event.id,
		bidderPubkey: event.pubkey,
		createdAt: event.created_at ?? 0,
		auctionRootEventId: readSingleTag(event, 'e') ?? '',
		auctionCoordinate: readSingleTag(event, 'a') ?? '',
		sellerPubkey: readSingleTag(event, 'p') ?? '',
		amount: parseIntegerOrZero(readSingleTag(event, 'amount')),
		currency: readSingleTag(event, 'currency') ?? '',
		mint: readSingleTag(event, 'mint') ?? '',
		locktime: parseIntegerOrZero(readSingleTag(event, 'locktime')),
		refundPubkey: readSingleTag(event, 'refund_pubkey') ?? '',
		childPubkey: readSingleTag(event, 'child_pubkey') ?? '',
		lockSecret: readSingleTag(event, 'lock_secret') ?? '',
		proofY: readSingleTag(event, 'proof_y') ?? '',
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

const parseIntegerOrZero = (raw: string | undefined): number => {
	if (raw === undefined) return 0
	const n = Number.parseInt(raw, 10)
	return Number.isFinite(n) ? n : 0
}
