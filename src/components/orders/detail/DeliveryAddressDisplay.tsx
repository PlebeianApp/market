import { Truck } from 'lucide-react'
import { parseAddress } from '../orderDetailHelpers'

interface DeliveryAddressDisplayProps {
	shippingAddress: string
}

export function DeliveryAddressDisplay({ shippingAddress }: DeliveryAddressDisplayProps) {
	const parsedAddress = parseAddress(shippingAddress)

	return (
		<div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
			<div className="flex items-start gap-3">
				<Truck className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
				<div className="flex-1 min-w-0">
					<p className="font-semibold text-green-900 mb-3">Delivery Address</p>
					{parsedAddress ? (
						<div className="space-y-2">
							{parsedAddress.name && (
								<div>
									<p className="text-xs font-medium text-green-700 uppercase tracking-wide">Name</p>
									<p className="text-green-900 font-medium">{parsedAddress.name}</p>
								</div>
							)}
							{parsedAddress.street && (
								<div>
									<p className="text-xs font-medium text-green-700 uppercase tracking-wide">Street Address</p>
									<p className="text-green-900">{parsedAddress.street}</p>
									{parsedAddress.street2 && <p className="text-green-900">{parsedAddress.street2}</p>}
								</div>
							)}
							<div className="grid grid-cols-2 gap-3">
								{parsedAddress.city && (
									<div>
										<p className="text-xs font-medium text-green-700 uppercase tracking-wide">City</p>
										<p className="text-green-900">{parsedAddress.city}</p>
									</div>
								)}
								{parsedAddress.state && (
									<div>
										<p className="text-xs font-medium text-green-700 uppercase tracking-wide">State</p>
										<p className="text-green-900">{parsedAddress.state}</p>
									</div>
								)}
							</div>
							<div className="grid grid-cols-2 gap-3">
								{parsedAddress.zip && (
									<div>
										<p className="text-xs font-medium text-green-700 uppercase tracking-wide">ZIP Code</p>
										<p className="text-green-900">{parsedAddress.zip}</p>
									</div>
								)}
								{parsedAddress.country && (
									<div>
										<p className="text-xs font-medium text-green-700 uppercase tracking-wide">Country</p>
										<p className="text-green-900">{parsedAddress.country}</p>
									</div>
								)}
							</div>
						</div>
					) : (
						<div className="text-green-800 space-y-0.5">
							{shippingAddress.split('\n').map((line, index) => (
								<p key={index} className="leading-relaxed">
									{line.trim()}
								</p>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	)
}
