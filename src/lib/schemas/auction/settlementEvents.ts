/**
 * Zod schemas + parsers for the two settlement-side events:
 *
 * - kind 1025 — `parsePathReleaseEvent` (bidder-signed path reveal,
 *   §4.3.1). Bidders publish this to signal "I won, here's the path
 *   so you can redeem" or "I'm honoring your fallback offer."
 *
 * - kind 1024 — `parseSettlementEvent` (seller-signed final record,
 *   §4.3.2). Records the on-mint outcome and any fallback cascade
 *   the seller went through.
 *
 * Both schemas validate event-internal shape only — cross-event
 * verifiability (e.g. "does derive(p2pk_xpub, path) actually equal
 * child_pubkey?") belongs to the validation pipeline, which has the
 * auction + bid events in hand.
 */

import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { z } from 'zod'
import {
	AUCTION_PATH_RELEASE_KIND,
	AUCTION_SETTLEMENT_KIND,
	type AuctionSettlementStatus,
	type PathReleaseReason,
} from '../../auction/constants'
import type { AuctionFallbackChainEntry, ParsedPathReleaseEvent, ParsedSettlementEvent } from '../../auction/events'
import { addressableCoordinate, bip32Path, compressedPubkeyHex, nostrEventIdHex, nostrPubkeyHex, nonNegativeInt, unixSeconds } from './common'
import { readMultiTag, readMultiTagTuples, readSingleTag } from './tagAccess'

// =========================================================================
// kind 1025 — Path release
// =========================================================================

const pathReleaseReasonSchema = z.enum(['settlement', 'fallback_settlement', 'voluntary_late'], {
	message: 'release_reason must be settlement | fallback_settlement | voluntary_late',
}) satisfies z.ZodType<PathReleaseReason>

export const PathReleaseEventSchema = z.object({
	id: nostrEventIdHex,
	bidderPubkey: nostrPubkeyHex,
	createdAt: unixSeconds,
	bidEventId: nostrEventIdHex,
	auctionCoordinate: addressableCoordinate,
	sellerPubkey: nostrPubkeyHex,
	derivationPath: bip32Path,
	childPubkey: compressedPubkeyHex,
	releaseReason: pathReleaseReasonSchema,
	auditorRefs: z.array(nostrEventIdHex).default([]),
	fallbackOfferId: nostrEventIdHex.optional(),
	content: z.string().default(''),
})

export type PathReleaseEventInput = z.infer<typeof PathReleaseEventSchema>

export type ParsePathReleaseEventResult =
	| { ok: true; value: ParsedPathReleaseEvent }
	| { ok: false; error: z.ZodError | { message: string; code: string } }

export const parsePathReleaseEvent = (event: NDKEvent): ParsePathReleaseEventResult => {
	if (event.kind !== AUCTION_PATH_RELEASE_KIND) {
		return {
			ok: false,
			error: { code: 'wrong_kind', message: `expected kind ${AUCTION_PATH_RELEASE_KIND}, got ${event.kind}` },
		}
	}

	const intermediate = {
		id: event.id,
		bidderPubkey: event.pubkey,
		createdAt: event.created_at ?? 0,
		bidEventId: readSingleTag(event, 'e') ?? '',
		auctionCoordinate: readSingleTag(event, 'a') ?? '',
		sellerPubkey: readSingleTag(event, 'p') ?? '',
		derivationPath: readSingleTag(event, 'derivation_path') ?? '',
		childPubkey: readSingleTag(event, 'child_pubkey') ?? '',
		releaseReason: (readSingleTag(event, 'release_reason') ?? '') as PathReleaseReason,
		auditorRefs: readMultiTag(event, 'auditor_ref'),
		fallbackOfferId: readSingleTag(event, 'fallback_offer'),
		content: event.content ?? '',
	}

	const parsed = PathReleaseEventSchema.safeParse(intermediate)
	if (!parsed.success) return { ok: false, error: parsed.error }

	return {
		ok: true,
		value: { rawEvent: event, ...parsed.data } as ParsedPathReleaseEvent,
	}
}

