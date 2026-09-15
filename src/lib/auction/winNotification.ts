import type { NostrEventLike } from '@/lib/nostr/eventLike'
import { toRawEvent } from '@/lib/nostr/eventLike'
import { parseSettlementEvent } from '@/lib/schemas/auction/settlementEvents'
import { computeValidatedBids, type ValidatedBidSet } from '@/lib/auction/bidValidation'
import type { Nut7ProofState } from '@/lib/auction/constants'
import type { ParsedAuctionEvent, ParsedBidEvent, ParsedPathReleaseEvent, ParsedValidatorVerdictEvent } from '@/lib/auction/events'
import { fetchMintKeysets, validatePathRelease } from '@/lib/auction/validation'
import type { MintKeyset } from '@cashu/cashu-ts'

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
): ParsedBidEvent | null => getValidatedAuctionBids(auction, bids, verdicts, nut7States).canonicalWinner

export const getValidatedAuctionBids = (
	auction: ParsedAuctionEvent,
	bids: ParsedBidEvent[],
	verdicts: ParsedValidatorVerdictEvent[],
	nut7States: Map<string, Nut7ProofState>,
): ValidatedBidSet => computeValidatedBids({ auction, bids, verdicts, nut7States, postSettlement: false })

export interface AuctionWinResolution {
	canonicalWinner: ParsedBidEvent | null
	isActiveWinner: boolean
	hasReleasedPath: boolean
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
): Promise<AuctionWinResolution> {
	const validatedBids = getValidatedAuctionBids(auction, bids, verdicts, nut7States)
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

	const chain: ParsedBidEvent[] = []
	const seen = new Set<string>()
	let current: ParsedBidEvent | undefined = winner
	while (current && !seen.has(current.id)) {
		seen.add(current.id)
		chain.unshift(current)
		if (!current.prevBidId) break
		current = validatedBids.validBids.find((bid) => bid.id === current?.prevBidId)
		if (!current) return false
	}

	for (const bid of chain) {
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
				}).isValid,
		)
		if (!hasValidRelease) return false
	}

	return chain.length > 0
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
			parsed.value.sellerPubkey === auction.pubkey &&
			parsed.value.auctionRootEventId === win.auctionRootEventId &&
			parsed.value.auctionCoordinate === auctionCoordinate
		)
	})
