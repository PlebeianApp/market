import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArrowDownNarrowWide, ArrowUpNarrowWide, CheckCircle, Circle, Clock, Filter, Loader, XCircle } from 'lucide-react'
import type { OrderWithRelatedEvents } from '@/queries/orders'
import type { ColumnDef, ColumnFiltersState, FilterFn, SortingState } from '@tanstack/react-table'
import { flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import { Link, useNavigate } from '@tanstack/react-router'
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
	heading?: React.ReactNode
	isLoading?: boolean
	filterColumn?: string
	showStatusFilter?: boolean
	onStatusFilterChange?: (value: string) => void
	statusFilter?: string
	showSearch?: boolean
	showOrderBy?: boolean
	onOrderByChange?: (value: string) => void
	orderBy?: string
}

export function OrderDataTable<TData>({
	data,
	columns,
	heading,
	isLoading = false,
	filterColumn = 'orderId',
	showStatusFilter = false,
	onStatusFilterChange,
	statusFilter = 'any',
	showSearch = true,
	showOrderBy = false,
	onOrderByChange,
	orderBy = 'newest',
}: OrderDataTableProps<TData>) {
	const [sorting, setSorting] = useState<SortingState>([])
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
	const [globalFilter, setGlobalFilter] = useState('')
	const navigate = useNavigate()

	const table = useReactTable({
		data,
		columns,
		globalFilterFn: fuzzyFilter as any,
		getCoreRowModel: getCoreRowModel(),
		onSortingChange: setSorting,
		getSortedRowModel: getSortedRowModel(),
		onColumnFiltersChange: setColumnFilters,
		getFilteredRowModel: getFilteredRowModel(),
		onGlobalFilterChange: setGlobalFilter,
		state: {
			sorting,
			columnFilters,
			globalFilter,
		},
	})

	return (
		<div className="flex h-full flex-col">
			<div className="sticky top-[12.75rem] lg:top-0 z-20 bg-white border-b py-4 px-4 xl:px-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 shadow-sm">
				{heading && <div className="hidden lg:block flex-1">{heading}</div>}

				<div className="flex flex-row justify-end items-center gap-2 sm:gap-4 w-full lg:w-auto">
					{showSearch && (
						<Input
							placeholder="Search by Order ID or Buyer..."
							value={globalFilter}
							onChange={(e) => setGlobalFilter(e.target.value)}
							className="w-full sm:max-w-xs"
						/>
					)}

					{showOrderBy && onOrderByChange && (
						<div className="w-auto">
							<Select value={orderBy} onValueChange={onOrderByChange}>
								<SelectTrigger>
									<SelectValue placeholder="Order By" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="newest">
										<ArrowDownNarrowWide className="h-4 w-4" />
										Newest First
									</SelectItem>
									<SelectItem value="oldest">
										<ArrowUpNarrowWide className="h-4 w-4" />
										Oldest First
									</SelectItem>
									<SelectItem value="recently-updated">
										<ArrowDownNarrowWide className="h-4 w-4" />
										Recently Updated
									</SelectItem>
									<SelectItem value="least-updated">
										<ArrowUpNarrowWide className="h-4 w-4" />
										Least Recently Updated
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
					)}

					{showStatusFilter && onStatusFilterChange && (
						<div className="w-auto">
							<Select defaultValue="any" value={statusFilter} onValueChange={onStatusFilterChange}>
								<SelectTrigger>
									<SelectValue placeholder="Any Status" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="any">
										<Filter className="h-4 w-4" />
										Any Status
									</SelectItem>
									<SelectItem value="pending">
										<Clock className="h-4 w-4" />
										Pending
									</SelectItem>
									<SelectItem value="confirmed">
										<CheckCircle className="h-4 w-4" />
										Confirmed
									</SelectItem>
									<SelectItem value="processing">
										<Loader className="h-4 w-4" />
										Processing
									</SelectItem>
									<SelectItem value="completed">
										<Circle className="h-4 w-4 fill-current" />
										Completed
									</SelectItem>
									<SelectItem value="cancelled">
										<XCircle className="h-4 w-4" />
										Cancelled
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
					)}
				</div>
			</div>

			<div className="flex-1 overflow-y-auto pb-4">
				{isLoading ? (
					<div className="space-y-4 pt-4 px-4 xl:px-6">
						{Array(7)
							.fill(0)
							.map((_, i) => (
								<div key={i} className="rounded-md border border-gray-200 p-6 text-center">
									Loading...
								</div>
							))}
					</div>
				) : table.getRowModel().rows?.length ? (
					<div className="space-y-4 pt-4 px-4 xl:px-6">
						{table.getRowModel().rows.map((row) => {
							const orderId = (row.original as any).order.id || 'unknown'
							return (
								<Card
									key={row.id}
									onClick={() => navigate({ to: '/dashboard/orders/$orderId', params: { orderId } })}
									className="cursor-pointer hover:bg-muted/50"
									data-state={row.getIsSelected() && 'selected'}
								>
									{/* Mobile/Tablet Card Layout */}
									<div className="block xl:hidden p-4">
										{(() => {
											const orderIdCell = row.getVisibleCells().find((c) => c.column.id === 'orderId')
											const actionsCell = row.getVisibleCells().find((c) => c.column.id === 'actions')
											const dateCell = row.getVisibleCells().find((c) => c.column.id === 'date')
											const amountCell = row.getVisibleCells().find((c) => c.column.id === 'amount')
											const otherCells = row
												.getVisibleCells()
												.filter((c) => !['orderId', 'actions', 'date', 'amount'].includes(c.column.id))

											return (
												<>
													<div className="flex justify-between items-center mb-3">
														{orderIdCell && (
															<div className="flex items-center text-sm font-medium">
																<span className="text-sm font-medium text-gray-600 w-18">Order:</span>
																{flexRender(orderIdCell.column.columnDef.cell, orderIdCell.getContext())}
															</div>
														)}
														{actionsCell && (
															<div className="text-sm">{flexRender(actionsCell.column.columnDef.cell, actionsCell.getContext())}</div>
														)}
													</div>
													<div className="space-y-3">
														{otherCells.map((cell) => (
															<div key={cell.id} className="flex items-center">
																<span className="text-sm font-medium text-gray-600 capitalize w-18 flex-shrink-0">
																	{typeof cell.column.columnDef.header === 'string'
																		? cell.column.columnDef.header
																		: cell.column.id.replace(/([A-Z])/g, ' $1').trim()}
																	:
																</span>
																<div className="text-sm min-w-0">{flexRender(cell.column.columnDef.cell, cell.getContext())}</div>
															</div>
														))}
														{/* Date & Amount row - 50% split */}
														{(dateCell || amountCell) && (
															<div className="flex justify-between items-center">
																{dateCell && (
																	<div className="flex items-center text-sm text-left w-1/2">
																		<span className="text-sm font-medium text-gray-600 w-18">Date:</span>
																		{flexRender(dateCell.column.columnDef.cell, dateCell.getContext())}
																	</div>
																)}
																{amountCell && (
																	<div className="flex items-center justify-end text-sm w-1/2">
																		<span className="text-sm font-medium text-gray-600 w-18">Price:</span>
																		<span className="w-40 text-right">
																			{flexRender(amountCell.column.columnDef.cell, amountCell.getContext())}
																		</span>
																	</div>
																)}
															</div>
														)}
													</div>
												</>
											)
										})()}
									</div>

									{/* Desktop Flex Layout - only on xl screens and above */}
									<div className="hidden xl:flex xl:flex-row gap-4 p-4 items-center w-full overflow-hidden">
										{row.getVisibleCells().map((cell) => (
											<div
												key={cell.id}
												className={
													cell.column.id === 'actions' ? 'flex-1 flex justify-end overflow-hidden' : 'min-w-0 shrink-0 overflow-hidden'
												}
											>
												{flexRender(cell.column.columnDef.cell, cell.getContext())}
											</div>
										))}
									</div>
								</Card>
							)
						})}
					</div>
				) : (
					<div className="px-4 xl:px-6">
						<Card className="rounded-md border p-6 text-center mt-4">No orders found.</Card>
					</div>
				)}
			</div>
		</div>
	)
}
