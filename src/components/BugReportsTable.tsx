import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createColumnHelper, flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type SortingState } from '@tanstack/react-table'
import { useState } from 'react'
import { BugReport, bugReportsQueryOptions } from '@/queries/bugReports'
import { useUserProfile } from '@/queries/bugReports'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

const columnHelper = createColumnHelper<BugReport>()

// User profile component for each row
function UserProfileCell({ pubkey }: { pubkey: string }) {
	const navigate = useNavigate()
	const { data: profile, isLoading: isLoadingProfile } = useUserProfile(pubkey)

	const handleProfileClick = () => {
		navigate({ to: '/profile/$profileId', params: { profileId: pubkey } })
	}

	const displayName = profile?.name || profile?.displayName || pubkey.slice(0, 8) + '...'
	const nameInitial = displayName.charAt(0).toUpperCase()

	if (isLoadingProfile) {
		return (
			<div className="flex items-center gap-2">
				<div className="h-8 w-8 rounded-full bg-gray-200 animate-pulse" />
				<div className="h-4 w-20 bg-gray-200 animate-pulse rounded" />
			</div>
		)
	}

	return (
		<Button variant="ghost" onClick={handleProfileClick} className="flex items-center gap-2 p-0 h-auto hover:bg-gray-50">
			<Avatar className="h-8 w-8">
				<AvatarImage src={profile?.picture} />
				<AvatarFallback className="text-xs">{nameInitial}</AvatarFallback>
			</Avatar>
			<div className="flex flex-col items-start">
				<span className="text-sm font-medium text-gray-900">{displayName}</span>
				<span className="text-xs text-gray-500">{pubkey.slice(0, 8)}...</span>
			</div>
		</Button>
	)
}

// Date formatting function
function formatDate(timestamp: number) {
	return new Date(timestamp * 1000).toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	})
}

interface BugReportsTableProps {
	className?: string
}

export function BugReportsTable({ className = '' }: BugReportsTableProps) {
	const [sorting, setSorting] = useState<SortingState>([
		{ id: 'createdAt', desc: true }, // Default sort by newest first
	])

	// Fetch bug reports using React Query
	const { data: bugReports = [], isLoading, isError, error, refetch } = useQuery(bugReportsQueryOptions(100)) // Load up to 100 reports

	// Define table columns
	const columns = useMemo(
		() => [
			columnHelper.accessor('pubkey', {
				id: 'user',
				header: 'User',
				cell: ({ getValue }) => <UserProfileCell pubkey={getValue()} />,
				enableSorting: false,
				size: 200,
			}),
			columnHelper.accessor('content', {
				id: 'content',
				header: 'Bug Report',
				cell: ({ getValue }) => {
					const content = getValue()
					const preview = content.length > 150 ? content.slice(0, 150) + '...' : content
					return <div className="text-sm text-gray-800 whitespace-pre-wrap break-words max-w-md">{preview}</div>
				},
				enableSorting: false,
			}),
			columnHelper.accessor('createdAt', {
				id: 'createdAt',
				header: 'Date',
				cell: ({ getValue }) => <span className="text-xs text-gray-500 whitespace-nowrap">{formatDate(getValue())}</span>,
				enableSorting: true,
				size: 150,
			}),
		],
		[],
	)

	// Create table instance
	const table = useReactTable({
		data: bugReports,
		columns,
		state: {
			sorting,
		},
		onSortingChange: setSorting,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
	})

	// Handle manual refresh
	const handleRefresh = async () => {
		console.log('🐛 Manually refreshing bug reports table...')
		await refetch()
	}

	if (isError) {
		return (
			<div className={`flex flex-col items-center justify-center py-12 text-center ${className}`}>
				<h3 className="text-lg font-semibold text-red-600 mb-2">Failed to load bug reports</h3>
				<p className="text-gray-600 mb-4">{error instanceof Error ? error.message : 'An unknown error occurred'}</p>
				<Button onClick={handleRefresh} variant="outline">
					Try Again
				</Button>
			</div>
		)
	}

	if (isLoading) {
		return (
			<div className={`flex flex-col items-center justify-center py-12 ${className}`}>
				<Loader2 className="w-8 h-8 animate-spin mb-4" />
				<p className="text-gray-600">Loading bug reports...</p>
			</div>
		)
	}

	if (bugReports.length === 0) {
		return (
			<div className={`flex flex-col items-center justify-center py-12 text-center ${className}`}>
				<h3 className="text-lg font-semibold text-gray-900 mb-2">No bug reports found</h3>
				<p className="text-gray-600 mb-4">There are no bug reports available at the moment.</p>
				<Button onClick={handleRefresh} variant="outline">
					Refresh
				</Button>
			</div>
		)
	}

	return (
		<div className={`flex flex-col ${className}`}>
			{/* Header with refresh button */}
			<div className="flex items-center justify-between mb-4">
				<h3 className="text-lg font-semibold text-gray-900">Bug Reports ({bugReports.length})</h3>
				<Button onClick={handleRefresh} variant="outline" size="sm">
					Refresh
				</Button>
			</div>

			{/* Table */}
			<div className="border border-gray-200 rounded-lg overflow-hidden">
				<div className="overflow-x-auto">
					<table className="w-full">
						<thead className="bg-gray-50">
							{table.getHeaderGroups().map((headerGroup) => (
								<tr key={headerGroup.id}>
									{headerGroup.headers.map((header) => (
										<th
											key={header.id}
											className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
											style={{ width: header.getSize() }}
										>
											{header.isPlaceholder ? null : (
												<div
													className={header.column.getCanSort() ? 'cursor-pointer select-none flex items-center gap-1' : ''}
													onClick={header.column.getToggleSortingHandler()}
												>
													{flexRender(header.column.columnDef.header, header.getContext())}
													{header.column.getCanSort() && (
														<span className="text-gray-400">
															{{
																asc: '↑',
																desc: '↓',
															}[header.column.getIsSorted() as string] ?? '↕'}
														</span>
													)}
												</div>
											)}
										</th>
									))}
								</tr>
							))}
						</thead>
						<tbody className="bg-white divide-y divide-gray-200">
							{table.getRowModel().rows.map((row) => (
								<tr key={row.id} className="hover:bg-gray-50">
									{row.getVisibleCells().map((cell) => (
										<td key={cell.id} className="px-4 py-4 whitespace-nowrap">
											{flexRender(cell.column.columnDef.cell, cell.getContext())}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	)
}