// =========================================================================
// kind 1024 — Settlement
// =========================================================================

const settlementStatusSchema = z.enum(['settled', 'reserve_not_met', 'cancelled', 'griefed_no_fallback'], {
	message: 'status must be settled | reserve_not_met | cancelled | griefed_no_fallback',
}) satisfies z.ZodType<AuctionSettlementStatus>

const fallbackChainEntryStatusSchema = z.enum(['griefed', 'declined', 'accepted', 'refunded_at_locktime'])

export const SettlementEventSchema = z
	.object({
		id: nostrEventIdHex,
		sellerPubkey: nostrPubkeyHex,
		createdAt: unixSeconds,
		auctionRootEventId: nostrEventIdHex,
		auctionCoordinate: addressableCoordinate,
		status: settlementStatusSchema,
		closeAt: unixSeconds,
		winningBidId: nostrEventIdHex.optional(),
		winnerPubkey: nostrPubkeyHex.optional(),
		finalAmount: nonNegativeInt,
		pathReleaseEventId: nostrEventIdHex.optional(),
		fallbackChain: z.array(
			z.object({
				bidEventId: nostrEventIdHex,
				status: fallbackChainEntryStatusSchema,
			}) satisfies z.ZodType<AuctionFallbackChainEntry>,
		),
		reason: z.string().optional(),
	})
	.refine(
		(value) => {
			// status=settled requires winningBidId + winnerPubkey + finalAmount > 0 + pathReleaseEventId
			if (value.status !== 'settled') return true
			return Boolean(value.winningBidId && value.winnerPubkey && value.finalAmount > 0 && value.pathReleaseEventId)
		},
		{ message: 'status=settled requires winning_bid, winner, final_amount>0, and path_release tags' },
	)

export type SettlementEventInput = z.infer<typeof SettlementEventSchema>

export type ParseSettlementEventResult =
	| { ok: true; value: ParsedSettlementEvent }
	| { ok: false; error: z.ZodError | { message: string; code: string } }

export const parseSettlementEvent = (event: NDKEvent): ParseSettlementEventResult => {
	if (event.kind !== AUCTION_SETTLEMENT_KIND) {
		return {
			ok: false,
			error: { code: 'wrong_kind', message: `expected kind ${AUCTION_SETTLEMENT_KIND}, got ${event.kind}` },
		}
	}

	const fallbackChain: AuctionFallbackChainEntry[] = readMultiTagTuples(event, 'fallback_chain')
		.map((tuple): AuctionFallbackChainEntry | null => {
			const bidEventId = tuple[1] ?? ''
			const status = tuple[2] ?? ''
			const allowed = ['griefed', 'declined', 'accepted', 'refunded_at_locktime']
			if (!bidEventId || !allowed.includes(status)) return null
			return { bidEventId, status: status as AuctionFallbackChainEntry['status'] }
		})
		.filter((entry): entry is AuctionFallbackChainEntry => entry !== null)

	const intermediate = {
		id: event.id,
		sellerPubkey: event.pubkey,
		createdAt: event.created_at ?? 0,
		auctionRootEventId: readSingleTag(event, 'e') ?? '',
		auctionCoordinate: readSingleTag(event, 'a') ?? '',
		status: (readSingleTag(event, 'status') ?? '') as AuctionSettlementStatus,
		closeAt: Number.parseInt(readSingleTag(event, 'close_at') ?? '0', 10) || 0,
		winningBidId: readSingleTag(event, 'winning_bid'),
		winnerPubkey: readSingleTag(event, 'winner'),
		finalAmount: Number.parseInt(readSingleTag(event, 'final_amount') ?? '0', 10) || 0,
		pathReleaseEventId: readSingleTag(event, 'path_release'),
		fallbackChain,
		reason: readSingleTag(event, 'reason'),
	}

	const parsed = SettlementEventSchema.safeParse(intermediate)
	if (!parsed.success) return { ok: false, error: parsed.error }

	return {
		ok: true,
		value: { rawEvent: event, ...parsed.data } as ParsedSettlementEvent,
	}
}
