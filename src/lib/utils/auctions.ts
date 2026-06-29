import { getAuctionCategories, getAuctionBiddingCutoffAt, getAuctionStartingBid, getAuctionTitle } from '@/queries/auctions'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
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
	auctions: NDKEvent[]
	bidsByAuctionId?: Map<string, NDKEvent[]>
	filters: AuctionFilterState
	tag: string | undefined
}

export const defaultAuctionFilters: AuctionFilterState = {
	hideEnded: false,
	sort: 'newest',
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
				sorted.sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
				break

			case 'ending-soon':
				sorted.sort((a, b) => {
					const aEnd = getAuctionBiddingCutoffAt(a)
					const bEnd = getAuctionBiddingCutoffAt(b)

					const aEnded = aEnd > 0 && aEnd <= now
					const bEnded = bEnd > 0 && bEnd <= now

					if (aEnded !== bEnded) return aEnded ? 1 : -1
					return aEnd - bEnd
				})
				break

			case 'highest-starting-bid':
				sorted.sort((a, b) => getAuctionStartingBid(b) - getAuctionStartingBid(a))
				break

			case 'title-a-z':
				sorted.sort((a, b) => getAuctionTitle(a).localeCompare(getAuctionTitle(b)))
				break

			case 'title-z-a':
				sorted.sort((a, b) => getAuctionTitle(b).localeCompare(getAuctionTitle(a)))
				break

			case 'newest':
			default:
				sorted.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
				break
		}

		return sorted
	}, [auctions, filters, tag])
}
