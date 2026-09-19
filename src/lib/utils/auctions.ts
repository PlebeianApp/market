import { getAuctionCategories, getAuctionBiddingCutoffAt, getAuctionStartingBid, getAuctionTitle } from '@/queries/auctions'
import type { NostrEventLike } from '@/lib/nostr/eventLike'
import { useMemo } from 'react'

export type AuctionSortOption = 'newest' | 'oldest' | 'ending-soon' | 'highest-starting-bid' | 'title-a-z' | 'title-z-a'

export const auctionSortOptionValues: AuctionSortOption[] = [
	'ending-soon',
	'newest',
	'oldest',
	'highest-starting-bid',
	'title-a-z',
	'title-z-a',
]

export const getAuctionSortOptionTitle = (value: AuctionSortOption): string => {
	switch (value) {
		case 'ending-soon':
			return 'Ending Soon'
		case 'newest':
			return 'Newest First'
		case 'oldest':
			return 'Oldest First'
		case 'highest-starting-bid':
			return 'Highest Starting Bid'
		case 'title-a-z':
			return 'Alphabetical'
		case 'title-z-a':
			return 'Alphabetical - Reverse'
	}
}

export interface AuctionFilterState {
	hideEnded?: boolean
	sort?: AuctionSortOption
}

export interface UseFilteredAuctionsProps {
	auctions: NostrEventLike[]
	bidsByAuctionId?: Map<string, NostrEventLike[]>
	filters: AuctionFilterState
	tag: string | undefined
}

export const defaultAuctionFilters: AuctionFilterState = {
	hideEnded: false,
	sort: 'ending-soon',
}

/**
 * Calculates how many filter criteria are currently active compared to defaults.
 *
 * @param filters - The current filter state
 * @returns The number of active filters
 */
export function calculateAppliedFilterCount(filters: AuctionFilterState): number {
	let count = 0

	// 1. Hide Ended Filter
	// Since default is false, this checks if the user explicitly enabled it.
	const isHideEndedActive = filters.hideEnded ?? defaultAuctionFilters.hideEnded
	if (isHideEndedActive) count++

	// 2. Sort Filter
	const currentSort = filters.sort ?? defaultAuctionFilters.sort
	if (currentSort !== defaultAuctionFilters.sort) count++

	return count
}

// ---------------------------------------------------------------------------
// Sort comparators — pure, exported, unit-tested
// ---------------------------------------------------------------------------

export const compareAuctionsNewestFirst = (a: NostrEventLike, b: NostrEventLike): number => (b.created_at || 0) - (a.created_at || 0)

export const compareAuctionsOldestFirst = (a: NostrEventLike, b: NostrEventLike): number => (a.created_at || 0) - (b.created_at || 0)

export const compareAuctionsByStartingBidDesc = (a: NostrEventLike, b: NostrEventLike): number =>
	getAuctionStartingBid(b) - getAuctionStartingBid(a)

export const compareAuctionsByTitleAsc = (a: NostrEventLike, b: NostrEventLike): number =>
	getAuctionTitle(a).localeCompare(getAuctionTitle(b))

export const compareAuctionsByTitleDesc = (a: NostrEventLike, b: NostrEventLike): number =>
	getAuctionTitle(b).localeCompare(getAuctionTitle(a))

/**
 * Bucket a bidding cutoff for the "Ending Soon" sort.
 *
 * `getAuctionBiddingCutoffAt` returns `0` for "no usable close time", and `0`
 * used to be indistinguishable from a real timestamp in the comparison — which
 * is how a malformed event with a missing `end_at` became the *most* ending-soon
 * auction in the feed and held slot #1. The three buckets make the unknown case
 * explicit:
 *
 *   0 — live: a known cutoff still in the future (ordered soonest-first)
 *   1 — unknown: no usable cutoff, so it cannot be "ending soon"
 *   2 — ended
 *
 * Unknown sorts after live (it must never outrank a real auction) and before
 * ended (it is not known to be over).
 *
 * Two rules now stand between this comparator and a malformed card: the
 * admission gate keeps parser-rejected events out of the discovery surfaces
 * entirely, and the parser refuses a non-positive timing value outright
 * (maintainer ruling, 2026-09-19). The bucket is still the defence for the
 * surfaces that are deliberately ungated — the owner dashboard and its detail
 * page pass `includeInvalid`, and they sort by "Ending Soon" too, so an event
 * the parser accepts but whose cutoff cannot be read must not win there either.
 */
export const getAuctionEndingSoonRank = (cutoff: number, now: number): 0 | 1 | 2 => {
	if (cutoff <= 0) return 1
	return cutoff <= now ? 2 : 0
}

export const compareAuctionsEndingSoon = (a: NostrEventLike, b: NostrEventLike, now: number): number => {
	const aCutoff = getAuctionBiddingCutoffAt(a)
	const bCutoff = getAuctionBiddingCutoffAt(b)

	const rankDelta = getAuctionEndingSoonRank(aCutoff, now) - getAuctionEndingSoonRank(bCutoff, now)
	if (rankDelta !== 0) return rankDelta

	// Within a bucket: soonest first. Two unknowns both hold 0, so the delta is
	// 0 and their incoming order (the feed's `created_at desc`) is preserved.
	return aCutoff - bCutoff
}

export function useFilteredAuctions({ auctions, filters, tag }: UseFilteredAuctionsProps) {
	const hideEnded = filters.hideEnded ?? defaultAuctionFilters.hideEnded
	const sort = filters.sort ?? defaultAuctionFilters.sort

	return useMemo(() => {
		const now = Math.floor(Date.now() / 1000)
		let filtered = auctions

		// 1. Filter by URL Tag
		if (tag) {
			filtered = filtered.filter((auction) => getAuctionCategories(auction).includes(tag))
		}

		// 2. Filter by UI State (Hide Ended)
		if (hideEnded) {
			filtered = filtered.filter((auction) => {
				const visibleEndAt = getAuctionBiddingCutoffAt(auction)

				return visibleEndAt > 0 && visibleEndAt > now
			})
		}

		// 3. Sort
		const sorted = [...filtered]
		switch (sort) {
			case 'oldest':
				sorted.sort(compareAuctionsOldestFirst)
				break

			case 'ending-soon':
				sorted.sort((a, b) => compareAuctionsEndingSoon(a, b, now))
				break

			case 'highest-starting-bid':
				sorted.sort(compareAuctionsByStartingBidDesc)
				break

			case 'title-a-z':
				sorted.sort(compareAuctionsByTitleAsc)
				break

			case 'title-z-a':
				sorted.sort(compareAuctionsByTitleDesc)
				break

			case 'newest':
			default:
				sorted.sort(compareAuctionsNewestFirst)
				break
		}

		return sorted
	}, [auctions, filters, tag])
}
