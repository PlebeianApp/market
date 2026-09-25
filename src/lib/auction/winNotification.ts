import type { NostrEventLike } from '@/lib/nostr/eventLike'
import { toRawEvent } from '@/lib/nostr/eventLike'
import { parseSettlementEvent } from '@/lib/schemas/auction/settlementEvents'
import { computeValidatedBids, type ValidatedBidSet } from '@/lib/auction/bidValidation'
import type { Nut7ProofState } from '@/lib/auction/constants'
import type { ParsedAuctionEvent, ParsedBidEvent, ParsedPathReleaseEvent, ParsedValidatorVerdictEvent } from '@/lib/auction/events'
import { fetchMintKeysets, validatePathRelease } from '@/lib/auction/validation'
import { fetchDleqKeysetsForBidsDetailed } from '@/lib/cashu/dleq'
import type { MintKeys, MintKeyset } from '@cashu/cashu-ts'
import { fetchBidNut7States } from './useNut7Polling'
import { parseAuctionEvent } from '@/lib/schemas/auction/auctionEvent'
import { parseBidEvent } from '@/lib/schemas/auction/bidEvent'
import { parsePathReleaseEvent } from '@/lib/schemas/auction/settlementEvents'
import { parseValidatorVerdictEvent } from '@/lib/schemas/auction/validatorEvents'

export interface QueuedAuctionWin {
	auctionRootEventId: string
	bidEventId: string
}

export const shouldUseNonBlockingAuctionWinPrompt = (pathname: string): boolean =>
	/^\/auctions\/[^/]+\/?$/.test(pathname) ||
	/^\/dashboard\/products\/auctions\/[^/]+\/?$/.test(pathname) ||
	/^\/dashboard\/orders\/[^/]+\/?$/.test(pathname)

export const selectValidatedAuctionWinner = (
	auction: ParsedAuctionEvent,
	bids: ParsedBidEvent[],
	verdicts: ParsedValidatorVerdictEvent[],
	nut7States: Map<string, Nut7ProofState>,
	dleqKeysets?: Map<string, MintKeys>,
	dleqUnknownKeysets?: ReadonlySet<string>,
): ParsedBidEvent | null => getValidatedAuctionBids(auction, bids, verdicts, nut7States, dleqKeysets, dleqUnknownKeysets).canonicalWinner

export const getValidatedAuctionBids = (
	auction: ParsedAuctionEvent,
	bids: ParsedBidEvent[],
	verdicts: ParsedValidatorVerdictEvent[],
	nut7States: Map<string, Nut7ProofState>,
	/**
	 * DLEQ keysets (keyed `${mint}:${keysetId}`) for the unconditional DLEQ
	 * crypto check. Without them every DLEQ-bearing bid is `pending`
	 * (`dleq_evidence_unavailable`) and no canonical winner can be derived.
	 */
	dleqKeysets?: Map<string, MintKeys>,
	/** Terminal keyset misses (ADR-0011 review R3) — threaded to computeValidatedBids. */
	dleqUnknownKeysets?: ReadonlySet<string>,
): ValidatedBidSet => computeValidatedBids({ auction, bids, verdicts, nut7States, dleqKeysets, dleqUnknownKeysets, postSettlement: false })

export interface AuctionWinResolution {
	canonicalWinner: ParsedBidEvent | null
	isActiveWinner: boolean
	hasReleasedPath: boolean
}

