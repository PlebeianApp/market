import { Button } from '@/components/ui/button'
import { copyToClipboard } from '@/lib/utils'
import { Copy, Package } from 'lucide-react'

interface TrackingInfoDisplayProps {
	trackingNumber?: string
	carrier?: string
	shippingStatus?: string
}

export function TrackingInfoDisplay({ trackingNumber, carrier, shippingStatus }: TrackingInfoDisplayProps) {
	if (!trackingNumber && !carrier) return null

	return (
		<div className="mt-4 p-4 bg-purple-50 border border-purple-200 rounded-lg">
			<div className="flex items-start gap-3">
				<Package className="w-5 h-5 text-purple-600 mt-0.5 flex-shrink-0" />
				<div className="flex-1 min-w-0">
					<p className="font-semibold text-purple-900 mb-2">Tracking Information</p>
					<div className="space-y-2">
						{trackingNumber && (
							<div className="flex items-center justify-between gap-2">
								<div className="min-w-0 flex-1">
									<p className="text-xs font-medium text-purple-700 uppercase tracking-wide">Tracking Number</p>
									<p className="text-purple-900 font-mono text-sm break-all">{trackingNumber}</p>
								</div>
								<Button
									variant="ghost"
									size="sm"
									className="h-8 px-2 text-purple-700 hover:text-purple-900 hover:bg-purple-100 flex-shrink-0"
									onClick={() => copyToClipboard(trackingNumber, 'Tracking number copied to clipboard')}
								>
									<Copy className="h-4 w-4" />
								</Button>
							</div>
						)}
						{carrier && (
							<div>
								<p className="text-xs font-medium text-purple-700 uppercase tracking-wide">Carrier</p>
								<p className="text-purple-900">{carrier}</p>
							</div>
						)}
						{shippingStatus && (
							<div>
								<p className="text-xs font-medium text-purple-700 uppercase tracking-wide">Status</p>
								<p className="text-purple-900 capitalize">{shippingStatus}</p>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	)
}
