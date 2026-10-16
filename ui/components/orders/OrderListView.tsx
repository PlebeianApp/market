import type { ReactNode } from 'react'
import { ArrowDownNarrowWide, ArrowUpNarrowWide, CheckCircle, Circle, Clock, Filter, Loader, Loader2, XCircle } from 'lucide-react'
import { Card } from '../../primitives/card'
import { Input } from '../../primitives/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../primitives/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../primitives/tooltip'

export interface OrderListCell {
	id: string
	/** Label used in the stacked mobile layout. */
	label: string
	content: ReactNode
}

export interface OrderListRow {
	id: string
	onOpen: () => void
	isSelected?: boolean
	/** All cells in column order, for the desktop grid. */
	cells: readonly OrderListCell[]
	/** Mobile header cells; remaining cells are stacked below. */
	primaryCellId: string
	actionsCellId: string
}

interface SelectControl {
	value: string
	onChange: (value: string) => void
}

export interface OrderListViewProps {
	heading?: ReactNode
	search?: { value: string; onChange: (value: string) => void }
	orderBy?: SelectControl
	statusFilter?: SelectControl
	/** Collapse the selects to icon triggers. */
	isCompact: boolean
	isLoading: boolean
	rows: readonly OrderListRow[]
	emptyMessage: string
}

const ORDER_BY_OPTIONS = [
	{ value: 'newest', label: 'Newest First', icon: <ArrowDownNarrowWide className="h-4 w-4" /> },
	{ value: 'oldest', label: 'Oldest First', icon: <ArrowUpNarrowWide className="h-4 w-4" /> },
	{ value: 'recently-updated', label: 'Recently Updated', icon: <ArrowDownNarrowWide className="h-4 w-4" /> },
	{ value: 'least-updated', label: 'Least Recently Updated', icon: <ArrowUpNarrowWide className="h-4 w-4" /> },
]

const STATUS_OPTIONS = [
	{ value: 'any', label: 'Any Status', icon: <Filter className="h-4 w-4" /> },
	{ value: 'pending', label: 'Pending', icon: <Clock className="h-4 w-4" /> },
	{ value: 'confirmed', label: 'Confirmed', icon: <CheckCircle className="h-4 w-4" /> },
	{ value: 'processing', label: 'Processing', icon: <Loader className="h-4 w-4" /> },
	{ value: 'completed', label: 'Completed', icon: <Circle className="h-4 w-4 fill-current" /> },
	{ value: 'cancelled', label: 'Cancelled', icon: <XCircle className="h-4 w-4" /> },
]

function OptionSelect({
	control,
	options,
	placeholder,
	isCompact,
}: {
	control: SelectControl
	options: typeof ORDER_BY_OPTIONS
	placeholder: string
	isCompact: boolean
}) {
	const current = options.find((option) => option.value === control.value) ?? options[0]
	return (
		<div className="w-auto">
			<Select value={control.value} onValueChange={control.onChange}>
				{isCompact ? (
					<Tooltip>
						<TooltipTrigger asChild>
							<SelectTrigger className="w-10 px-0 justify-center">{current.icon}</SelectTrigger>
						</TooltipTrigger>
						<TooltipContent side="bottom">{current.label}</TooltipContent>
					</Tooltip>
				) : (
					<SelectTrigger className="w-auto">
						<SelectValue placeholder={placeholder} />
					</SelectTrigger>
				)}
				<SelectContent>
					{options.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{option.icon}
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	)
}

export function OrderListView({ heading, search, orderBy, statusFilter, isCompact, isLoading, rows, emptyMessage }: OrderListViewProps) {
	return (
		<div className="flex h-full flex-col">
			<div className="sticky top-[12.75rem] lg:top-0 z-20 bg-white border-b py-4 px-4 xl:px-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 shadow-sm">
				{heading && <div className="hidden lg:block flex-1">{heading}</div>}

				<div className="flex flex-row justify-end items-center gap-2 sm:gap-4 w-full lg:w-auto">
					{search && (
						<Input
							placeholder="Search by Order ID or Buyer..."
							value={search.value}
							onChange={(e) => search.onChange(e.target.value)}
							className="w-full sm:max-w-xs"
						/>
					)}
					{orderBy && <OptionSelect control={orderBy} options={ORDER_BY_OPTIONS} placeholder="Order By" isCompact={isCompact} />}
					{statusFilter && <OptionSelect control={statusFilter} options={STATUS_OPTIONS} placeholder="Any Status" isCompact={isCompact} />}
				</div>
			</div>

			<div className="flex-1 overflow-y-auto pb-4">
				{isLoading ? (
					<div className="flex justify-center items-center h-full mt-8">
						<Loader2 className="w-8 h-8 animate-spin text-primary" />
						<p className="ml-2">Loading sales...</p>
					</div>
				) : rows.length > 0 ? (
					<div className="space-y-4 pt-4 px-4 xl:px-6">
						{rows.map((row) => {
							const primary = row.cells.find((cell) => cell.id === row.primaryCellId)
							const actions = row.cells.find((cell) => cell.id === row.actionsCellId)
							const others = row.cells.filter((cell) => cell.id !== row.primaryCellId && cell.id !== row.actionsCellId)
							return (
								<Card
									key={row.id}
									onClick={row.onOpen}
									className="cursor-pointer hover:bg-muted/50"
									data-state={row.isSelected ? 'selected' : undefined}
								>
									<div className="block xl:hidden p-4">
										<div className="flex justify-between items-center mb-4">
											{primary && <div className="text-sm font-medium">{primary.content}</div>}
											{actions && <div className="text-sm">{actions.content}</div>}
										</div>
										<div className="space-y-3">
											{others.map((cell) => (
												<div key={cell.id} className="flex justify-between items-start">
													<span className="text-sm font-medium text-gray-600 capitalize min-w-0 flex-shrink-0 mr-3">{cell.label}:</span>
													<div className="text-sm text-right min-w-0 flex-1">{cell.content}</div>
												</div>
											))}
										</div>
									</div>

									<div className="hidden xl:grid xl:grid-cols-[repeat(4,minmax(0,1fr))_auto] gap-4 p-4 items-center">
										{row.cells.map((cell) => (
											<div key={cell.id}>{cell.content}</div>
										))}
									</div>
								</Card>
							)
						})}
					</div>
				) : (
					<div className="px-4 xl:px-6">
						<Card className="rounded-md border p-6 text-center mt-4">{emptyMessage}</Card>
					</div>
				)}
			</div>
		</div>
	)
}
