import { Button } from '@/components/ui/button'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface IncompleteInvoicesBannerProps {
	count: number
	onRefresh: () => void
}

export function IncompleteInvoicesBanner({ count, onRefresh }: IncompleteInvoicesBannerProps) {
	return (
		<div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
			<div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:justify-between sm:text-left">
				<div className="flex flex-col items-center gap-2 text-yellow-800 sm:flex-row sm:items-center">
					<AlertTriangle className="w-6 h-6 text-yellow-800 sm:w-5 sm:h-5" />
					<div>
						<p className="font-medium">
							{count} invoice{count !== 1 ? 's' : ''} require payment
						</p>
						<p className="text-sm">Make all payments to complete the order</p>
					</div>
				</div>
				<Button
					variant="outline"
					size="sm"
					onClick={onRefresh}
					className="w-full text-yellow-700 border-yellow-300 hover:bg-yellow-100 sm:w-auto"
				>
					<RefreshCw className="w-4 h-4 mr-2" />
					Refresh All
				</Button>
			</div>
		</div>
	)
}
