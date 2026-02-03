import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArrowDownNarrowWide, ArrowUpNarrowWide, CheckCircle, Circle, Clock, Filter, Loader, XCircle } from 'lucide-react'
import type { OrderWithRelatedEvents } from '@/queries/orders'
import { formatSats, getBuyerPubkey, getEventDate, getOrderAmount, getOrderId, getSellerPubkey } from '@/queries/orders'
import type { ColumnDef, ColumnFiltersState, FilterFn, SortingState } from '@tanstack/react-table'
import { getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { ndkActions } from '@/lib/stores/ndk'
import { UserWithAvatar } from '../UserWithAvatar'
import { OrderActionsInline } from './OrderActionsInline'
import { uiStore } from '@/lib/stores/ui'
import { useBtcExchangeRates } from '@/queries/external'
import { useStore } from '@tanstack/react-store'

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
	viewType?: 'sales' | 'purchases'
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
	viewType = 'sales',
}: OrderDataTableProps<TData>) {
	const [sorting, setSorting] = useState<SortingState>([])
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
	const [globalFilter, setGlobalFilter] = useState('')
	const navigate = useNavigate()
	const { selectedCurrency } = useStore(uiStore)
	const { data: exchangeRates } = useBtcExchangeRates()

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
			<div className="sticky top-0 z-20 bg-white border-b p-4 flex flex-row items-center justify-between gap-4 shadow-sm overflow-hidden">
				{heading && <div className="shrink-0 min-w-0">{heading}</div>}

				<div className="flex flex-row justify-end items-center gap-4 w-auto shrink-0">
					{showSearch && (
						<Input
							placeholder="Search by Order ID or Buyer..."
							value={globalFilter}
							onChange={(e) => setGlobalFilter(e.target.value)}
							className="max-w-xs"
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
									<SelectItem value="username-asc">
										<ArrowUpNarrowWide className="h-4 w-4" />
										Username A-Z
									</SelectItem>
									<SelectItem value="username-desc">
										<ArrowDownNarrowWide className="h-4 w-4" />
										Username Z-A
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

			<div className="flex-1 overflow-y-auto">
				{isLoading ? (
					<div className="space-y-4 p-4">
						{Array(7)
							.fill(0)
							.map((_, i) => (
								<div key={i} className="rounded-md border border-gray-200 p-6 text-center">
									Loading...
								</div>
							))}
					</div>
				) : table.getRowModel().rows?.length ? (
					<div className="space-y-4 p-4">
						{table.getRowModel().rows.map((row) => {
							const orderId = (row.original as any).order.id || 'unknown'
							return (
								<Card
									key={row.id}
									onClick={() => navigate({ to: '/dashboard/orders/$orderId', params: { orderId } })}
									className="cursor-pointer hover:bg-muted/50"
									data-state={row.getIsSelected() && 'selected'}
								>
									<div className="p-4">
										{(() => {
											const orderData = row.original as OrderWithRelatedEvents
											const orderId = getOrderId(orderData.order) || 'unknown'
											const date = getEventDate(orderData.order)
											const amount = getOrderAmount(orderData.order)
											const userPubkey = viewType === 'sales' ? getBuyerPubkey(orderData.order) : getSellerPubkey(orderData.order)
											const ndk = ndkActions.getNDK()
											const currentUserPubkey = ndk?.activeUser?.pubkey

											return (
												<>
													{/* Row 1: Order, Status/Action/Cancel */}
													<div className="flex items-center justify-between mb-2">
														{/* Order ID - full, no wrap */}
														<div className="flex items-center gap-2 min-w-0">
															<span className="text-sm font-bold text-muted-foreground uppercase shrink-0">Order:</span>
															<Link
																to="/dashboard/orders/$orderId"
																params={{ orderId }}
																className="text-sm truncate"
																onClick={(e) => e.stopPropagation()}
															>
																{orderId}
															</Link>
														</div>
														{/* Status + Actions */}
														{currentUserPubkey && (
															<div onClick={(e) => e.stopPropagation()} className="shrink-0">
																<OrderActionsInline order={orderData} userPubkey={currentUserPubkey} />
															</div>
														)}
													</div>
													{/* Row 2: Buyer/Seller + Fiat Price */}
													<div className="flex items-center justify-between gap-2 mb-2">
														<div className="flex items-center gap-2">
															<span className="text-sm font-bold text-muted-foreground uppercase">
																{viewType === 'sales' ? 'Buyer:' : 'Seller:'}
															</span>
															<UserWithAvatar
																pubkey={userPubkey || ''}
																showBadge={false}
																size="sm"
																disableLink={false}
																showHoverEffects={true}
																truncate={false}
															/>
														</div>
														{/* Fiat Price */}
														{exchangeRates && amount > 0 && (
															<span className="text-sm text-muted-foreground whitespace-nowrap shrink-0">
																{(
																	(amount / 100000000) *
																	(exchangeRates[selectedCurrency as keyof typeof exchangeRates] || 0)
																).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
																{selectedCurrency}
															</span>
														)}
													</div>
													{/* Row 3: Date, Price */}
													<div className="flex items-center justify-between">
														<span className="text-sm whitespace-nowrap">{date}</span>
														{/* Price */}
														<span className="font-medium text-sm text-right min-w-0 min-[480px]:min-w-[175px] whitespace-nowrap shrink-0">
															{formatSats(amount)}
														</span>
													</div>
												</>
											)
										})()}
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
