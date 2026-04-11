import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { COUNTRIES_ISO } from '@/lib/constants'
import { Filter, Globe, SortAsc } from 'lucide-react'
import { useMemo } from 'react'

export type SortOption = 'newest' | 'oldest' | 'a-z' | 'z-a'

export interface ProductFilterState {
	showOutOfStock: boolean
	hidePreorder: boolean
	sort: SortOption
	country: string
}

interface ProductFiltersProps {
	filters: ProductFilterState
	onFiltersChange: (filters: ProductFilterState) => void
	className?: string
}

export const defaultProductFilters: ProductFilterState = {
	showOutOfStock: false,
	hidePreorder: false,
	sort: 'newest',
	country: '',
}

export function ProductFilters({ filters, onFiltersChange, className }: ProductFiltersProps) {
	const hasActiveFilters = filters.showOutOfStock || filters.hidePreorder || filters.sort !== 'newest' || filters.country !== ''

	const countryOptions = useMemo(
		() =>
			Object.entries(COUNTRIES_ISO)
				.map(([code, info]) => ({ code, name: info.name }))
				.sort((a, b) => a.name.localeCompare(b.name)),
		[],
	)

	const handleShowOutOfStockChange = (checked: boolean) => {
		onFiltersChange({ ...filters, showOutOfStock: checked })
	}

	const handleHidePreorderChange = (checked: boolean) => {
		onFiltersChange({ ...filters, hidePreorder: checked })
	}

	const handleCountryChange = (value: string) => {
		onFiltersChange({ ...filters, country: value === 'all' ? '' : value })
	}

	const handleSortChange = (value: SortOption) => {
		onFiltersChange({ ...filters, sort: value })
	}

	const handleReset = () => {
		onFiltersChange(defaultProductFilters)
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
								{(filters.showOutOfStock ? 1 : 0) +
									(filters.hidePreorder ? 1 : 0) +
									(filters.sort !== 'newest' ? 1 : 0) +
									(filters.country ? 1 : 0)}
							</span>
						)}
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-72" align="end">
					<div className="space-y-4">
						<div className="font-medium text-sm">Filters</div>

						<div className="space-y-3">
							<div className="flex items-center space-x-2">
								<Checkbox id="showOutOfStock" checked={filters.showOutOfStock} onCheckedChange={handleShowOutOfStockChange} />
								<Label htmlFor="showOutOfStock" className="text-sm font-normal cursor-pointer">
									Show out of stock
								</Label>
							</div>

							<div className="flex items-center space-x-2">
								<Checkbox id="hidePreorder" checked={filters.hidePreorder} onCheckedChange={handleHidePreorderChange} />
								<Label htmlFor="hidePreorder" className="text-sm font-normal cursor-pointer">
									Hide pre-order items
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
									<SelectItem value="newest">Newest first</SelectItem>
									<SelectItem value="oldest">Oldest first</SelectItem>
									<SelectItem value="a-z">Name (A-Z)</SelectItem>
									<SelectItem value="z-a">Name (Z-A)</SelectItem>
								</SelectContent>
							</Select>
						</div>

						<div className="border-t pt-4">
							<div className="font-medium text-sm mb-2 flex items-center gap-2">
								<Globe className="w-4 h-4" />
								Country
							</div>
							<Select value={filters.country || 'all'} onValueChange={handleCountryChange}>
								<SelectTrigger className="w-full">
									<SelectValue placeholder="All countries" />
								</SelectTrigger>
								<SelectContent className="max-h-60">
									<SelectItem value="all">All countries</SelectItem>
									{countryOptions.map((c) => (
										<SelectItem key={c.code} value={c.name}>
											{c.name}
										</SelectItem>
									))}
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
