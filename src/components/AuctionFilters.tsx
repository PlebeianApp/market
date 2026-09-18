import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
	auctionSortOptionValues,
	calculateAppliedFilterCount,
	defaultAuctionFilters,
	getAuctionSortOptionTitle,
	type AuctionFilterState,
	type AuctionSortOption,
} from '@/lib/utils/auctions'
import { Filter, SortAsc } from 'lucide-react'

interface AuctionFiltersProps {
	filters: AuctionFilterState
	onFiltersChange: (filters: AuctionFilterState) => void
	className?: string
}

export function AuctionFilters({ filters, onFiltersChange, className }: AuctionFiltersProps) {
	const appliedFilterCount = calculateAppliedFilterCount(filters)
	const hasEnabledHideEnded = filters.hideEnded ?? defaultAuctionFilters.hideEnded
	const sort = filters.sort ?? defaultAuctionFilters.sort

	const toggleFilterHideEnded = () => {
		onFiltersChange({ ...filters, hideEnded: !hasEnabledHideEnded })
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
						{appliedFilterCount > 0 && (
							<span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
								{appliedFilterCount}
							</span>
						)}
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-72" align="end">
					<div className="space-y-4">
						<div className="font-medium text-sm">Filters</div>

						<div className="space-y-3">
							<div className="flex items-center space-x-2">
								<Checkbox id="hideEndedAuctions" checked={hasEnabledHideEnded} onCheckedChange={toggleFilterHideEnded} />
								<Label htmlFor="hideEndedAuctions" className="text-sm font-normal cursor-pointer">
									Hide ended auctions
								</Label>
							</div>
						</div>

						<div className="border-t pt-4">
							<div className="font-medium text-sm mb-2 flex items-center gap-2">
								<SortAsc className="w-4 h-4" />
								Sort by
							</div>
							<Select value={sort} onValueChange={handleSortChange}>
								<SelectTrigger className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{auctionSortOptionValues.map((value) => (
										<SelectItem key={value} value={value}>
											{getAuctionSortOptionTitle(value)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						{appliedFilterCount > 0 && (
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
