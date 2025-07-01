import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { OrderWithRelatedEvents } from '@/queries/orders'
import type { ColumnDef, ColumnFiltersState, FilterFn, SortingState } from '@tanstack/react-table'
import {
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	useReactTable,
} from '@tanstack/react-table'
import { useMemo, useState } from 'react'

const fuzzyFilter: FilterFn<OrderWithRelatedEvents> = (row, columnId, value, addMeta) => {
	const item = (row.getValue(columnId) as string) || ''
	const lowerCaseValue = value.toLowerCase()

	// This part is a bit of a hack to search the buyer's name which is rendered async in a child component.
	// We get the cell and then check its rendered content.
	const cell = row.getVisibleCells().find((c) => c.column.id === columnId)
	const renderedCellValue = cell?.renderValue() as string
	const itemInCell = renderedCellValue?.toString().toLowerCase() || ''

	// Rank based on how good the match is
	const itemRank = item.toLowerCase().includes(lowerCaseValue) ? 2 : itemInCell.includes(lowerCaseValue) ? 1 : 0

	addMeta({
		itemRank,
	})

	return itemRank > 0
}

interface OrderDataTableProps<TData> {
	data: TData[]
	columns: ColumnDef<TData, any>[]
	isLoading?: boolean
	filterColumn?: string
	showStatusFilter?: boolean
	onStatusFilterChange?: (value: string) => void
	statusFilter?: string
}

export function OrderDataTable<TData>({
	data,
	columns,
	isLoading = false,
	filterColumn = 'orderId',
	showStatusFilter = false,
	onStatusFilterChange,
	statusFilter = 'any',
}: OrderDataTableProps<TData>) {
	const [sorting, setSorting] = useState<SortingState>([])
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
	const [globalFilter, setGlobalFilter] = useState('')

	const table = useReactTable({
		data,
		columns,
		globalFilterFn: fuzzyFilter as any,
		getCoreRowModel: getCoreRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		onSortingChange: setSorting,
		getSortedRowModel: getSortedRowModel(),
		onColumnFiltersChange: setColumnFilters,
		getFilteredRowModel: getFilteredRowModel(),
		onGlobalFilterChange: setGlobalFilter,
		initialState: {
			pagination: {
				pageSize: 7, // Show 7 items per page
			},
		},
		state: {
			sorting,
			columnFilters,
			globalFilter,
		},
	})

	return (
		<div className="space-y-4">
			<div className="flex flex-col lg:flex-row gap-4">
				<Input
					placeholder="Search by Order ID or Buyer..."
					value={globalFilter}
					onChange={(e) => setGlobalFilter(e.target.value)}
					className="w-full lg:flex-1"
				/>

				{showStatusFilter && onStatusFilterChange && (
					<div className="w-full lg:w-64">
						<Select defaultValue="any" value={statusFilter} onValueChange={onStatusFilterChange}>
							<SelectTrigger>
								<SelectValue placeholder="Any Status" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="any">Any Status</SelectItem>
								<SelectItem value="pending">Pending</SelectItem>
								<SelectItem value="confirmed">Confirmed</SelectItem>
								<SelectItem value="processing">Processing</SelectItem>
								<SelectItem value="completed">Completed</SelectItem>
								<SelectItem value="cancelled">Cancelled</SelectItem>
							</SelectContent>
						</Select>
					</div>
				)}
			</div>

			{isLoading ? (
				<div className="space-y-2">
					{Array(7)
						.fill(0)
						.map((_, i) => (
							<div key={i} className="rounded-md border border-gray-200 p-6 text-center">
								Loading...
							</div>
						))}
				</div>
			) : table.getRowModel().rows?.length ? (
				<div className="space-y-2">
					{table.getRowModel().rows.map((row) => (
						<div key={row.id} className="rounded-md border border-gray-200 hover:bg-gray-50" data-state={row.getIsSelected() && 'selected'}>
							{/* Mobile Card Layout */}
							<div className="block xl:hidden p-4 space-y-3">
								{row.getVisibleCells().map((cell, index) => (
									<div key={cell.id} className="flex justify-between items-start">
										<span className="text-sm font-medium text-gray-600 capitalize min-w-0 flex-shrink-0 mr-3">
											{typeof cell.column.columnDef.header === 'string' 
												? cell.column.columnDef.header 
												: cell.column.id.replace(/([A-Z])/g, ' $1').trim()}:
										</span>
										<div className="text-sm text-right min-w-0 flex-1">
											{flexRender(cell.column.columnDef.cell, cell.getContext())}
										</div>
									</div>
								))}
							</div>
							
							{/* Desktop Grid Layout */}
							<div className="hidden xl:grid xl:grid-cols-5 gap-4 p-4 items-center">
								{row.getVisibleCells().map((cell) => (
									<div key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</div>
								))}
							</div>
						</div>
					))}
				</div>
			) : (
				<div className="rounded-md border border-gray-200 p-6 text-center">No orders found.</div>
			)}

			<div className="flex items-center justify-between space-x-2 py-4">
				<div className="flex-1 text-sm text-muted-foreground">
					Showing {table.getRowModel().rows.length} of {data.length} orders
				</div>
				<div className="flex space-x-2">
				<Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
					Previous
				</Button>
				<Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
					Next
				</Button>
				</div>
			</div>
		</div>
	)
}