export const resolveAuctionWinFromEvents = async (
	win: QueuedAuctionWin,
	auctionEvent: NostrEventLike,
	bidEvents: NostrEventLike[],
	verdictEvents: NostrEventLike[],
	pathReleaseEvents: NostrEventLike[],
	now: number,
): Promise<AuctionWinResolution> => {
	const parsedAuctionResult = parseAuctionEvent(toRawEvent(auctionEvent))
	if (!parsedAuctionResult.ok) return { canonicalWinner: null, isActiveWinner: false, hasReleasedPath: false }
	const auction = parsedAuctionResult.value
	const parsedBids = bidEvents
		.map((event) => parseBidEvent(toRawEvent(event)))
		.filter((result): result is { ok: true; value: ParsedBidEvent } => result.ok)
		.map((result) => result.value)
	const parsedVerdicts = verdictEvents
		.map((event) => parseValidatorVerdictEvent(toRawEvent(event)))
		.filter((result): result is { ok: true; value: ParsedValidatorVerdictEvent } => result.ok)
		.map((result) => result.value)
	const parsedPathReleases = pathReleaseEvents
		.map((event) => parsePathReleaseEvent(toRawEvent(event)))
		.filter((result): result is { ok: true; value: ParsedPathReleaseEvent } => result.ok)
		.map((result) => result.value)
	const nut7States = await fetchBidNut7States(parsedBids, auction.mints)
	// DLEQ is unconditional: gather the keysets needed to crypto-verify the
	// bids before deriving a winner, otherwise every bid is pending.
	const dleqAcquisition = await fetchDleqKeysetsForBidsDetailed(parsedBids, auction.mints)
	return resolveAuctionWin(
		win,
		auction,
		parsedBids,
		parsedVerdicts,
		parsedPathReleases,
		nut7States,
		now,
		undefined,
		dleqAcquisition.keysets,
		dleqAcquisition.unknownKeysets,
	)
}

export async function resolveAuctionWin(
	win: QueuedAuctionWin,
	auction: ParsedAuctionEvent,
	bids: ParsedBidEvent[],
	verdicts: ParsedValidatorVerdictEvent[],
	pathReleases: ParsedPathReleaseEvent[],
	nut7States: Map<string, Nut7ProofState>,
	now: number,
	mintKeysetsByMint?: Map<string, MintKeyset[]>,
	/** DLEQ keysets (keyed `${mint}:${keysetId}`) for the unconditional DLEQ check. */
	dleqKeysets?: Map<string, MintKeys>,
	/** Terminal keyset misses (ADR-0011 review R3) — threaded to computeValidatedBids. */
	dleqUnknownKeysets?: ReadonlySet<string>,
): Promise<AuctionWinResolution> {
	const validatedBids = getValidatedAuctionBids(auction, bids, verdicts, nut7States, dleqKeysets, dleqUnknownKeysets)
	const canonicalWinner = validatedBids.canonicalWinner
	const isActiveWinner = canonicalWinner?.id === win.bidEventId
	const hasReleasedPath = isActiveWinner
		? await hasValidatedPathReleaseForAuctionWin(win, auction, validatedBids, pathReleases, now, mintKeysetsByMint)
		: false

	return { canonicalWinner, isActiveWinner, hasReleasedPath }
}

export async function hasValidatedPathReleaseForAuctionWin(
	win: QueuedAuctionWin,
	auction: ParsedAuctionEvent,
	validatedBids: ValidatedBidSet,
	pathReleases: ParsedPathReleaseEvent[],
	now: number,
	mintKeysetsByMint?: Map<string, MintKeyset[]>,
): Promise<boolean> {
	const winner = validatedBids.canonicalWinner
	if (!winner || winner.id !== win.bidEventId) return false

	const trustedChain = validatedBids.trustedCollateralChains?.get(winner.id)
	if (!trustedChain?.length) return false

	for (const leg of trustedChain) {
		const bid = leg.bid
		const matchingReleases = pathReleases.filter((release) => release.bidEventId === bid.id)
		if (matchingReleases.length === 0) return false
		const keysets = mintKeysetsByMint?.get(bid.mint) ?? (await fetchMintKeysets(bid.mint))
		const hasValidRelease = matchingReleases.some(
			(release) =>
				validatePathRelease({
					auction,
					bid,
					release,
					now,
					postCloseDecision: 'winner',
					mintKeysets: keysets,
					expectedTokenAmount: leg.expectedAmount,
				}).isValid,
		)
		if (!hasValidRelease) return false
	}

	return true
}

export const hasFinalSettlementForAuctionWin = (
	win: Pick<QueuedAuctionWin, 'auctionRootEventId'>,
	auction: NostrEventLike,
	auctionCoordinate: string,
	settlements: NostrEventLike[],
): boolean =>
	settlements.some((event) => {
		const parsed = parseSettlementEvent(toRawEvent(event))
		return (
			parsed.ok &&
			parsed.value.status === 'settled' &&
			parsed.value.sellerPubkey === auction.pubkey &&
			parsed.value.auctionRootEventId === win.auctionRootEventId &&
			parsed.value.auctionCoordinate === auctionCoordinate
		)
	})
