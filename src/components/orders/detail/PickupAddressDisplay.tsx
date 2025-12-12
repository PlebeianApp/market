import { MapPin } from 'lucide-react'

interface PickupAddressDisplayProps {
	pickupAddress: string
}

export function PickupAddressDisplay({ pickupAddress }: PickupAddressDisplayProps) {
	return (
		<div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
			<div className="flex items-start gap-2">
				<MapPin className="w-4 h-4 text-blue-600 mt-0.5" />
				<div>
					<p className="font-medium text-blue-900">Pickup Address</p>
					<p className="text-blue-800 mt-1">{pickupAddress}</p>
				</div>
			</div>
		</div>
	)
}
