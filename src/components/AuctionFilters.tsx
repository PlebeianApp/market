import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Filter, SortAsc } from 'lucide-react'

export type AuctionSortOption = 'newest' | 'oldest' | 'ending-soon' | 'highest-starting-bid' | 'title-a-z'

export interface AuctionFilterState {
	showEnded: boolean
	sort: AuctionSortOption
}

interface AuctionFiltersProps {
	filters: AuctionFilterState
	onFiltersChange: (filters: AuctionFilterState) => void
	className?: string
}

export const defaultAuctionFilters: AuctionFilterState = {
	showEnded: true,
	sort: 'ending-soon',
}

export function AuctionFilters({ filters, onFiltersChange, className }: AuctionFiltersProps) {
	const hasFilterHideEnded = filters.showEnded === defaultAuctionFilters.showEnded
	const hasFilterSortLatest = filters.sort === defaultAuctionFilters.sort
	const hasActiveFilters = hasFilterHideEnded || hasFilterSortLatest

	const handleShowEndedChange = (checked: boolean) => {
		onFiltersChange({ ...filters, showEnded: checked })
	}

	const handleSortChange = (value: AuctionSortOption) => {
		onFiltersChange({ ...filters, sort: value })
	}

	const handleReset = () => {
		onFiltersChange(defaultAuctionFilters)
	}

	return (
		<div className={className}>
			<Popover>
				<PopoverTrigger asChild>
					<Button variant="outline" size="sm" className="gap-2">
						<Filter className="w-4 h-4" />
						<span>Filter & Sort</span>
						{hasActiveFilters && (
							<span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
								{(hasFilterHideEnded ? 1 : 0) + (hasFilterSortLatest ? 1 : 0)}
							</span>
						)}
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-72" align="end">
					<div className="space-y-4">
						<div className="font-medium text-sm">Filters</div>

						<div className="space-y-3">
							<div className="flex items-center space-x-2">
								<Checkbox
									id="showEndedAuctions"
									checked={hasFilterHideEnded}
									onCheckedChange={() => handleShowEndedChange(hasFilterHideEnded)}
								/>
								<Label htmlFor="showEndedAuctions" className="text-sm font-normal cursor-pointer">
									Hide ended auctions
								</Label>
							</div>
						</div>

						<div className="border-t pt-4">
							<div className="font-medium text-sm mb-2 flex items-center gap-2">
								<SortAsc className="w-4 h-4" />
								Sort by
							</div>
							<Select value={filters.sort} onValueChange={handleSortChange}>
								<SelectTrigger className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="ending-soon">Ending soon</SelectItem>
									<SelectItem value="newest">Newest first</SelectItem>
									<SelectItem value="highest-starting-bid">Highest starting bid</SelectItem>
									<SelectItem value="title-a-z">Title (A-Z)</SelectItem>
									<SelectItem value="oldest">Oldest first</SelectItem>
								</SelectContent>
							</Select>
						</div>

						{hasActiveFilters && (
							<div className="border-t pt-4">
								<Button variant="ghost" size="sm" onClick={handleReset} className="w-full">
									Reset filters
								</Button>
							</div>
						)}
					</div>
				</PopoverContent>
			</Popover>
		</div>
	)
}
