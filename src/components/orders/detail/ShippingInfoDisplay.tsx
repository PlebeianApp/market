interface ShippingInfoDisplayProps {
	shippingInfo: {
		title: string
		price: { amount: string | number; currency: string }
		service?: string
		carrier?: string
		duration?: { min?: string | number; max?: string | number; unit?: string }
		countries?: string[]
		description?: string
	}
}

export function ShippingInfoDisplay({ shippingInfo }: ShippingInfoDisplayProps) {
	return (
		<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
			<div>
				<span className="text-sm text-muted-foreground">Method:</span>
				<span className="ml-2 font-medium">{shippingInfo.title}</span>
			</div>
			<div>
				<span className="text-sm text-muted-foreground">Cost:</span>
				<span className="ml-2 font-medium">{`${shippingInfo.price.amount} ${shippingInfo.price.currency}`}</span>
			</div>
			{shippingInfo.service && (
				<div>
					<span className="text-sm text-muted-foreground">Service Type:</span>
					<span className="ml-2 font-medium">{shippingInfo.service.charAt(0).toUpperCase() + shippingInfo.service.slice(1)}</span>
				</div>
			)}
			{shippingInfo.carrier && (
				<div>
					<span className="text-sm text-muted-foreground">Carrier:</span>
					<span className="ml-2 font-medium">{shippingInfo.carrier}</span>
				</div>
			)}
			{shippingInfo.duration && (
				<div>
					<span className="text-sm text-muted-foreground">Delivery Time:</span>
					<span className="ml-2 font-medium">{`${shippingInfo.duration.min}-${shippingInfo.duration.max} ${shippingInfo.duration.unit}`}</span>
				</div>
			)}
			{shippingInfo.countries && shippingInfo.countries.length > 0 && (
				<div>
					<span className="text-sm text-muted-foreground">Available Countries:</span>
					<span className="ml-2 font-medium">{shippingInfo.countries.join(', ')}</span>
				</div>
			)}
		</div>
	)
}
