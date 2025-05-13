import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { ColumnDef, ColumnFiltersState, SortingState } from "@tanstack/react-table"
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { useState } from "react"

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
  filterColumn = "orderId",
  showStatusFilter = false,
  onStatusFilterChange,
  statusFilter = "any"
}: OrderDataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    onColumnFiltersChange: setColumnFilters,
    getFilteredRowModel: getFilteredRowModel(),
    initialState: {
      pagination: {
        pageSize: 7, // Show 7 items per page
      },
    },
    state: {
      sorting,
      columnFilters,
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between py-4">
        {showStatusFilter && onStatusFilterChange && (
          <div className="w-full">
            <Select 
              defaultValue="any" 
              value={statusFilter} 
              onValueChange={onStatusFilterChange}
            >
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
          {Array(7).fill(0).map((_, i) => (
            <div key={i} className="rounded-md border border-gray-200 p-6 text-center">
              Loading...
            </div>
          ))}
        </div>
      ) : table.getRowModel().rows?.length ? (
        <div className="space-y-2">
          {table.getRowModel().rows.map((row) => (
            <div 
              key={row.id} 
              className="rounded-md border border-gray-200 hover:bg-gray-50"
              data-state={row.getIsSelected() && "selected"}
            >
              <div className="grid grid-cols-[auto_auto_auto_auto_auto] gap-4 p-4 items-center">
                {row.getVisibleCells().map((cell) => (
                  <div key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-gray-200 p-6 text-center">
          No orders found.
        </div>
      )}
      
      <div className="flex items-center justify-end space-x-2 py-4">
        <div className="flex-1 text-sm text-muted-foreground">
          Showing {table.getRowModel().rows.length} of {data.length} orders
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          Next
        </Button>
      </div>
    </div>
  )
} 