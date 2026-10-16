import React from 'react'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import type { OrderWithRelatedEvents } from '@/queries/orders'
import type { ColumnDef, ColumnFiltersState, FilterFn, SortingState } from '@tanstack/react-table'
import { flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { OrderListView } from '@ui/components/orders/OrderListView'

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
	emptyMessage?: string
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
	emptyMessage = 'No orders found.',
}: OrderDataTableProps<TData>) {
	const [sorting, setSorting] = useState<SortingState>([])
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
	const [globalFilter, setGlobalFilter] = useState('')
	const navigate = useNavigate()
	const breakpoint = useBreakpoint()
	const isCompact = breakpoint !== 'xl'

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
		<OrderListView
			heading={heading}
			search={showSearch ? { value: globalFilter, onChange: setGlobalFilter } : undefined}
			orderBy={showOrderBy && onOrderByChange ? { value: orderBy, onChange: onOrderByChange } : undefined}
			statusFilter={showStatusFilter && onStatusFilterChange ? { value: statusFilter, onChange: onStatusFilterChange } : undefined}
			isCompact={isCompact}
			isLoading={isLoading}
			emptyMessage={emptyMessage}
			rows={table.getRowModel().rows.map((row) => {
				const orderId = (row.original as any).order.id || 'unknown'
				return {
					id: row.id,
					onOpen: () => navigate({ to: '/dashboard/orders/$orderId', params: { orderId } }),
					isSelected: row.getIsSelected(),
					primaryCellId: 'orderId',
					actionsCellId: 'actions',
					cells: row.getVisibleCells().map((cell) => ({
						id: cell.column.id,
						label:
							typeof cell.column.columnDef.header === 'string'
								? cell.column.columnDef.header
								: cell.column.id.replace(/([A-Z])/g, ' $1').trim(),
						content: flexRender(cell.column.columnDef.cell, cell.getContext()),
					})),
				}
			})}
		/>
	)
}
