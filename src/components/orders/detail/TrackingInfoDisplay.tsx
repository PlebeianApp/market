import { copyToClipboard } from '@/lib/utils'
import { TrackingInfoView } from '@ui/components/orders/OrderDetailViews'

interface TrackingInfoDisplayProps {
	trackingNumber?: string
	carrier?: string
	shippingStatus?: string
}

export function TrackingInfoDisplay(props: TrackingInfoDisplayProps) {
	return <TrackingInfoView {...props} onCopy={(value) => copyToClipboard(value)} />
}
